'use strict';

const { enforceEmailRateLimits } = require('./users-permissions/email-rate-limit');
const { createOrderEmailDeliveryStore } = require('../api/order-email-delivery/services/email-delivery');

// `processing` is the paid-order notification. Keep the customer-facing label
// aligned with the exact Strapi workflow status.
const STATUS_LABELS = Object.freeze({
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
});

const STATUS_EMAIL_TYPES = Object.freeze({
  pending: 'order_received',
  processing: 'order_confirmation',
  shipped: 'order_shipped',
  delivered: 'order_delivered',
  cancelled: 'order_cancelled',
});

const EMAIL_TYPE_STATUSES = Object.freeze(Object.fromEntries(
  Object.entries(STATUS_EMAIL_TYPES).map(([status, emailType]) => [emailType, status]),
));

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

function emailTypeForStatus(status) {
  const normalized = normalizedStatus(status);
  return normalized ? STATUS_EMAIL_TYPES[normalized] : null;
}

function statusForEmailType(emailType) {
  return EMAIL_TYPE_STATUSES[String(emailType || '').trim().toLowerCase()] || null;
}

function buildOrderStatusEmail({ firstName, orderNumber: number, status, frontendOrigin }) {
  const label = STATUS_LABELS[status] || status;
  const greetingName = String(firstName || '').trim();
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hello,';
  const safeGreeting = escapeHtml(greeting);
  const safeNumber = escapeHtml(number);
  const safeLabel = escapeHtml(label);
  const dashboardUrl = escapeHtml(new URL('/user/dashboard', frontendOrigin).toString());
  const statusDescription = status === 'processing'
    ? 'We have received your payment and your order is now being processed.'
    : `Your Hart Curtains & Blinds order ${number} is now: ${label}.`;
  const safeStatusDescription = escapeHtml(statusDescription);
  const subject = `Order ${number}: ${label} — Hart Curtains & Blinds`;
  const text = [
    greeting,
    '',
    statusDescription,
    `View your order: ${new URL('/user/dashboard', frontendOrigin).toString()}`,
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
      <tr><td style="padding:8px 40px 36px;"><p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#404040;">${safeGreeting}</p><h1 style="margin:0 0 14px;font-size:28px;line-height:1.25;color:#232D19;">Order update</h1><p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:#525252;">${safeStatusDescription}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 26px;"><tr><td bgcolor="#4A5A3A" style="border-radius:8px;"><a href="${dashboardUrl}" style="display:inline-block;padding:14px 24px;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:700;line-height:1.2;">View your order</a></td></tr></table></td></tr>
      <tr><td style="padding:22px 40px;background:#FAFAFA;border-top:1px solid #E5E5E5;text-align:center;color:#737373;font-size:12px;line-height:1.6;"><strong style="color:#4A4A4A;">Made-to-measure curtains, blinds and cushions.</strong></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
}

async function deliverClaimedOrderEmail(strapi, store, row, order, status, ctx = null) {
  const email = typeof order?.customerEmail === 'string'
    ? order.customerEmail.trim().toLowerCase()
    : '';
  try {
    if (!email) throw new Error('missing_recipient');
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
      status,
      frontendOrigin,
    });
    await strapi.plugin('email').service('email').send({
      to: email,
      ...message,
    });
    const marked = await store.markSent({ id: row.id, claimToken: row.claim_token || row.claimToken });
    return { sent: marked.result === 'sent' || marked.result === 'already_sent', result: marked.result };
  } catch (error) {
    await store.markFailure({ id: row.id, claimToken: row.claim_token || row.claimToken, error });
    strapi?.log?.error?.('Order status email delivery failed (details suppressed)');
    return { sent: false, reason: error?.name || 'delivery_failed' };
  }
}

/**
 * Create one durable intent per order/status and deliver it after the caller
 * has committed the authoritative order transition. Email state never changes
 * payment truth and can be retried independently.
 */
async function sendOrderStatusEmail(strapi, order, previousStatus, nextStatus, ctx = null) {
  const previous = normalizedStatus(previousStatus);
  const next = normalizedStatus(nextStatus);
  const email = typeof order?.customerEmail === 'string'
    ? order.customerEmail.trim().toLowerCase()
    : '';
  const number = orderNumber(order?.orderNumber || order?.order_number);
  const emailType = emailTypeForStatus(next);
  if (!email || !number || !next || !emailType || previous === next) {
    return { sent: false, reason: 'not_applicable' };
  }

  try {
    const store = createOrderEmailDeliveryStore(strapi.db.connection);
    const intent = await store.ensureIntent({ orderNumber: number, emailType });
    if (intent.result !== 'ready') return { sent: false, reason: intent.result };
    const claim = await store.claim({ orderNumber: number, emailType, deliveryId: intent.row.id });
    if (claim.result !== 'claimed') {
      return { sent: claim.result === 'already_sent', reason: claim.result };
    }
    return deliverClaimedOrderEmail(strapi, store, claim.row, order, next, ctx);
  } catch (error) {
    strapi?.log?.error?.('Order status email ledger operation failed (details suppressed)');
    return { sent: false, reason: error?.name || 'ledger_failed' };
  }
}

async function retryOrderStatusEmails(strapi, { limit = 25 } = {}) {
  const store = createOrderEmailDeliveryStore(strapi.db.connection);
  const candidates = await store.listRetryable({ limit });
  const results = { scanned: candidates.length, sent: 0, failed: 0, skipped: 0 };
  for (const candidate of candidates) {
    const status = statusForEmailType(candidate.email_type);
    if (!status) {
      results.skipped += 1;
      continue;
    }
    const claim = await store.claim({ emailType: candidate.email_type, deliveryId: candidate.id });
    if (claim.result !== 'claimed') {
      results.skipped += 1;
      continue;
    }
    const matches = await strapi.entityService.findMany('api::order.order', {
      filters: { orderNumber: { $eq: candidate.order_number } },
      limit: 1,
    });
    const order = Array.isArray(matches) ? matches[0] : null;
    if (!order) {
      await store.markFailure({ id: claim.row.id, claimToken: claim.claimToken, error: new Error('order_not_found') });
      results.failed += 1;
      continue;
    }
    const delivered = await deliverClaimedOrderEmail(strapi, store, claim.row, order, status);
    if (delivered.sent) results.sent += 1;
    else results.failed += 1;
  }
  return results;
}

module.exports = {
  STATUS_LABELS,
  STATUS_EMAIL_TYPES,
  EMAIL_TYPE_STATUSES,
  buildOrderStatusEmail,
  emailTypeForStatus,
  sendOrderStatusEmail,
  retryOrderStatusEmails,
};
