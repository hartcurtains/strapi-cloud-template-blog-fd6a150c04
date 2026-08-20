'use strict';

const crypto = require('node:crypto');

const TABLE = 'security_states';
const RATE_LIMITS = Object.freeze({
  login: { windowMs: 60_000, max: 20 },
  checkout: { windowMs: 5 * 60_000, max: 20 },
  'checkout-create': { windowMs: 5 * 60_000, max: 20 },
  cart: { windowMs: 5 * 60_000, max: 20 },
  orders: { windowMs: 60_000, max: 30 },
  'calculate-price': { windowMs: 60_000, max: 100 },
  search: { windowMs: 5 * 60_000, max: 50 },
  catalog: { windowMs: 5 * 60_000, max: 120 },
  'account-deletion': { windowMs: 15 * 60_000, max: 5 },
  // Keep application-triggered email comfortably below Strapi Cloud's
  // published 20/minute and 100/hour provider limits. The daily ceiling is an
  // application fair-use budget rather than a provider-advertised quota.
  'email-global-minute': { windowMs: 60_000, max: 8 },
  'email-global-hour': { windowMs: 60 * 60_000, max: 50 },
  'email-global-day': { windowMs: 24 * 60 * 60_000, max: 200 },
  'email-ip-hour': { windowMs: 60 * 60_000, max: 5 },
  'email-recipient-hour': { windowMs: 60 * 60_000, max: 3 },
  'email-recipient-day': { windowMs: 24 * 60 * 60_000, max: 6 },
});
const CHALLENGE_CATEGORY = 'account-deletion-challenge';
const CHALLENGE_TTL_MS = 10 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;

function rawRows(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result)) return result;
  return result?.rows || [];
}

function parseUtc(value) {
  if (value instanceof Date) return new Date(value.getTime());
  const text = String(value || '').trim();
  if (!text) throw new Error('Database returned no current time');
  const utcText = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
    ? text
    : `${text.replace(' ', 'T')}Z`;
  const parsed = new Date(utcText);
  if (Number.isNaN(parsed.getTime())) throw new Error('Database returned an invalid current time');
  return parsed;
}

async function databaseNow(trx) {
  const client = String(trx.client.config.client).toLowerCase();
  let result;
  if (client.includes('pg') || client.includes('postgres')) {
    result = await trx.raw(`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`);
  } else if (client.includes('sqlite')) {
    result = await trx.raw("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now");
  } else if (client.includes('mysql')) {
    result = await trx.raw('SELECT UTC_TIMESTAMP(3) AS now');
  } else {
    throw new Error(`Security-state service does not support database client ${client}`);
  }
  return parseUtc(rawRows(result)[0]?.now);
}

function isUniqueViolation(error) {
  return error?.code === '23505' ||
    error?.code === 'SQLITE_CONSTRAINT' ||
    error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    error?.code === 'ER_DUP_ENTRY';
}

function accountKey(accountIdentifier) {
  return crypto.createHash('sha256').update(accountIdentifier, 'utf8').digest('hex');
}

