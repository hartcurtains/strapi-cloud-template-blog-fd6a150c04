'use strict';

const ORDERS_TABLE = 'orders';

function createSessionBindingStore(knex, options = {}) {
  const beforeConditionalUpdate = options.beforeConditionalUpdate || (async () => {});

  async function bind({ orderNumber, stripeSessionId }) {
    const matches = await knex(ORDERS_TABLE)
      .select('id', 'status_order', 'payment_status', 'stripe_session_id')
      .where({ order_number: orderNumber });

    if (matches.length !== 1) return { result: 'not_found' };
    const order = matches[0];
    if (order.status_order !== 'pending' || order.payment_status !== 'pending') {
      return { result: 'not_eligible' };
    }
    if (order.stripe_session_id === stripeSessionId) return { result: 'already_bound' };
    if (order.stripe_session_id !== null && order.stripe_session_id !== '') {
      return { result: 'conflict' };
    }

    await beforeConditionalUpdate(knex, order);

    const affected = await knex(ORDERS_TABLE)
      .where({
        id: order.id,
        order_number: orderNumber,
        status_order: 'pending',
        payment_status: 'pending',
      })
      .where(builder => builder.whereNull('stripe_session_id').orWhere('stripe_session_id', ''))
      .update({ stripe_session_id: stripeSessionId, updated_at: new Date().toISOString() });

    const currentMatches = await knex(ORDERS_TABLE)
      .select('status_order', 'payment_status', 'stripe_session_id')
      .where({ id: order.id, order_number: orderNumber });
    if (currentMatches.length !== 1) return { result: 'not_found' };
    const current = currentMatches[0];
    if (current.status_order !== 'pending' || current.payment_status !== 'pending') {
      return { result: 'not_eligible' };
    }
    if (current.stripe_session_id === stripeSessionId) {
      return { result: affected === 1 ? 'bound' : 'already_bound' };
    }
    return current.stripe_session_id ? { result: 'conflict' } : { result: 'not_found' };
  }

  return { bind };
}

module.exports = { createSessionBindingStore };
