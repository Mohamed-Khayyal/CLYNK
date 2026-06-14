const nodemailer = require("nodemailer");

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const frontendUrl = process.env.ALLOWED_ORIGINS || "http://localhost:3000";
const logoUrl = `${frontendUrl}/logo.png`;

module.exports = class Email {
  constructor(user, url) {
    this.to = user.email;
    this.firstName = (user.name || user.email).trim().split(/\s+/)[0];
    this.url = url;

    this.from = process.env.EMAIL_FROM
      ? `Medaura <${process.env.EMAIL_FROM}>`
      : "Medaura";
  }

  newTransport() {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: Number(process.env.EMAIL_PORT) === 465,

      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  async send(subject, message, html) {
    await this.newTransport().sendMail({
      from: this.from,
      to: this.to,
      subject,
      text: message,
      html,
    });
  }

  async sendPasswordReset({ expiresMinutes = 10 } = {}) {
    const escapedFirstName = escapeHtml(this.firstName);
    const escapedUrl = escapeHtml(this.url);

    const text = [
      `Hi ${this.firstName},`,
      "",
      "We received a request to reset the password for your Medaura account.",
      `Reset your password here: ${this.url}`,
      "",
      `This link expires in ${expiresMinutes} minutes.`,
      "If you did not request this, ignore this email.",
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;padding:24px">
        <div style="margin-bottom:20px;">
          <img src="${logoUrl}" alt="Medaura Logo" style="height:40px;display:block;" />
        </div>
        <h2>Reset your Medaura password</h2>

        <p>Hi ${escapedFirstName},</p>

        <p>
          We received a request to reset your password.
        </p>

        <a
          href="${escapedUrl}"
          style="
            background:#0f766e;
            color:white;
            padding:12px 18px;
            border-radius:8px;
            text-decoration:none;
            display:inline-block;
          "
        >
          Reset Password
        </a>

        <p>
          This link expires in ${expiresMinutes} minutes.
        </p>

        <p style="font-size:12px;color:#666">
          ${escapedUrl}
        </p>
      </div>
    `;

    await this.send(
      "Reset your password",
      text,
      html
    );
  }

  async sendPasswordResetOtp({
    otpCode,
    expiresMinutes = 10,
  } = {}) {
    const escapedFirstName = escapeHtml(this.firstName);
    const escapedOtp = escapeHtml(otpCode);

    const text = [
      `Hi ${this.firstName},`,
      "",
      "Use this code to reset your password:",
      otpCode,
      "",
      `This code expires in ${expiresMinutes} minutes.`,
      "If you didn't request this, ignore this email.",
    ].join("\n");

    const html = `
      <div style="
        background:#f8fafc;
        padding:24px;
        font-family:Arial,sans-serif;
      ">

        <table
          width="100%"
          style="
            max-width:600px;
            margin:auto;
            background:white;
            border-radius:12px;
            overflow:hidden;
            border:1px solid #e2e8f0;
          "
        >

          <tr>
            <td
              style="
                background:#0f766e;
                color:white;
                padding:20px;
              "
            >
              <div style="display:flex;align-items:center;">
                <img src="${logoUrl}" alt="Medaura Logo" style="height:32px;display:inline-block;vertical-align:middle;margin-right:10px;" />
                <h2 style="margin:0;display:inline-block;vertical-align:middle;">
                  Medaura
                </h2>
              </div>

              <small style="display:block;margin-top:5px;">Password reset code</small>
            </td>
          </tr>

          <tr>
            <td style="padding:24px">

              <p>
                Hi ${escapedFirstName},
              </p>

              <p>
                Use the code below:
              </p>

              <div style="text-align:center">

                <div style="
                  display:inline-block;
                  padding:16px 22px;
                  border:1px dashed #94a3b8;
                  border-radius:10px;
                  font-size:28px;
                  letter-spacing:6px;
                  font-weight:700;
                  background:#f1f5f9;
                  color:#0f766e;
                ">
                  ${escapedOtp}
                </div>

              </div>

              <p>
                Expires in ${expiresMinutes} minutes.
              </p>

              <small style="color:#666">
                Don't share this code.
              </small>

            </td>
          </tr>

        </table>

      </div>
    `;

    await this.send(
      "Your password reset code",
      text,
      html
    );
  }

  async sendWelcome() {
    const escapedFirstName = escapeHtml(this.firstName);

    const text = [
      `Hi ${this.firstName},`,
      "",
      "Welcome to Medaura.",
      "Your account was created successfully.",
    ].join("\n");

    const html = `
      <div style="padding:24px;font-family:Arial">
        <div style="margin-bottom:20px;">
          <img src="${logoUrl}" alt="Medaura Logo" style="height:40px;display:block;" />
        </div>

        <h2>
          Welcome to Medaura
        </h2>

        <p>
          Hi ${escapedFirstName},
        </p>

        <p>
          Your account has been created successfully.
        </p>

        <p>
          You can sign in now.
        </p>

      </div>
    `;

    await this.send(
      "Welcome to Medaura",
      text,
      html
    );
  }

  async sendDoctorPendingVerification() {
    const escapedFirstName =
      escapeHtml(this.firstName);

    const text = [
      `Hi Dr. ${this.firstName},`,
      "",
      "Your account is waiting for admin verification.",
      "You can use doctor features after approval.",
    ].join("\n");

    const html = `
      <div style="padding:24px;font-family:Arial">
        <div style="margin-bottom:20px;">
          <img src="${logoUrl}" alt="Medaura Logo" style="height:40px;display:block;" />
        </div>

        <h2>
          Account under review
        </h2>

        <p>
          Hi Dr. ${escapedFirstName},
        </p>

        <p>
          Your account is waiting for verification.
        </p>

        <div style="
          background:#ecfdf5;
          border-left:4px solid #0f766e;
          padding:12px;
        ">
          Please wait for admin approval.
        </div>

      </div>
    `;

    await this.send(
      "Doctor account waiting for verification",
      text,
      html
    );
  }
};