function sameHash(left, right) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSecurityStateStore(knex, clock = null) {
  async function currentTime(trx) {
    return clock ? parseUtc(clock()) : databaseNow(trx);
  }

  async function cleanup(trx, now) {
    await trx(TABLE).where('expires_at', '<=', now).delete();
  }

  async function transactionWithInsertRetry(work) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await knex.transaction(work);
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 1) throw error;
      }
    }
    throw new Error('Security transaction failed');
  }

  async function checkRateLimit({ hashedKey, actionCategory }) {
    const settings = RATE_LIMITS[actionCategory];
    if (!settings) throw new Error('Unsupported rate-limit category');

    return transactionWithInsertRetry(async trx => {
      const now = await currentTime(trx);
      const nowValue = now.toISOString();
      await cleanup(trx, nowValue);
      const current = await trx(TABLE)
        .where({ kind: 'rate_limit', action_category: actionCategory, hashed_key: hashedKey })
        .forUpdate()
        .first();

      const active = current && new Date(current.expires_at).getTime() > now.getTime();
      const currentCount = current ? Number(current.request_count || 0) : 0;
      if (active && currentCount >= settings.max) {
        const expiresAt = new Date(current.expires_at);
        return {
          allowed: false,
          remaining: 0,
          resetTime: expiresAt.getTime(),
          retryAfter: Math.ceil((expiresAt.getTime() - now.getTime()) / 1000),
        };
      }

      const count = active ? currentCount + 1 : 1;
      const expiresAt = active ? new Date(current.expires_at) : new Date(now.getTime() + settings.windowMs);
      const values = {
        kind: 'rate_limit',
        hashed_key: hashedKey,
        action_category: actionCategory,
        request_count: count,
        window_start: active ? current.window_start : nowValue,
        expires_at: expiresAt.toISOString(),
        updated_at: nowValue,
      };

      if (current) await trx(TABLE).where({ id: current.id }).update(values);
      else await trx(TABLE).insert({ document_id: crypto.randomUUID(), created_at: nowValue, ...values });

      return {
        allowed: count <= settings.max,
        remaining: Math.max(0, settings.max - count),
        resetTime: expiresAt.getTime(),
        retryAfter: Math.ceil((expiresAt.getTime() - now.getTime()) / 1000),
      };
    });
  }

  async function createAccountDeletionChallenge({ accountIdentifier, codeHash }) {
    return transactionWithInsertRetry(async trx => {
      const now = await currentTime(trx);
      const nowValue = now.toISOString();
      await cleanup(trx, nowValue);
      const hashedKey = accountKey(accountIdentifier);
      const current = await trx(TABLE)
        .where({ kind: 'account_deletion_challenge', action_category: CHALLENGE_CATEGORY, hashed_key: hashedKey })
        .forUpdate()
        .first();
      const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
      const values = {
        kind: 'account_deletion_challenge',
        hashed_key: hashedKey,
        action_category: CHALLENGE_CATEGORY,
        request_count: 0,
        window_start: null,
        expires_at: expiresAt.toISOString(),
        account_identifier: accountIdentifier,
        code_hash: codeHash,
        remaining_attempts: CHALLENGE_MAX_ATTEMPTS,
        consumed_at: null,
        updated_at: nowValue,
      };

      if (current) await trx(TABLE).where({ id: current.id }).update(values);
      else await trx(TABLE).insert({ document_id: crypto.randomUUID(), created_at: nowValue, ...values });
      return { expiresAt: expiresAt.toISOString() };
    });
  }

  async function verifyAccountDeletionChallenge({ accountIdentifier, codeHash }) {
    return transactionWithInsertRetry(async trx => {
      const now = await currentTime(trx);
      const nowValue = now.toISOString();
      await cleanup(trx, nowValue);
      const current = await trx(TABLE)
        .where({ kind: 'account_deletion_challenge', action_category: CHALLENGE_CATEGORY, hashed_key: accountKey(accountIdentifier) })
        .forUpdate()
        .first();

      if (!current || current.consumed_at || new Date(current.expires_at).getTime() <= now.getTime()) {
        return { result: 'invalid' };
      }
      if (Number(current.remaining_attempts || 0) <= 0) {
        return { result: 'locked' };
      }
      if (sameHash(current.code_hash, codeHash)) {
        await trx(TABLE).where({ id: current.id }).update({ remaining_attempts: 0, consumed_at: nowValue, updated_at: nowValue });
        return { result: 'valid' };
      }

      const remainingAttempts = Math.max(0, Number(current.remaining_attempts) - 1);
      await trx(TABLE).where({ id: current.id }).update({
        remaining_attempts: remainingAttempts,
        consumed_at: remainingAttempts === 0 ? nowValue : null,
        updated_at: nowValue,
      });
      return { result: remainingAttempts === 0 ? 'locked' : 'invalid' };
    });
  }

  return { checkRateLimit, createAccountDeletionChallenge, verifyAccountDeletionChallenge };
}

module.exports = {
  TABLE,
  RATE_LIMITS,
  CHALLENGE_CATEGORY,
  CHALLENGE_TTL_MS,
  CHALLENGE_MAX_ATTEMPTS,
  createSecurityStateStore,
};
