'use strict';

const crypto = require('node:crypto');
const { ValidationError } = require('@strapi/utils').errors;
const {
  assertHeaderValue,
  configuredOrigin,
  escapeHtml,
} = require('./confirmation-email');

const USER_TABLE = 'up_users';
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_CONTEXT = 'hart-password-reset-v1';

function resetSecret() {
  const value = String(process.env.PASSWORD_RESET_TOKEN_SECRET || '').trim();
  if (value.length >= 32) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PASSWORD_RESET_TOKEN_SECRET must contain at least 32 characters');
  }
  const fallback = String(process.env.EMAIL_CONFIRMATION_TOKEN_SECRET || process.env.JWT_SECRET || '').trim();
  if (fallback.length >= 32) return fallback;
  throw new Error('PASSWORD_RESET_TOKEN_SECRET must contain at least 32 characters');
}

function digestResetToken(rawToken, secret = resetSecret()) {
  return crypto.createHmac('sha256', secret).update(RESET_CONTEXT).update('\0').update(rawToken).digest('hex');
}

function createResetToken(secret, now = Date.now()) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  return {
    rawToken,
    digest: digestResetToken(rawToken, secret),
    expiresAt: new Date(now + RESET_TTL_MS).toISOString(),
  };
}

function buildResetUrl(rawToken, frontendOrigin) {
  const url = new URL('/auth/reset-password', frontendOrigin);
  url.hash = new URLSearchParams({ code: rawToken }).toString();
  return url.toString();
}

function buildResetEmail({ firstName, resetUrl, frontendOrigin }) {
  const greeting = String(firstName || '').trim() ? `Hi ${String(firstName).trim()},` : 'Hello,';
  const safeUrl = escapeHtml(resetUrl);
  const logoUrl = escapeHtml(new URL('/images/icon_img.png', frontendOrigin).toString());
  const subject = 'Reset your password — Hart Curtains & Blinds';
  const text = [
    greeting, '', 'We received a request to reset your Hart Curtains & Blinds password.',
    resetUrl, '', 'This link expires in 15 minutes and can only be used once.',
    'If you did not request this, you can safely ignore this email.', '',
    'Hart Curtains & Blinds', 'Made-to-measure curtains, blinds and cushions.',
  ].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#F5F5F5;color:#262626;font-family:Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">Reset your password. This secure link expires in 15 minutes.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F5F5F5;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E5E5E5;border-radius:16px;overflow:hidden;">
<tr><td align="center" style="padding:30px 32px 22px;border-top:6px solid #6B7C4E;"><img src="${logoUrl}" width="72" height="72" alt="Hart Curtains and Blinds" style="display:block;width:72px;height:72px;object-fit:contain;border:0;margin:0 auto 10px;"><div style="font-size:23px;font-weight:600;line-height:1.25;letter-spacing:3px;"><span style="color:#6B7C4E;">Hart</span><span style="color:#4A4A4A;"> Curtains &amp; Blinds</span></div></td></tr>
<tr><td style="padding:8px 40px 36px;"><p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#404040;">${escapeHtml(greeting)}</p><h1 style="margin:0 0 14px;font-size:28px;line-height:1.25;color:#232D19;">Reset your password</h1><p style="margin:0 0 26px;font-size:16px;line-height:1.65;color:#525252;">Use the secure button below to choose a new password for your account.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 26px;"><tr><td bgcolor="#4A5A3A" style="border-radius:8px;"><a href="${safeUrl}" style="display:inline-block;padding:14px 24px;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:700;">Reset password</a></td></tr></table>
<div style="padding:16px 18px;background:#F0F4ED;border-left:4px solid #6B7C4E;border-radius:6px;color:#404040;font-size:14px;line-height:1.55;">This link expires in <strong>15 minutes</strong> and can only be used once.</div><p style="margin:24px 0 8px;font-size:13px;color:#737373;">If the button does not work, copy and paste this link:</p><p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safeUrl}" style="color:#4A5A3A;">${safeUrl}</a></p></td></tr>
<tr><td style="padding:22px 40px;background:#FAFAFA;border-top:1px solid #E5E5E5;text-align:center;color:#737373;font-size:12px;line-height:1.6;">If you did not request this, you can safely ignore this email.<br><strong style="color:#4A4A4A;">Made-to-measure curtains, blinds and cushions.</strong></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

async function requestPasswordReset(ctx, strapi) {
  const email = typeof ctx.request.body?.email === 'string' ? ctx.request.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('A valid email address is required');
  }
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email } });
  if (user && user.blocked !== true) {
    const frontendOrigin = configuredOrigin('FRONTEND_URL');
    const token = createResetToken(resetSecret());
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { resetPasswordToken: token.digest, resetPasswordTokenExpiresAt: token.expiresAt },
    });
    const message = buildResetEmail({
      firstName: user.firstname,
      resetUrl: buildResetUrl(token.rawToken, frontendOrigin),
      frontendOrigin,
    });
    const from = assertHeaderValue(String(process.env.EMAIL_DEFAULT_FROM || '').trim(), 'EMAIL_DEFAULT_FROM');
    const replyTo = assertHeaderValue(String(process.env.EMAIL_DEFAULT_REPLY_TO || '').trim(), 'EMAIL_DEFAULT_REPLY_TO');
    try {
      await strapi.plugin('email').service('email').send({
        to: user.email, ...(from ? { from } : {}), ...(replyTo ? { replyTo } : {}), ...message,
      });
    } catch {
      strapi.log.error('Password reset email delivery failed (provider details suppressed)');
      throw new Error('Password reset email delivery failed');
    }
  }
  ctx.set('Cache-Control', 'no-store');
  ctx.send({ ok: true });
}

async function resetPassword(ctx, strapi) {
  const frontendOrigin = configuredOrigin('FRONTEND_URL');
  if (ctx.get('origin') !== frontendOrigin) throw new ValidationError('Invalid password reset request origin');
  const { code, password, passwordConfirmation } = ctx.request.body || {};
  if (typeof code !== 'string' || code.length < 32 || code.length > 256) throw new ValidationError('Invalid or expired reset link');
  if (typeof password !== 'string' || password !== passwordConfirmation) throw new ValidationError('Passwords do not match');
  if (new TextEncoder().encode(password).length > 72 || password.length < 8 ||
      !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) ||
      !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    throw new ValidationError('Password does not meet the security requirements');
  }
  const rules = strapi.config.get('plugin::users-permissions.validationRules');
  if (typeof rules?.validatePassword === 'function' && !(await rules.validatePassword(password))) {
    throw new ValidationError('Password does not meet the security requirements');
  }
  const { password: hashedPassword } = await strapi.plugin('users-permissions').service('user')
    .ensureHashedPasswords({ password });
  const digest = digestResetToken(code);
  const now = new Date();
  const updated = await strapi.db.connection.transaction((trx) => trx(USER_TABLE)
    .where({ reset_password_token: digest })
    .andWhere('reset_password_token_expires_at', '>', now)
    .update({ password: hashedPassword, reset_password_token: null, reset_password_token_expires_at: null, updated_at: now }));
  const count = typeof updated === 'number' ? updated : Array.isArray(updated) ? updated.length : Number(updated?.rowCount || updated?.affectedRows || 0);
  if (count !== 1) throw new ValidationError('Invalid or expired reset link');
  ctx.set('Cache-Control', 'no-store');
  ctx.send({ reset: true });
}

module.exports = {
  RESET_TTL_MS, buildResetEmail, buildResetUrl, createResetToken, digestResetToken,
  requestPasswordReset, resetPassword,
};
