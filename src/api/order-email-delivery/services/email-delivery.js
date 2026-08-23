'use strict';

const { randomUUID } = require('node:crypto');

const TABLE = 'order_email_deliveries';
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CLAIM_LEASE_SECONDS = 15 * 60;
const DEFAULT_BACKOFF_SECONDS = Object.freeze([60, 5 * 60, 30 * 60, 2 * 60 * 60, 12 * 60 * 60]);

function asPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueViolation(error) {
  return error?.code === '23505' ||
    error?.code === 'SQLITE_CONSTRAINT' ||
    error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    error?.code === 'ER_DUP_ENTRY';
}

function normalizedOrderNumber(value) {
  return typeof value === 'string' ? value.trim().slice(0, 128) : '';
}

function normalizedEmailType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 64) : '';
}

function safeErrorMessage(error) {
  const message = String(error?.message || error?.name || 'delivery_failed');
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 2000);
}

function createOrderEmailDeliveryStore(knex, options = {}) {
  const clock = options.clock || (() => new Date());
  const maxAttempts = asPositiveInt(
    options.maxAttempts ?? process.env.ORDER_EMAIL_MAX_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS,
  );
  const claimLeaseSeconds = asPositiveInt(
    options.claimLeaseSeconds ?? process.env.ORDER_EMAIL_CLAIM_LEASE_SECONDS,
    DEFAULT_CLAIM_LEASE_SECONDS,
  );
  const backoffSeconds = Array.isArray(options.backoffSeconds) && options.backoffSeconds.length > 0
    ? options.backoffSeconds.map((value) => asPositiveInt(value, DEFAULT_BACKOFF_SECONDS[0]))
    : DEFAULT_BACKOFF_SECONDS;

  async function ensureIntent({ orderNumber, emailType }) {
    const normalizedNumber = normalizedOrderNumber(orderNumber);
    const normalizedType = normalizedEmailType(emailType);
    if (!normalizedNumber || !normalizedType) return { result: 'invalid' };

    const nowIso = clock().toISOString();
    try {
      await knex(TABLE)
        .insert({
          order_number: normalizedNumber,
          email_type: normalizedType,
          status: 'pending',
          attempt_count: 0,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .onConflict(['order_number', 'email_type'])
        .ignore();
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
    }

    const row = await knex(TABLE)
      .where({ order_number: normalizedNumber, email_type: normalizedType })
      .first();
    return row ? { result: 'ready', row } : { result: 'not_found' };
  }

  async function claim({ orderNumber, emailType, deliveryId }) {
    const normalizedNumber = normalizedOrderNumber(orderNumber);
    const normalizedType = normalizedEmailType(emailType);
    const now = clock();
    const nowIso = now.toISOString();
    const expiredBefore = new Date(now.getTime() - claimLeaseSeconds * 1000).toISOString();
    const claimToken = randomUUID();

    return knex.transaction(async (trx) => {
      const query = trx(TABLE)
        .where({ email_type: normalizedType })
        .where('attempt_count', '<', maxAttempts)
        .where((builder) => {
          builder.where((eligible) => {
            eligible.whereIn('status', ['pending', 'failed'])
              .andWhere((due) => due.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', nowIso));
          }).orWhere((stale) => {
            stale.where('status', 'sending').where('last_attempt_at', '<=', expiredBefore);
          });
        });
      if (normalizedNumber) query.andWhere('order_number', normalizedNumber);
      if (deliveryId !== undefined) query.andWhere('id', deliveryId);

      const affected = await query.update({
        status: 'sending',
        claim_token: claimToken,
        attempt_count: trx.raw('attempt_count + 1'),
        last_attempt_at: nowIso,
        next_attempt_at: null,
        updated_at: nowIso,
      });
      if (affected !== 1) {
        const currentQuery = trx(TABLE).select('*');
        if (normalizedNumber) currentQuery.where({ order_number: normalizedNumber, email_type: normalizedType });
        else currentQuery.where({ email_type: normalizedType });
        if (deliveryId !== undefined) currentQuery.andWhere('id', deliveryId);
        const current = await currentQuery.first();
        if (!current) return { result: 'not_found' };
        if (current.status === 'sent') return { result: 'already_sent', row: current };
        if (current.attempt_count >= maxAttempts) return { result: 'exhausted', row: current };
        return { result: current.status === 'sending' ? 'currently_processing' : 'not_due', row: current };
      }

      const claimedQuery = trx(TABLE).where({ claim_token: claimToken, status: 'sending' });
      if (normalizedNumber) claimedQuery.andWhere({ order_number: normalizedNumber, email_type: normalizedType });
      else claimedQuery.andWhere({ email_type: normalizedType });
      if (deliveryId !== undefined) claimedQuery.andWhere('id', deliveryId);
      const row = await claimedQuery.first();
      return row ? { result: 'claimed', claimToken, row } : { result: 'not_found' };
    });
  }

  async function markSent({ id, claimToken }) {
    const nowIso = clock().toISOString();
    const affected = await knex(TABLE)
      .where({ id, status: 'sending', claim_token: claimToken })
      .update({ status: 'sent', sent_at: nowIso, next_attempt_at: null, claim_token: null, last_error: null, updated_at: nowIso });
    if (affected === 1) return { result: 'sent' };
    const current = await knex(TABLE).where({ id }).first();
    return { result: current?.status === 'sent' ? 'already_sent' : 'not_owner', row: current };
  }

  async function markFailure({ id, claimToken, error }) {
    const current = await knex(TABLE).where({ id, status: 'sending', claim_token: claimToken }).first();
    if (!current) {
      const existing = await knex(TABLE).where({ id }).first();
      return { result: existing?.status === 'failed' ? 'already_failed' : 'not_owner', row: existing };
    }

    const attemptCount = Number(current.attempt_count) || 0;
    const exhausted = attemptCount >= maxAttempts;
    const delaySeconds = backoffSeconds[Math.min(Math.max(attemptCount - 1, 0), backoffSeconds.length - 1)];
    const nextAttemptAt = exhausted ? null : new Date(clock().getTime() + delaySeconds * 1000).toISOString();
    const nowIso = clock().toISOString();
    await knex(TABLE)
      .where({ id, status: 'sending', claim_token: claimToken })
      .update({
        status: 'failed',
        next_attempt_at: nextAttemptAt,
        claim_token: null,
        last_error: safeErrorMessage(error),
        updated_at: nowIso,
      });
    return { result: exhausted ? 'failed_exhausted' : 'failed_retryable', nextAttemptAt };
  }

  async function listRetryable({ limit = 25 } = {}) {
    const nowIso = clock().toISOString();
    return knex(TABLE)
      .select('*')
      .where('attempt_count', '<', maxAttempts)
      .where((builder) => {
        builder.where((eligible) => {
          eligible.whereIn('status', ['pending', 'failed'])
            .andWhere((due) => due.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', nowIso));
        }).orWhere((stale) => stale.where('status', 'sending').where('last_attempt_at', '<=', new Date(clock().getTime() - claimLeaseSeconds * 1000).toISOString()));
      })
      .orderBy('id', 'asc')
      .limit(Math.min(asPositiveInt(limit, 25), 100));
  }

  return {
    ensureIntent,
    claim,
    markSent,
    markFailure,
    listRetryable,
    maxAttempts,
    claimLeaseSeconds,
  };
}

module.exports = {
  TABLE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_CLAIM_LEASE_SECONDS,
  DEFAULT_BACKOFF_SECONDS,
  createOrderEmailDeliveryStore,
  safeErrorMessage,
};
