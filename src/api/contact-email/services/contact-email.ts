import { enforceEmailRateLimits } from '../../../extensions/users-permissions/email-rate-limit';

export const CONTACT_EMAIL_RECIPIENT = 'hartcurtains@gmail.com';
export const CONTACT_EMAIL_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'subject', 'message'] as const;
export const CONTACT_EMAIL_SUBJECTS = ['', 'consultation', 'general', 'order', 'other'] as const;

const SUBJECT_LABELS: Record<typeof CONTACT_EMAIL_SUBJECTS[number], string> = {
  '': 'General enquiry',
  consultation: 'Home consultation or measuring',
  general: 'A question about our products',
  order: 'An existing order',
  other: 'Other',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER_INJECTION_PATTERN = /[\r\n]/;

export type ContactEmailPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  subject: typeof CONTACT_EMAIL_SUBJECTS[number];
  message: string;
};

export class ContactEmailValidationError extends Error {
  constructor() {
    super('Invalid contact request');
    this.name = 'ContactEmailValidationError';
  }
}

export class ContactEmailDeliveryError extends Error {
  constructor() {
    super('Contact email delivery failed');
    this.name = 'ContactEmailDeliveryError';
  }
}

function invalid(): never {
  throw new ContactEmailValidationError();
}

function singleLine(value: unknown, maxLength: number, required = true): string {
  if (typeof value !== 'string' || HEADER_INJECTION_PATTERN.test(value)) return invalid();
  const normalized = value.trim().replace(/[ \t]+/g, ' ');
  if (normalized.length > maxLength || (required && normalized.length === 0)) return invalid();
  return normalized;
}

function messageValue(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized || normalized.length > 5000) return invalid();
  return normalized;
}

export function validateContactEmailPayload(input: unknown): ContactEmailPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();

  const keys = Object.keys(input);
  const requiredFields = ['firstName', 'lastName', 'email', 'subject', 'message'];
  if (keys.some((key) => !CONTACT_EMAIL_FIELDS.includes(key as typeof CONTACT_EMAIL_FIELDS[number]))
    || requiredFields.some((key) => !keys.includes(key))) {
    return invalid();
  }

  const body = input as Record<string, unknown>;
  const firstName = singleLine(body.firstName, 100);
  const lastName = singleLine(body.lastName, 100);
  const email = singleLine(body.email, 254).toLowerCase();
  const phone = body.phone === undefined ? '' : singleLine(body.phone, 50, false);
  const subject = singleLine(body.subject, 32, false) as ContactEmailPayload['subject'];
  const message = messageValue(body.message);

  if (!EMAIL_PATTERN.test(email) || !CONTACT_EMAIL_SUBJECTS.includes(subject)) return invalid();

  return { firstName, lastName, email, phone, subject, message };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function configuredFrom(): string | undefined {
  const value = String(process.env.EMAIL_DEFAULT_FROM || '').trim();
  if (!value) return undefined;
  if (HEADER_INJECTION_PATTERN.test(value)) throw new ContactEmailDeliveryError();
  return value;
}

export function buildContactEmail(payload: ContactEmailPayload) {
  const label = SUBJECT_LABELS[payload.subject];
  const subject = `Website enquiry: ${label}`;
  const phoneLine = payload.phone ? `Phone: ${payload.phone}` : null;
  const text = [
    `Name: ${payload.firstName} ${payload.lastName}`,
    `Email: ${payload.email}`,
    phoneLine,
    `Subject: ${label}`,
    '',
    payload.message,
  ].filter((line): line is string => line !== null).join('\n');
  const safeSubject = escapeHtml(subject);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safeSubject}</title></head><body><h1>${safeSubject}</h1><p><strong>Name:</strong> ${escapeHtml(payload.firstName)} ${escapeHtml(payload.lastName)}</p><p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>${payload.phone ? `<p><strong>Phone:</strong> ${escapeHtml(payload.phone)}</p>` : ''}<p><strong>Subject:</strong> ${escapeHtml(label)}</p><p><strong>Message:</strong><br>${escapeHtml(payload.message).replace(/\n/g, '<br>')}</p></body></html>`;
  return { subject, text, html };
}

export async function sendContactEmail(strapi: any, ctx: any, input: unknown) {
  const payload = validateContactEmailPayload(input);

  // The fixed business recipient is deliberately used for every budget key;
  // the customer email is only a validated reply-to address.
  await enforceEmailRateLimits(strapi, ctx, CONTACT_EMAIL_RECIPIENT);

  const message = buildContactEmail(payload);
  try {
    const from = configuredFrom();
    await strapi.plugin('email').service('email').send({
      to: CONTACT_EMAIL_RECIPIENT,
      ...(from ? { from } : {}),
      replyTo: payload.email,
      ...message,
    });
  } catch {
    strapi?.log?.error?.('Contact email delivery failed (provider details suppressed)');
    throw new ContactEmailDeliveryError();
  }

  return { ok: true } as const;
}
