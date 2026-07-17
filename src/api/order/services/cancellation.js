'use strict';

const ORDERS_TABLE = 'orders';
const OWNERS_TABLE = 'orders_user_lnk';
const SESSION_ID = /^cs_(?:test_|live_)?[A-Za-z0-9_]{8,255}$/;

function validSessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value);
}

function createCancellationStore(knex, options = {}) {
  const beforeConditionalUpdate = options.beforeConditionalUpdate || (async () => {});

  async function transition({ orderNumber, stripeSessionId, ownerId }) {
    const tokenFlow = stripeSessionId !== undefined;
    const matches = await knex(ORDERS_TABLE)
      .select('id', 'order_number', 'status_order', 'payment_status', 'stripe_session_id')
      .where({ order_number: orderNumber });

    if (matches.length !== 1) return { result: 'not_found' };
    const order = matches[0];

    if (tokenFlow) {
      if (!validSessionId(order.stripe_session_id) || order.stripe_session_id !== stripeSessionId) {
        return { result: 'not_found' };
      }
    } else {
      const owners = await knex(OWNERS_TABLE)
        .select('id')
        .where({ order_id: order.id, user_id: ownerId });
      if (owners.length !== 1) return { result: 'not_found' };
    }

    if (order.status_order === 'cancelled') return { result: 'already_cancelled' };
    if (order.status_order !== 'pending' || order.payment_status !== 'pending') {
      return { result: 'not_eligible' };
    }

    await beforeConditionalUpdate(knex, order);

    const update = knex(ORDERS_TABLE)
      .where({
        id: order.id,
        order_number: orderNumber,
        status_order: 'pending',
        payment_status: 'pending',
      });

    if (tokenFlow) {
      update.andWhere({ stripe_session_id: stripeSessionId });
    } else {
      update.whereExists(function ownerStillMatches() {
        this.select(1)
          .from(OWNERS_TABLE)
          .whereRaw(`${OWNERS_TABLE}.order_id = ${ORDERS_TABLE}.id`)
          .andWhere({ user_id: ownerId });
      });
    }

    const affected = await update.update({
      status_order: 'cancelled',
      updated_at: new Date().toISOString(),
    });

    if (affected === 1) return { result: 'cancelled' };

    const current = await knex(ORDERS_TABLE)
      .select('status_order', 'payment_status', 'stripe_session_id')
      .where({ id: order.id })
      .first();
    if (!current) return { result: 'not_found' };
    if (tokenFlow && (!validSessionId(current.stripe_session_id) || current.stripe_session_id !== stripeSessionId)) {
      return { result: 'not_found' };
    }
    if (!tokenFlow) {
      const owners = await knex(OWNERS_TABLE)
        .select('id')
        .where({ order_id: order.id, user_id: ownerId });
      if (owners.length !== 1) return { result: 'not_found' };
    }
    return current?.status_order === 'cancelled'
      ? { result: 'already_cancelled' }
      : { result: 'not_eligible' };
  }

  return { transition };
}

module.exports = { createCancellationStore, validSessionId };
