const http = require("http");
const https = require("https");
const net = require("net");
const { logAuditEvent, sanitizeAuditBody } = require("../utilts/audit.Logger");
const { sql } = require("../config/db.Config");

// IP helpers

const normalizeIp = (value) => {
  if (!value || typeof value !== "string") return null;

  let ip = value.trim().replace(/^"|"$/g, "");

  if (!ip || ip.toLowerCase() === "unknown") return null;

  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.split(":")[0];
  }

  return net.isIP(ip) ? ip : null;
};

const addCandidateIp = (candidates, value) => {
  const ip = normalizeIp(value);
  if (ip && !candidates.includes(ip)) {
    candidates.push(ip);
  }
};

const addHeaderIps = (candidates, value) => {
  if (!value) return;

  const headerValue = Array.isArray(value) ? value.join(",") : String(value);
  headerValue.split(",").forEach((part) => addCandidateIp(candidates, part));
};

const addForwardedHeaderIps = (candidates, value) => {
  if (!value) return;

  const headerValue = Array.isArray(value) ? value.join(",") : String(value);
  const forwardedEntries = headerValue.split(",");

  for (const entry of forwardedEntries) {
    const forPart = entry
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.toLowerCase().startsWith("for="));

    if (!forPart) continue;

    const rawIp = forPart.slice(4).trim();
    addCandidateIp(candidates, rawIp);
  }
};

const isPrivateIp = (ip) => {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return true;

  if (net.isIP(normalizedIp) === 6) {
    return (
      normalizedIp === "::1" ||
      normalizedIp.toLowerCase().startsWith("fc") ||
      normalizedIp.toLowerCase().startsWith("fd") ||
      normalizedIp.toLowerCase().startsWith("fe80:")
    );
  }

  return (
    /^10\./.test(normalizedIp) ||
    /^127\./.test(normalizedIp) ||
    /^169\.254\./.test(normalizedIp) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalizedIp) ||
    /^192\.168\./.test(normalizedIp)
  );
};

const isPublicIp = (ip) => {
  const normalizedIp = normalizeIp(ip);
  return !!normalizedIp && !isPrivateIp(normalizedIp);
};

/**
 * Extract the client IP, honoring common reverse-proxy headers.
 * If several addresses are present, prefer the first public address.
 */
const getRealIp = (req) => {
  const candidates = [];

  addHeaderIps(candidates, req.headers["cf-connecting-ip"]);
  addHeaderIps(candidates, req.headers["true-client-ip"]);
  addHeaderIps(candidates, req.headers["x-real-ip"]);
  addHeaderIps(candidates, req.headers["x-client-ip"]);
  addForwardedHeaderIps(candidates, req.headers.forwarded);
  addHeaderIps(candidates, req.headers["x-forwarded-for"]);

  if (Array.isArray(req.ips)) {
    req.ips.forEach((ip) => addCandidateIp(candidates, ip));
  }

  addCandidateIp(candidates, req.ip);
  addCandidateIp(candidates, req.socket?.remoteAddress);

  return candidates.find(isPublicIp) || candidates[0] || null;
};

// IP geolocation via ip-api.com

/**
 * Resolve an IP address to city/country/lat/lon.
 * Returns null on any failure so logging is never blocked.
 */
const fetchIpLocation = (ip) =>
  new Promise((resolve) => {
    const fields = [
      "status",
      "message",
      "query",
      "country",
      "region",
      "regionName",
      "city",
      "lat",
      "lon",
    ].join(",");

    // Private/local IPs cannot be geolocated. The empty lookup lets ip-api
    // detect the request's public outbound IP and return that location.
    const ipPath = isPrivateIp(ip)
      ? `/json/?fields=${fields}`
      : `/json/${encodeURIComponent(ip)}?fields=${fields}`;

    const options = {
      hostname: "ip-api.com",
      path: ipPath,
      method: "GET",
      timeout: 3000,
    };

    const request = http.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.status === "success") {
            const latitude = parsed.lat ?? null;
            const longitude = parsed.lon ?? null;
            return resolve({
              ip: normalizeIp(parsed.query) || null,
              city: parsed.city || null,
              region: parsed.regionName || null,
              region_code: parsed.region || null,
              country: parsed.country || null,
              latitude,
              longitude,
              map_url:
                latitude !== null && longitude !== null
                  ? `https://www.google.com/maps?q=${latitude},${longitude}`
                  : null,
            });
          }
          resolve(null);
        } catch {
          resolve(null);
        }
      });
    });

    request.on("error", () => resolve(null));
    request.on("timeout", () => { request.destroy(); resolve(null); });
    request.end();
  });

const resolveAuditIp = (requestIp, ipLocation) => {
  if (isPublicIp(requestIp)) return normalizeIp(requestIp);
  return normalizeIp(ipLocation?.ip) || normalizeIp(requestIp);
};

const getAddressCity = (address = {}) =>
  address.city ||
  address.town ||
  address.village ||
  address.municipality ||
  address.suburb ||
  address.county ||
  null;

const getAddressRegion = (address = {}) =>
  address.state ||
  address.region ||
  address.province ||
  address.governorate ||
  address.state_district ||
  address.county ||
  null;

