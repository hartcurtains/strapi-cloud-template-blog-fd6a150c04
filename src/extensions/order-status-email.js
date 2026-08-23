'use strict';

const { enforceEmailRateLimits } = require('./users-permissions/email-rate-limit');

const STATUS_LABELS = Object.freeze({
  pending: 'Order received',
  processing: 'Being prepared',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function configuredOrigin() {
  const raw = String(process.env.FRONTEND_URL || '').trim();
  if (!raw) throw new Error('FRONTEND_URL must be configured');
  const url = new URL(raw);
  return url.origin;
}

function normalizedStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return Object.hasOwn(STATUS_LABELS, status) ? status : null;
}

function orderNumber(value) {
  return String(value || '').trim().slice(0, 128);
}

function buildOrderStatusEmail({ firstName, orderNumber: number, status, frontendOrigin }) {
  const label = STATUS_LABELS[status] || status;
  const greetingName = String(firstName || '').trim();
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hello,';
  const safeGreeting = escapeHtml(greeting);
  const safeNumber = escapeHtml(number);
  const safeLabel = escapeHtml(label);
  const dashboardUrl = escapeHtml(new URL('/user/dashboard', frontendOrigin).toString());
  const subject = `Order ${number}: ${label} — Hart Curtains & Blinds`;
  const text = [
    greeting,
    '',
    `Your Hart Curtains & Blinds order ${number} is now: ${label}.`,
    `View your order: ${new URL('/user/dashboard', frontendOrigin).toString()}`,
    '',
    'If you have any questions, reply to this email and our team will help.',
    '',
    'Hart Curtains & Blinds',
  ].join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F5F5F5;color:#262626;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Order ${safeNumber} update: ${safeLabel}.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F5F5F5;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E5E5E5;border-radius:16px;overflow:hidden;">
      <tr><td align="center" style="padding:30px 32px 22px;border-top:6px solid #6B7C4E;"><img src="${escapeHtml(new URL('/images/icon_img.png', frontendOrigin).toString())}" width="72" height="72" alt="Hart Curtains and Blinds" style="display:block;width:72px;height:72px;object-fit:contain;border:0;margin:0 auto 10px;"><div style="font-size:23px;font-weight:600;line-height:1.25;letter-spacing:3px;"><span style="color:#6B7C4E;">Hart</span><span style="color:#4A4A4A;"> Curtains &amp; Blinds</span></div></td></tr>
      <tr><td style="padding:8px 40px 36px;"><p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#404040;">${safeGreeting}</p><h1 style="margin:0 0 14px;font-size:28px;line-height:1.25;color:#232D19;">Order update</h1><p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:#525252;">Order <strong>${safeNumber}</strong> is now <strong>${safeLabel}</strong>.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 26px;"><tr><td bgcolor="#4A5A3A" style="border-radius:8px;"><a href="${dashboardUrl}" style="display:inline-block;padding:14px 24px;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:700;line-height:1.2;">View your order</a></td></tr></table><p style="margin:0;font-size:14px;line-height:1.55;color:#737373;">If you have any questions, reply to this email and our team will help.</p></td></tr>
      <tr><td style="padding:22px 40px;background:#FAFAFA;border-top:1px solid #E5E5E5;text-align:center;color:#737373;font-size:12px;line-height:1.6;"><strong style="color:#4A4A4A;">Made-to-measure curtains, blinds and cushions.</strong></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
}

/**
 * Send a best-effort status notification after a committed order transition.
 * Email failure never rolls back the order state; the transition is the
 * authoritative operation and is already protected by its own policy.
 */
async function sendOrderStatusEmail(strapi, order, previousStatus, nextStatus, ctx = null) {
  const previous = normalizedStatus(previousStatus);
  const next = normalizedStatus(nextStatus);
  const email = typeof order?.customerEmail === 'string'
    ? order.customerEmail.trim().toLowerCase()
    : '';
  if (!email || !next || previous === next) return { sent: false, reason: 'not_applicable' };

  try {
    await enforceEmailRateLimits(
      strapi,
      ctx || { request: { ip: 'internal:order-status' } },
      email,
    );
    const frontendOrigin = configuredOrigin();
    const firstName = String(order.customerName || '').trim().split(/\s+/)[0] || '';
    const message = buildOrderStatusEmail({
      firstName,
      orderNumber: orderNumber(order.orderNumber || order.order_number),
      status: next,
      frontendOrigin,
    });
    await strapi.plugin('email').service('email').send({
      to: email,
      ...message,
    });
    return { sent: true };
  } catch (error) {
    strapi?.log?.error?.('Order status email delivery failed (details suppressed)');
    return { sent: false, reason: error?.name || 'delivery_failed' };
  }
}

module.exports = {
  STATUS_LABELS,
  buildOrderStatusEmail,
  sendOrderStatusEmail,
};
