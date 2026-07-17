'use strict';

const { randomUUID } = require('node:crypto');

const TABLE = 'stripe_webhook_processings';

function newToken() {
  return randomUUID();
}

function createLifecycleStore(knex, clock = () => new Date()) {
  async function claimEvent({ eventId, eventType, leaseSeconds }) {
    const now = clock();
    const nowIso = now.toISOString();
    const expiredBefore = new Date(now.getTime() - leaseSeconds * 1000).toISOString();
    const claimToken = newToken();

    return knex.transaction(async trx => {
      const inserted = await trx(TABLE)
        .insert({
          document_id: randomUUID(),
          event_id: eventId,
          event_type: eventType || null,
          status: 'processing',
          claimed_at: nowIso,
          claim_token: claimToken,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .onConflict('event_id')
        .ignore()
        .returning('id');

      if (inserted.length > 0) return { result: 'claimed', claimToken };

      const updated = await trx(TABLE)
        .where({ event_id: eventId, status: 'processing' })
        .where('claimed_at', '<=', expiredBefore)
        .update({ claimed_at: nowIso, claim_token: claimToken, updated_at: nowIso });

      if (updated === 1) return { result: 'claimed', claimToken };

      const current = await trx(TABLE).select('status').where({ event_id: eventId }).first();
      if (current?.status === 'completed') return { result: 'already_completed' };
      if (current?.status === 'reconciliation_required') return { result: 'reconciliation_required' };
      return { result: 'currently_processing' };
    });
  }

  async function claimOrder({ eventId, orderNumber, claimToken }) {
    const nowIso = clock().toISOString();
    try {
      const updated = await knex.transaction(trx => trx(TABLE)
          .where({ event_id: eventId, status: 'processing', claim_token: claimToken })
          .whereNull('order_number')
          .update({
            order_number: orderNumber,
            updated_at: nowIso,
          }));
      if (updated === 1) return { result: 'claimed' };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const owner = await knex(TABLE).where({ order_number: orderNumber }).first();
      if (owner && owner.event_id !== eventId) return orderClaimResult(owner.status);
      throw error;
    }

    const current = await knex(TABLE)
      .select('order_number')
      .where({ event_id: eventId, status: 'processing', claim_token: claimToken })
      .first();
    if (current?.order_number === orderNumber) return { result: 'claimed' };
    const owner = await knex(TABLE).where({ order_number: orderNumber }).whereNot({ event_id: eventId }).first();
    if (owner) {
      return orderClaimResult(owner.status);
    }
    return { result: 'not_owner' };
  }

  async function complete({ eventId, claimToken }) {
    const nowIso = clock().toISOString();
    return knex.transaction(async trx => {
      const updated = await trx(TABLE)
        .where({ event_id: eventId, status: 'processing', claim_token: claimToken })
        .update({
          status: 'completed',
          completed_at: nowIso,
          updated_at: nowIso,
        });
      if (updated === 1) return { result: 'completed' };

      const current = await trx(TABLE).where({ event_id: eventId }).forUpdate().first();
      return { result: current?.status === 'completed' ? 'already_completed' : 'not_owner' };
    });
  }

  async function markReconciliationRequired({ eventId, claimToken }) {
    const nowIso = clock().toISOString();
    return knex.transaction(async trx => {
      const updated = await trx(TABLE)
        .where({ event_id: eventId, status: 'processing', claim_token: claimToken })
        .update({
          status: 'reconciliation_required',
          completed_at: nowIso,
          updated_at: nowIso,
        });
      if (updated === 1) return { result: 'reconciliation_required' };

      const current = await trx(TABLE).where({ event_id: eventId }).forUpdate().first();
      if (current?.status === 'reconciliation_required') return { result: 'already_reconciliation_required' };
      if (current?.status === 'completed') return { result: 'already_completed' };
      return { result: 'not_owner' };
    });
  }

  async function release({ eventId, claimToken }) {
    return knex.transaction(async trx => {
      const deleted = await trx(TABLE)
        .where({ event_id: eventId, status: 'processing', claim_token: claimToken })
        .delete();
      if (deleted === 1) return { result: 'released' };

      const current = await trx(TABLE).where({ event_id: eventId }).forUpdate().first();
      if (current?.status === 'completed') return { result: 'already_completed' };
      if (current?.status === 'reconciliation_required') return { result: 'already_reconciliation_required' };
      return { result: 'not_owner' };
    });
  }

  return { claimEvent, claimOrder, complete, markReconciliationRequired, release };
}

function orderClaimResult(status) {
  if (status === 'processing') return { result: 'currently_processing' };
  if (status === 'completed') return { result: 'already_processed' };
  if (status === 'reconciliation_required') return { result: 'reconciliation_required' };
  return { result: 'not_owner' };
}

function isUniqueViolation(error) {
  return error?.code === '23505' ||
    error?.code === 'SQLITE_CONSTRAINT' ||
    error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    error?.code === 'ER_DUP_ENTRY';
}

module.exports = { createLifecycleStore };
