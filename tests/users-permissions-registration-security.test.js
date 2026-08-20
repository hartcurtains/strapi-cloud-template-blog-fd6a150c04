const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extendUsersPermissions = require('../src/extensions/users-permissions/strapi-server');
const { emailRateLimitChecks, enforceEmailRateLimits } = require('../src/extensions/users-permissions/email-rate-limit');
const {
  TOKEN_TTL_MS,
  buildConfirmationEmail,
  buildConfirmationUrl,
  consumeConfirmationToken,
  createConfirmationToken,
  digestToken,
} = require('../src/extensions/users-permissions/confirmation-email');
const {
  RESET_TTL_MS,
  buildResetEmail,
  buildResetUrl,
  createResetToken,
  digestResetToken,
} = require('../src/extensions/users-permissions/password-reset-email');

const allowingEmailRateLimitStore = {
  async checkRateLimit() {
    return { allowed: true, remaining: 1, resetTime: Date.now() + 60_000 };
  },
};

function makePlugin(register) {
  return {
    services: { user: () => ({}) },
    routes: { 'content-api': () => [] },
    controllers: {
      auth: () => ({ register }),
      user: {},
    },
  };
}

test('registration delegates to Strapi without privileged fields or an immediate JWT', async () => {
  let delegatedBody;
  const plugin = extendUsersPermissions(makePlugin(async (ctx) => {
    delegatedBody = ctx.request.body;
    return ctx.send({ user: { id: 7, confirmed: false } });
  }));
  const sent = [];
  const controller = plugin.controllers.auth({
    strapi: { log: { warn() {}, error() {} }, emailRateLimitStore: allowingEmailRateLimitStore },
  });
  const ctx = {
    request: {
      body: {
        username: 'account-7',
        email: ' Owner@Example.test ',
        password: 'Example1!',
        firstname: '  First ',
        lastname: ' Last  ',
        gdprConsent: true,
        termsAccepted: true,
      },
    },
    send(value) {
      sent.push(value);
      return value;
    },
  };

  await controller.register(ctx);

  assert.equal(delegatedBody.email, 'owner@example.test');
  assert.equal(delegatedBody.firstname, 'First');
  assert.equal(delegatedBody.lastname, 'Last');
  assert.equal(delegatedBody.gdprConsent, true);
  assert.equal(Object.hasOwn(delegatedBody, 'confirmed'), false);
  assert.equal(Object.hasOwn(delegatedBody, 'role'), false);
  assert.equal(Object.hasOwn(sent[0], 'jwt'), false);
});

test('registration rejects attempts to set account authority fields', async () => {
  let delegated = false;
  const plugin = extendUsersPermissions(makePlugin(async () => {
    delegated = true;
  }));
  const controller = plugin.controllers.auth({
    strapi: { log: { warn() {}, error() {} }, emailRateLimitStore: allowingEmailRateLimitStore },
  });

  await assert.rejects(
    controller.register({
      request: {
        body: {
          username: 'account-7',
          email: 'owner@example.test',
          password: 'Example1!',
          firstname: 'First',
          lastname: 'Last',
          gdprConsent: true,
          termsAccepted: true,
          confirmed: true,
        },
      },
    }),
    /Privileged account fields/,
  );
  assert.equal(delegated, false);
});

