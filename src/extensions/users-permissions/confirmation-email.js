'use strict';

const crypto = require('node:crypto');
const { ValidationError } = require('@strapi/utils').errors;

const USER_TABLE = 'up_users';
const TOKEN_TTL_MS = 10 * 60 * 1000;
const TOKEN_BYTES = 32;
const TOKEN_CONTEXT = 'hart-email-confirmation-v1';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function configuredOrigin(name, { required = true } = {}) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) {
    if (required) throw new Error(`${name} must be configured`);
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  const isLocalDevelopment = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && isLocalDevelopment)) {
    throw new Error(`${name} must use HTTPS`);
  }
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain credentials`);
  return parsed.origin;
}

function confirmationSecret() {
  const dedicated = String(process.env.EMAIL_CONFIRMATION_TOKEN_SECRET || '').trim();
  if (dedicated.length >= 32) return dedicated;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_CONFIRMATION_TOKEN_SECRET must contain at least 32 characters');
  }

  const developmentFallback = String(process.env.JWT_SECRET || '').trim();
  if (developmentFallback.length >= 32) return developmentFallback;
  throw new Error('EMAIL_CONFIRMATION_TOKEN_SECRET must contain at least 32 characters');
}

function digestToken(rawToken, secret = confirmationSecret()) {
  return crypto.createHmac('sha256', secret).update(TOKEN_CONTEXT).update('\0').update(rawToken).digest('hex');
}

function createConfirmationToken(secret, now = Date.now()) {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return {
    rawToken,
    digest: digestToken(rawToken, secret),
    expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
  };
}

function assertHeaderValue(value, name) {
  if (value && /[\r\n]/.test(value)) throw new Error(`${name} contains an invalid newline`);
  return value || undefined;
}

function buildConfirmationUrl(rawToken, frontendOrigin) {
  const url = new URL('/auth', frontendOrigin);
  // URL fragments are not sent to web servers, reverse proxies or referrers.
  // The frontend removes this fragment before redeeming it in a POST body.
  url.hash = new URLSearchParams({ confirmation: rawToken }).toString();
  return url.toString();
}

function buildConfirmationEmail({ firstName, confirmationUrl, frontendOrigin }) {
  const greetingName = String(firstName || '').trim();
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hello,';
  const safeGreeting = escapeHtml(greeting);
  const safeUrl = escapeHtml(confirmationUrl);
  const logoUrl = escapeHtml(new URL('/images/icon_img.png', frontendOrigin).toString());
  const subject = 'Confirm your email — Hart Curtains & Blinds';
  const text = [
    greeting,
    '',
    'Thanks for creating your Hart Curtains & Blinds account.',
    'Confirm your email address using the secure link below:',
    confirmationUrl,
    '',
    'This link expires in 10 minutes and can only be used once.',
    'If you did not create this account, you can safely ignore this email.',
    '',
    'Hart Curtains & Blinds',
    'Made-to-measure curtains, blinds and cushions.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#F5F5F5;color:#262626;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Confirm your Hart Curtains &amp; Blinds account. This secure link expires in 10 minutes.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F5F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E5E5E5;border-radius:16px;overflow:hidden;">
        <tr><td align="center" style="padding:30px 32px 22px;border-top:6px solid #6B7C4E;">
          <img src="${logoUrl}" width="72" height="72" alt="Hart Curtains and Blinds" style="display:block;width:72px;height:72px;object-fit:contain;border:0;margin:0 auto 10px;">
          <div style="font-size:23px;font-weight:600;line-height:1.25;letter-spacing:3px;"><span style="color:#6B7C4E;">Hart</span><span style="color:#4A4A4A;"> Curtains &amp; Blinds</span></div>
        </td></tr>
        <tr><td style="padding:8px 40px 36px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#404040;">${safeGreeting}</p>
          <h1 style="margin:0 0 14px;font-size:28px;line-height:1.25;color:#232D19;">Confirm your email</h1>
          <p style="margin:0 0 26px;font-size:16px;line-height:1.65;color:#525252;">Thanks for creating your account. Confirm your email address to securely access your details, quotes and orders.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 26px;"><tr><td bgcolor="#4A5A3A" style="border-radius:8px;"><a href="${safeUrl}" style="display:inline-block;padding:14px 24px;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:700;line-height:1.2;">Confirm email address</a></td></tr></table>
          <div style="padding:16px 18px;background:#F0F4ED;border-left:4px solid #6B7C4E;border-radius:6px;color:#404040;font-size:14px;line-height:1.55;">For your security, this link expires in <strong>10 minutes</strong> and can only be used once.</div>
          <p style="margin:24px 0 8px;font-size:13px;line-height:1.55;color:#737373;">If the button does not work, copy and paste this link into your browser:</p>
          <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safeUrl}" style="color:#4A5A3A;">${safeUrl}</a></p>
        </td></tr>
        <tr><td style="padding:22px 40px;background:#FAFAFA;border-top:1px solid #E5E5E5;text-align:center;color:#737373;font-size:12px;line-height:1.6;">If you did not create this account, you can safely ignore this email.<br><strong style="color:#4A4A4A;">Made-to-measure curtains, blinds and cushions.</strong></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}

function updatedRowCount(result) {
  if (typeof result === 'number') return result;
  if (Array.isArray(result)) return result.length;
  return Number(result?.rowCount || result?.affectedRows || 0);
}

async function consumeConfirmationToken(knex, rawToken, secret = confirmationSecret(), now = new Date()) {
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 256) return false;
  const digest = digestToken(rawToken, secret);
  const result = await knex(USER_TABLE)
    .where({ confirmation_token: digest, confirmed: false })
    .andWhere('confirmation_token_expires_at', '>', now)
    .update({ confirmation_token: null, confirmation_token_expires_at: null, confirmed: true, updated_at: now });
  return updatedRowCount(result) === 1;
}

async function sendConfirmationEmail(strapi, user) {
  const frontendOrigin = configuredOrigin('FRONTEND_URL');
  const token = createConfirmationToken(confirmationSecret());
  await strapi.db.query('plugin::users-permissions.user').update({
    where: { id: user.id },
    data: { confirmationToken: token.digest, confirmationTokenExpiresAt: token.expiresAt },
  });

  const confirmationUrl = buildConfirmationUrl(token.rawToken, frontendOrigin);
  const message = buildConfirmationEmail({ firstName: user.firstname, confirmationUrl, frontendOrigin });
  const from = assertHeaderValue(String(process.env.EMAIL_DEFAULT_FROM || '').trim(), 'EMAIL_DEFAULT_FROM');
  const replyTo = assertHeaderValue(String(process.env.EMAIL_DEFAULT_REPLY_TO || '').trim(), 'EMAIL_DEFAULT_REPLY_TO');
  try {
    await strapi.plugin('email').service('email').send({
      to: user.email,
      ...(from ? { from } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...message,
    });
  } catch {
    // Provider errors can echo the entire payload. Never log an error object
    // that may contain the raw confirmation URL.
    strapi.log.error('Confirmation email delivery failed (provider details suppressed)');
    throw new Error('Confirmation email delivery failed');
  }
}

async function confirmEmail(ctx, strapi) {
  const frontendOrigin = configuredOrigin('FRONTEND_URL');
  if (ctx.get('origin') !== frontendOrigin) {
    throw new ValidationError('Invalid confirmation request origin');
  }
  const rawToken = ctx.request.body?.confirmation;
  const consumed = await strapi.db.connection.transaction((trx) =>
    consumeConfirmationToken(trx, rawToken),
  );
  if (!consumed) throw new ValidationError('Invalid or expired confirmation link');

  ctx.set('Cache-Control', 'no-store');
  ctx.send({ confirmed: true });
}

module.exports = {
  TOKEN_TTL_MS,
  assertHeaderValue,
  buildConfirmationEmail,
  buildConfirmationUrl,
  configuredOrigin,
  consumeConfirmationToken,
  createConfirmationToken,
  digestToken,
  escapeHtml,
  sendConfirmationEmail,
  confirmEmail,
};
