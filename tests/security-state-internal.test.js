'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startStrapiTestApp } = require('./helpers/strapi-app');
const migration = require('../database/migrations/2026.07.27T00.00.00.security-state');
const { createSecurityStateStore } = require('../src/api/security-state/services/security-state');

const INTERNAL_SECRET = 'strapi-internal-security-test-secret';

function headers(secret = INTERNAL_SECRET) {
  return {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  };
}

function hash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function post(baseUrl, path, body, secret = INTERNAL_SECRET) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: headers(secret),
    body: JSON.stringify(body),
  });
}

test('protected Strapi security routes persist atomically and cleanly', async () => {
  const context = await startStrapiTestApp();
  try {
    const ratePath = '/api/security-internal/rate-limit/check';
    const challengeCreatePath = '/api/security-internal/account-deletion-challenge/create';
    const challengeVerifyPath = '/api/security-internal/account-deletion-challenge/verify';

    assert.equal((await post(context.baseUrl, ratePath, { hashedKey: 'a'.repeat(64), actionCategory: 'login' }, 'wrong-secret')).status, 401);
    assert.equal((await post(context.baseUrl, ratePath, { hashedKey: 'b'.repeat(64), actionCategory: 'login' })).status, 200);
    assert.equal((await post(context.baseUrl, ratePath, { hashedKey: 'f'.repeat(64), actionCategory: 'cart' })).status, 200);
    assert.equal((await post(context.baseUrl, ratePath, { hashedKey: 'g'.repeat(64), actionCategory: 'unsupported' })).status, 400);

    const rateKey = 'c'.repeat(64);
    const rateResponses = await Promise.all(Array.from({ length: 25 }, () => post(context.baseUrl, ratePath, {
      hashedKey: rateKey,
      actionCategory: 'login',
    })));
    const rateBodies = await Promise.all(rateResponses.map(response => response.json()));
    assert.equal(rateResponses.every(response => response.status === 200), true);
    assert.equal(rateBodies.filter(body => body.allowed).length, 20);
    assert.equal(rateBodies.filter(body => body.allowed === false).length, 5);

    const storedRate = await context.app.db.connection('security_states')
      .where({ kind: 'rate_limit', action_category: 'login', hashed_key: rateKey })
      .first();
    assert.equal(storedRate.request_count, 20);
    assert.match(storedRate.hashed_key, /^[0-9a-f]{64}$/);
    assert.equal(storedRate.expires_at !== null, true);

    const accountIdentifier = 'user-atomic-1';
    const codeHash = hash('keyed-code-hash');
    const createResponse = await post(context.baseUrl, challengeCreatePath, { accountIdentifier, codeHash });
    assert.equal(createResponse.status, 200);
    assert.equal((await createResponse.json()).expiresAt !== undefined, true);

    const invalidResults = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post(context.baseUrl, challengeVerifyPath, { accountIdentifier, codeHash: hash(`wrong-${attempt}`) });
      assert.equal(response.status, 200);
      invalidResults.push((await response.json()).result);
    }
    assert.deepEqual(invalidResults, ['invalid', 'invalid', 'invalid', 'invalid', 'locked']);

    const storedChallenge = await context.app.db.connection('security_states')
      .where({ kind: 'account_deletion_challenge', account_identifier: accountIdentifier })
      .first();
    assert.equal(storedChallenge.code_hash, codeHash);
    assert.equal(storedChallenge.remaining_attempts, 0);
    assert.notEqual(storedChallenge.consumed_at, null);
    assert.equal(storedChallenge.code_hash.includes('wrong-'), false);

    const recreated = await post(context.baseUrl, challengeCreatePath, { accountIdentifier, codeHash });
    assert.equal(recreated.status, 200);
    assert.equal((await (await post(context.baseUrl, challengeVerifyPath, { accountIdentifier, codeHash })).json()).result, 'valid');
    assert.equal((await (await post(context.baseUrl, challengeVerifyPath, { accountIdentifier, codeHash })).json()).result, 'invalid');

    await migration.up(context.app.db.connection);
    const rawIndexes = await context.app.db.connection.raw("PRAGMA index_list('security_states')");
    const indexRows = Array.isArray(rawIndexes) && Array.isArray(rawIndexes[0]) ? rawIndexes[0] : rawIndexes;
    const indexNames = indexRows.map(row => row.name);
    assert.equal(indexNames.includes(migration.constants.INDEXES.HASHED_KEY), true);
    assert.equal(indexNames.includes(migration.constants.INDEXES.EXPIRY), true);
    assert.equal(indexNames.includes(migration.constants.INDEXES.ACCOUNT), true);
    assert.equal(indexNames.includes(migration.constants.INDEXES.IDENTITY), true);

    const connection = context.app.db.connection;
    let testNow = new Date('2026-07-27T12:00:00.000Z');
    const checkoutStore = createSecurityStateStore(connection, () => testNow);
    const checkoutKey = 'd'.repeat(64);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.equal((await checkoutStore.checkRateLimit({ hashedKey: checkoutKey, actionCategory: 'checkout-create' })).allowed, true);
    }

    const firstBlocked = await checkoutStore.checkRateLimit({ hashedKey: checkoutKey, actionCategory: 'checkout-create' });
    const blockedExpiry = firstBlocked.resetTime;
    const blockedRow = await connection('security_states')
      .where({ kind: 'rate_limit', action_category: 'checkout-create', hashed_key: checkoutKey })
      .first();
    assert.equal(blockedRow.request_count, 20);
    assert.equal(new Date(blockedRow.expires_at).getTime(), blockedExpiry);

    testNow = new Date(testNow.getTime() + 60_000);
    const secondBlocked = await checkoutStore.checkRateLimit({ hashedKey: checkoutKey, actionCategory: 'checkout-create' });
    assert.equal(secondBlocked.allowed, false);
    assert.ok(secondBlocked.retryAfter < firstBlocked.retryAfter);
    const stillBlockedRow = await connection('security_states')
      .where({ kind: 'rate_limit', action_category: 'checkout-create', hashed_key: checkoutKey })
      .first();
    assert.equal(stillBlockedRow.request_count, 20);
    assert.equal(new Date(stillBlockedRow.expires_at).getTime(), blockedExpiry);

    testNow = new Date(blockedExpiry + 1);
    const afterExpiry = await checkoutStore.checkRateLimit({ hashedKey: checkoutKey, actionCategory: 'checkout-create' });
    assert.equal(afterExpiry.allowed, true);
    const resetRow = await connection('security_states')
      .where({ kind: 'rate_limit', action_category: 'checkout-create', hashed_key: checkoutKey })
      .first();
    assert.equal(resetRow.request_count, 1);
    assert.equal(new Date(resetRow.window_start).getTime(), testNow.getTime());

    const concurrentKey = 'e'.repeat(64);
    testNow = new Date('2026-07-27T13:00:00.000Z');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await checkoutStore.checkRateLimit({ hashedKey: concurrentKey, actionCategory: 'checkout-create' });
    }
    const concurrentExpiry = (await checkoutStore.checkRateLimit({ hashedKey: concurrentKey, actionCategory: 'checkout-create' })).resetTime;
    testNow = new Date(concurrentExpiry + 1);
    const concurrentResults = await Promise.all(Array.from({ length: 25 }, () =>
      checkoutStore.checkRateLimit({ hashedKey: concurrentKey, actionCategory: 'checkout-create' })));
    assert.equal(concurrentResults.filter(result => result.allowed).length, 20);
    assert.equal(concurrentResults.filter(result => !result.allowed).length, 5);
    const concurrentRow = await connection('security_states')
      .where({ kind: 'rate_limit', action_category: 'checkout-create', hashed_key: concurrentKey })
      .first();
    assert.equal(concurrentRow.request_count, 20);
    assert.ok(new Date(concurrentRow.expires_at).getTime() > testNow.getTime());

    const userAKey = 'f'.repeat(64);
    const userBKey = '0'.repeat(64);
    await checkoutStore.checkRateLimit({ hashedKey: userAKey, actionCategory: 'checkout-create' });
    await checkoutStore.checkRateLimit({ hashedKey: userBKey, actionCategory: 'checkout-create' });
    const separateRows = await connection('security_states')
      .where({ kind: 'rate_limit', action_category: 'checkout-create' })
      .whereIn('hashed_key', [userAKey, userBKey]);
    assert.equal(separateRows.length, 2);
    assert.deepEqual(separateRows.map(row => row.request_count), [1, 1]);
  } finally {
    await context.stop();
  }
});
