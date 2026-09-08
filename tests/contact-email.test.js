'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// `npm test` compiles the Strapi TypeScript sources to dist before loading tests.
const service = require('../dist/src/api/contact-email/services/contact-email');
const controller = require('../dist/src/api/contact-email/controllers/contact-email').default;
const securityPolicy = require('../dist/src/policies/security-internal-auth').default;
const prebody = require('../dist/src/middlewares/contact-email-prebody-limit').handler;

const INTERNAL_SECRET = 'contact-email-test-internal-secret';
const validPayload = {
  firstName: 'Alex',
  lastName: 'Customer',
  email: 'alex@example.com',
  phone: '01234567890',
  subject: 'general',
  message: 'Please advise on curtains for a living room.',
};

function allowingStore() {
  return { async checkRateLimit() { return { allowed: true, remaining: 1, resetTime: Date.now() + 60_000 }; } };
}

function makeStrapi({ store = allowingStore(), send = async () => {} } = {}) {
  const sent = [];
  return {
    sent,
    emailRateLimitStore: store,
    log: { error() {} },
    plugin(name) {
      assert.equal(name, 'email');
      return { service(serviceName) {
        assert.equal(serviceName, 'email');
        return { async send(message) { sent.push(message); return send(message); } };
      } };
    },
  };
}

function makeContext(body = validPayload) {
  const response = { status: undefined, body: undefined, headers: {} };
  return {
    request: { body, ip: '203.0.113.10' },
    set(name, value) { response.headers[name] = value; },
    send(value) { response.status = 200; response.body = value; return value; },
    badRequest(message) { response.status = 400; response.body = { error: message }; return response.body; },
    response,
  };
}

test('valid authenticated contact request sends through the existing email service', async () => {
  process.env.STRAPI_INTERNAL_SECURITY_SECRET = INTERNAL_SECRET;
  await securityPolicy({ request: { headers: { authorization: `Bearer ${INTERNAL_SECRET}` } } });

  const strapi = makeStrapi();
  global.strapi = strapi;
  const ctx = makeContext(validPayload);
  await controller.send(ctx);

  assert.equal(ctx.response.status, 200);
  assert.equal(strapi.sent.length, 1);
  assert.equal(strapi.sent[0].to, 'hartcurtains@gmail.com');
  assert.equal(strapi.sent[0].replyTo, validPayload.email);
  assert.equal(strapi.sent[0].from, undefined);
  assert.equal(strapi.sent[0].subject, 'Website enquiry: A question about our products');
  assert.match(strapi.sent[0].text, /Please advise on curtains/);
  assert.match(strapi.sent[0].html, /<strong>Name:<\/strong>/);
});

test('the internal policy rejects missing and incorrect bearer secrets', async () => {
  process.env.STRAPI_INTERNAL_SECURITY_SECRET = INTERNAL_SECRET;
  await assert.rejects(
    securityPolicy({ request: { headers: {} } }),
    (error) => error?.name === 'UnauthorizedError',
  );
  await assert.rejects(
    securityPolicy({ request: { headers: { authorization: 'Bearer wrong-secret' } } }),
    (error) => error?.name === 'UnauthorizedError',
  );
});

test('backend validation rejects malformed, unknown, injected and oversized payloads', () => {
  const invalidBodies = [
    { ...validPayload, email: 'not-an-email' },
    { ...validPayload, subject: 'attacker-controlled-subject' },
    { ...validPayload, email: 'alex@example.com\r\nBcc: attacker@example.com' },
    { ...validPayload, message: 'x'.repeat(5001) },
    { ...validPayload, recipient: 'attacker@example.com' },
  ];
  for (const body of invalidBodies) {
    assert.throws(() => service.validateContactEmailPayload(body), /Invalid contact request/);
  }
  assert.equal(service.validateContactEmailPayload({ ...validPayload, phone: undefined }).phone, '');
});

test('email rendering escapes every user value and produces text and html bodies', () => {
  const payload = service.validateContactEmailPayload({
    ...validPayload,
    firstName: '<Alex>',
    message: '<script>alert(1)</script>',
  });
  const email = service.buildContactEmail(payload);
  assert.doesNotMatch(email.html, /<Alex>/);
  assert.match(email.html, /&lt;Alex&gt;/);
  assert.doesNotMatch(email.html, /<script>alert/);
  assert.match(email.html, /&lt;script&gt;alert/);
  assert.match(email.text, /<script>alert\(1\)<\/script>/);
});

test('rate-limit rejection prevents provider invocation and uses the fixed recipient budget', async () => {
  const calls = [];
  const strapi = makeStrapi({
    store: { async checkRateLimit(input) { calls.push(input); return { allowed: false, retryAfter: 60 }; } },
  });
  await assert.rejects(service.sendContactEmail(strapi, { request: { ip: '203.0.113.11' } }, validPayload), (error) => error?.name === 'RateLimitError');
  assert.equal(strapi.sent.length, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].hashedKey, /^[0-9a-f]{64}$/);
});

test('provider failure returns a generic error without exposing provider details', async () => {
  const strapi = makeStrapi({ send: async () => { throw new Error('secret provider response'); } });
  global.strapi = strapi;
  const ctx = makeContext();
  await controller.send(ctx);
  assert.equal(ctx.response.status, 500);
  assert.deepEqual(ctx.response.body, { error: 'Unable to send contact message.' });
  assert.doesNotMatch(JSON.stringify(ctx.response.body), /secret provider response/);
});

test('route and middleware retain the internal policy and scoped body limit', () => {
  const routeSource = fs.readFileSync(path.resolve(__dirname, '../src/api/contact-email/routes/contact-email.ts'), 'utf8');
  assert.match(routeSource, /global::security-internal-auth/);
  assert.match(routeSource, /auth: false/);

  let nextCalled = false;
  const oversized = { method: 'POST', path: '/api/security-internal/contact-email', get(name) { return name === 'content-type' ? 'application/json' : '40000'; } };
  return prebody(oversized, async () => { nextCalled = true; }).then(() => {
    assert.equal(oversized.status, 413);
    assert.equal(nextCalled, false);
  });
});
