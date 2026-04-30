const nodemailer = require("nodemailer");

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

module.exports = class Email {
  constructor(user, url) {
    this.to = user.email;
    this.firstName = (user.name || user.email).trim().split(/\s+/)[0];
    this.url = url;
    this.from = process.env.EMAIL_FROM
      ? `Clynk <${process.env.EMAIL_FROM}>`
      : "Clynk";
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
    const mailOptions = {
      from: this.from,
      to: this.to,
      subject,
      text: message,
      html,
    };

    await this.newTransport().sendMail(mailOptions);
  }

  async sendPasswordReset({ expiresMinutes = 10 } = {}) {
    const escapedFirstName = escapeHtml(this.firstName);
    const escapedUrl = escapeHtml(this.url);
    const text = [
      `Hi ${this.firstName},`,
      "",
      "We received a request to reset the password for your Clynk account.",
      `Reset your password here: ${this.url}`,
      "",
      `This link expires in ${expiresMinutes} minutes. If you did not request this, you can ignore this email.`,
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px;color:#111827">Reset your Clynk password</h2>
        <p>Hi ${escapedFirstName},</p>
        <p>We received a request to reset the password for your Clynk account.</p>
        <p>
          <a href="${escapedUrl}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">
            Reset password
          </a>
        </p>
        <p>This link expires in ${expiresMinutes} minutes. If you did not request this, you can safely ignore this email.</p>
        <p style="font-size:12px;color:#6b7280;word-break:break-all">Reset link: ${escapedUrl}</p>
      </div>
    `;

    await this.send(
      "Reset your password",
      text,
      html
    );
  }

  async sendDoctorPendingVerification() {
    const escapedFirstName = escapeHtml(this.firstName);
    const text = [
      `Hi Dr. ${this.firstName},`,
      "",
      "Your Clynk doctor account has been created successfully and is now waiting for admin verification.",
      "Our admin team will review your submitted details and license information. You will be able to use verified doctor features after approval.",
      "",
      "Thank you for your patience.",
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px;color:#111827">Your doctor account is under review</h2>
        <p>Hi Dr. ${escapedFirstName},</p>
        <p>Your Clynk doctor account has been created successfully and is now waiting for admin verification.</p>
        <p>Our admin team will review your submitted details and license information. Verified doctor features become available after approval.</p>
        <div style="background:#ecfdf5;border-left:4px solid #0f766e;padding:12px 14px;margin:18px 0">
          Please wait until an admin verifies your account.
        </div>
        <p>Thank you for your patience.</p>
      </div>
    `;

    await this.send(
      "Your Clynk doctor account is waiting for verification",
      text,
      html
    );
  }
};