test('startup and frontend retain the email-confirmation fail-closed controls', () => {
  const backendEntry = fs.readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8');
  const frontendAuth = fs.readFileSync(path.resolve(__dirname, '../../src/lib/authOptions.ts'), 'utf8');
  const frontendRegister = fs.readFileSync(path.resolve(__dirname, '../../src/app/api/auth/register/route.ts'), 'utf8');

  assert.match(backendEntry, /email_confirmation:\s*true/);
  assert.match(frontendAuth, /isConfirmedActiveUser\(userData\)/);
  assert.match(frontendRegister, /if \(!data\.user \|\| data\.jwt\)/);
  assert.doesNotMatch(frontendRegister, /NextResponse\.json\(\{\s*jwt\s*:/s);
});

test('email throttling applies global, IP and recipient budgets without storing raw identifiers', async () => {
  const calls = [];
  const store = {
    async checkRateLimit(input) {
      calls.push(input);
      return { allowed: true, remaining: 1, resetTime: Date.now() + 60_000 };
    },
  };
  const ctx = { request: { ip: '203.0.113.10' } };

  await enforceEmailRateLimits({ log: { error() {} } }, ctx, ' Owner@Example.test ', store);

  assert.deepEqual(calls.map((call) => call.actionCategory), [
    'email-global-minute', 'email-global-hour', 'email-global-day',
    'email-ip-hour', 'email-recipient-hour', 'email-recipient-day',
  ]);
  assert.equal(calls.every((call) => /^[0-9a-f]{64}$/.test(call.hashedKey)), true);
  assert.equal(JSON.stringify(calls).includes('owner@example.test'), false);
  assert.equal(emailRateLimitChecks(ctx, 'owner@example.test').length, 6);
});

test('email throttling returns a rate-limit error and fails closed on persistence errors', async () => {
  await assert.rejects(
    enforceEmailRateLimits(
      { log: { error() {} } },
      { request: { ip: '203.0.113.10' } },
      'owner@example.test',
      { async checkRateLimit() { return { allowed: false, retryAfter: 60 }; } },
    ),
    (error) => error?.name === 'RateLimitError',
  );

  await assert.rejects(
    enforceEmailRateLimits(
      { log: { error() {} } },
      { request: { ip: '203.0.113.10' } },
      'owner@example.test',
      { async checkRateLimit() { throw new Error('database unavailable'); } },
    ),
    (error) => error?.name === 'RateLimitError',
  );
});

test('forgot-password and confirmation-resend cannot bypass the durable email budget', async () => {
  const delegated = { forgot: 0, resend: 0 };
  const plugin = extendUsersPermissions({
    services: { user: () => ({}) },
    routes: { 'content-api': () => [] },
    controllers: {
      auth: () => ({
        async register() {},
        async forgotPassword() { delegated.forgot += 1; },
        async sendEmailConfirmation() { delegated.resend += 1; },
      }),
      user: {},
    },
  });
  const controller = plugin.controllers.auth({
    strapi: {
      log: { warn() {}, error() {} },
      emailRateLimitStore: {
        async checkRateLimit() { return { allowed: false, retryAfter: 60 }; },
      },
    },
  });
  const ctx = { request: { ip: '203.0.113.10', body: { email: 'owner@example.test' } }, set() {} };

  await assert.rejects(controller.forgotPassword(ctx), (error) => error?.name === 'RateLimitError');
  await assert.rejects(controller.sendEmailConfirmation(ctx), (error) => error?.name === 'RateLimitError');
  assert.deepEqual(delegated, { forgot: 0, resend: 0 });
});

test('confirmation tokens are random, HMAC-protected and expire after ten minutes', () => {
  const secret = 'test-only-secret-with-at-least-32-characters';
  const now = Date.UTC(2026, 7, 19, 12, 0, 0);
  const first = createConfirmationToken(secret, now);
  const second = createConfirmationToken(secret, now);

  assert.notEqual(first.rawToken, second.rawToken);
  assert.match(first.rawToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.digest, /^[0-9a-f]{64}$/);
  assert.equal(first.digest, digestToken(first.rawToken, secret));
  assert.equal(first.digest.includes(first.rawToken), false);
  assert.equal(Date.parse(first.expiresAt) - now, TOKEN_TTL_MS);
  assert.equal(TOKEN_TTL_MS, 10 * 60 * 1000);
});

test('confirmation redemption is one atomic, expiring, one-time database update', async () => {
  const calls = [];
  const knex = () => ({
    where(value) { calls.push(['where', value]); return this; },
    andWhere(...value) { calls.push(['andWhere', value]); return this; },
    async update(value) { calls.push(['update', value]); return 1; },
  });
  const secret = 'test-only-secret-with-at-least-32-characters';
  const consumed = await consumeConfirmationToken(
    knex,
    'valid-test-token-that-is-long-enough-to-accept',
    secret,
    new Date('2026-08-19T12:00:00.000Z'),
  );

  assert.equal(consumed, true);
  assert.match(calls[0][1].confirmation_token, /^[0-9a-f]{64}$/);
  assert.equal(calls[0][1].confirmed, false);
  assert.deepEqual(calls[1], ['andWhere', ['confirmation_token_expires_at', '>', new Date('2026-08-19T12:00:00.000Z')]]);
  assert.equal(calls[2][1].confirmed, true);
  assert.equal(calls[2][1].confirmation_token, null);
  assert.equal(calls[2][1].confirmation_token_expires_at, null);
});

test('branded email uses the homepage logo, accessible brand palette and a plain-text fallback', () => {
  const confirmationUrl = 'https://www.example.test/auth#confirmation=secret-token';
  const email = buildConfirmationEmail({
    firstName: '<Customer>',
    confirmationUrl,
    frontendOrigin: 'https://www.example.test',
  });

  assert.match(email.subject, /Hart Curtains & Blinds/);
  assert.match(email.html, /https:\/\/www\.example\.test\/images\/icon_img\.png/);
  assert.match(email.html, /#6B7C4E/);
  assert.match(email.html, /#4A4A4A/);
  assert.match(email.html, /expires in <strong>10 minutes<\/strong>/);
  assert.doesNotMatch(email.html, /<Customer>/);
  assert.match(email.html, /&lt;Customer&gt;/);
  assert.match(email.text, /This link expires in 10 minutes and can only be used once/);
  assert.match(email.text, new RegExp(confirmationUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('email links keep raw tokens out of HTTP request URLs and confirmation is POST-only', () => {
  const link = new URL(buildConfirmationUrl('secret-token', 'https://www.example.test'));
  assert.equal(link.origin, 'https://www.example.test');
  assert.equal(link.pathname, '/auth');
  assert.equal(link.search, '');
  assert.equal(link.hash, '#confirmation=secret-token');

  const plugin = extendUsersPermissions({
    services: { user: () => ({}) },
    controllers: { auth: () => ({ register() {} }), user: {} },
    routes: {
      'content-api': () => [{
        method: 'GET', path: '/auth/email-confirmation', config: {},
      }],
    },
  });
  const [route] = plugin.routes['content-api']({});
  assert.equal(route.method, 'POST');
  assert.deepEqual(route.config.middlewares, ['plugin::users-permissions.rateLimit']);
});

test('email budgets remain below the published provider rate ceilings', () => {
  const { RATE_LIMITS } = require('../src/api/security-state/services/security-state');
  assert.deepEqual(RATE_LIMITS['email-global-minute'], { windowMs: 60_000, max: 8 });
  assert.deepEqual(RATE_LIMITS['email-global-hour'], { windowMs: 60 * 60_000, max: 50 });
  assert.deepEqual(RATE_LIMITS['email-global-day'], { windowMs: 24 * 60 * 60_000, max: 200 });
  assert.ok(RATE_LIMITS['email-global-minute'].max < 20);
  assert.ok(RATE_LIMITS['email-global-hour'].max < 100);
});

test('production seed data contains no customer orders, user records or password hashes', () => {
  const seed = fs.readFileSync(path.resolve(__dirname, '../database/migrations/data/entities.jsonl'), 'utf8');
  const bootstrap = fs.readFileSync(path.resolve(__dirname, '../src/bootstrap.ts'), 'utf8');
  assert.doesNotMatch(seed, /"type":"api::order\.order"/);
  assert.doesNotMatch(seed, /"type":"plugin::users-permissions\.user"/);
  assert.doesNotMatch(seed, /"password":"\$2[aby]\$/);
  assert.doesNotMatch(bootstrap, /^\s*'api::order\.order',\s*$/m);
});

test('Strapi CORS is allowlisted rather than wildcarded', () => {
  const middlewareConfig = fs.readFileSync(path.resolve(__dirname, '../config/middlewares.ts'), 'utf8');
  assert.match(middlewareConfig, /process\.env\.FRONTEND_URL/);
  assert.match(middlewareConfig, /origin:\s*corsOrigins/);
  assert.doesNotMatch(middlewareConfig, /origin:\s*['"]\*['"]/);
});

test('password-reset email is branded and its one-time token is hashed and fragment-delivered', () => {
  const secret = 'another-test-secret-with-at-least-32-characters';
  const now = Date.UTC(2026, 7, 19, 12, 0, 0);
  const token = createResetToken(secret, now);
  const link = buildResetUrl(token.rawToken, 'https://www.example.test');
  const url = new URL(link);
  const email = buildResetEmail({ firstName: 'Customer', resetUrl: link, frontendOrigin: url.origin });
  assert.equal(token.digest, digestResetToken(token.rawToken, secret));
  assert.equal(Date.parse(token.expiresAt) - now, RESET_TTL_MS);
  assert.equal(RESET_TTL_MS, 15 * 60 * 1000);
  assert.equal(url.search, '');
  assert.match(url.hash, /^#code=/);
  assert.match(email.html, /images\/icon_img\.png/);
  assert.match(email.html, /#6B7C4E/);
  assert.match(email.text, /expires in 15 minutes and can only be used once/);
});