const reverseGeocodeClientLocation = (clientLocation) =>
  new Promise((resolve) => {
    if (!clientLocation) return resolve(null);

    const latitude = encodeURIComponent(clientLocation.latitude);
    const longitude = encodeURIComponent(clientLocation.longitude);
    const path = `/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`;

    const request = https.request(
      {
        hostname: "nominatim.openstreetmap.org",
        path,
        method: "GET",
        timeout: 3000,
        headers: {
          "User-Agent": "ClynkAuditLogger/1.0",
          Accept: "application/json",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            const address = parsed.address || {};

            resolve({
              city: getAddressCity(address),
              region: getAddressRegion(address),
              country: address.country || null,
              display_name: parsed.display_name || null,
            });
          } catch {
            resolve(null);
          }
        });
      },
    );

    request.on("error", () => resolve(null));
    request.on("timeout", () => { request.destroy(); resolve(null); });
    request.end();
  });

const buildIpLocation = (ipLocation, clientLocation, coordinateLocation) => {
  if (!clientLocation) return ipLocation;

  return {
    ip: ipLocation?.ip || null,
    city: clientLocation.city || coordinateLocation?.city || ipLocation?.city || null,
    region: clientLocation.region || coordinateLocation?.region || ipLocation?.region || null,
    region_code: ipLocation?.region_code || null,
    country: clientLocation.country || coordinateLocation?.country || ipLocation?.country || null,
    latitude: clientLocation.latitude,
    longitude: clientLocation.longitude,
    map_url: clientLocation.map_url,
    display_name: coordinateLocation?.display_name || null,
    source: "client_gps",
  };
};

// Actor identity resolution

/**
 * Fetch the actor's display name from the relevant profile table.
 * Returns null if the query fails or the user type is unknown.
 */
const fetchActorName = async (user) => {
  if (!user?.user_id) return null;

  try {
    let result;

    switch (user.user_type) {
      case "patient":
        result = await sql.query`
          SELECT full_name FROM dbo.Patients WHERE user_id = ${user.user_id};
        `;
        break;

      case "doctor":
        result = await sql.query`
          SELECT full_name FROM dbo.Doctors WHERE user_id = ${user.user_id};
        `;
        break;

      case "staff":
        result = await sql.query`
          SELECT full_name FROM dbo.Staff WHERE user_id = ${user.user_id};
        `;
        break;

      case "admin":
        result = await sql.query`
          SELECT full_name FROM dbo.Admins WHERE user_id = ${user.user_id};
        `;
        break;

      case "clinic":
        result = await sql.query`
          SELECT name AS full_name FROM dbo.Clinics
          WHERE owner_user_id = ${user.user_id};
        `;
        break;

      default:
        return null;
    }

    return result?.recordset?.[0]?.full_name || null;
  } catch {
    return null;
  }
};

// Client-provided GPS location

/**
 * Read precise GPS coordinates that the client can optionally send via headers.
 * Headers: X-Client-Latitude and X-Client-Longitude
 * Returns a full ip_location object (with map_url) or null if headers are missing/invalid.
 */
const getClientProvidedLocation = (req) => {
  const rawLat = req.headers["x-client-latitude"];
  const rawLon = req.headers["x-client-longitude"];

  if (!rawLat || !rawLon) return null;

  const latitude = parseFloat(rawLat);
  const longitude = parseFloat(rawLon);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return null;
  }

  return {
    city: req.headers["x-client-city"] || null,
    region: req.headers["x-client-region"] || null,
    country: req.headers["x-client-country"] || null,
    latitude,
    longitude,
    map_url: `https://www.google.com/maps?q=${latitude},${longitude}`,
    source: "client_gps",
  };
};

// Middleware

module.exports = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    // Only audit routes under /api
    if (!req.originalUrl.startsWith("/api")) return;

    // Fire-and-forget; never block or delay the response.
    (async () => {
      const requestIp = getRealIp(req);

      // Prefer client-provided GPS over approximate IP geolocation
      const clientLocation = getClientProvidedLocation(req);

      const [resolvedIpLocation, actorName, coordinateLocation] = await Promise.all([
        fetchIpLocation(requestIp),
        fetchActorName(req.user),
        reverseGeocodeClientLocation(clientLocation),
      ]);
      const ipLocation = buildIpLocation(
        resolvedIpLocation,
        clientLocation,
        coordinateLocation,
      );
      const ip = resolveAuditIp(requestIp, resolvedIpLocation);

      const isAuthenticated = !!req.user;

      logAuditEvent({
        event_type: "http_request",
        action: `${req.method} ${req.originalUrl}`,
        method: req.method,
        path: req.originalUrl,
        status_code: res.statusCode,
        duration_ms: Date.now() - startedAt,

        // Actor identity
        actor_user_id: req.user?.user_id || null,
        actor_name: isAuthenticated ? (actorName || null) : null,
        actor_email: req.user?.email || null,
        actor_role: req.user?.user_type || "guest",

        // Network info
        ip,
        request_ip: requestIp,
        ip_location: ipLocation,

        user_agent: req.get("user-agent") || null,
        query: sanitizeAuditBody(req.query || {}),
        body: sanitizeAuditBody(req.body || {}),
      });
    })().catch(() => {
      // Silently swallow; audit failures must never affect the API.
    });
  });

  next();
};
