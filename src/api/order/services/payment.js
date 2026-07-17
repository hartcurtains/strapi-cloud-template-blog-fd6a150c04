'use strict';

const ORDERS_TABLE = 'orders';

function createPaymentStore(knex, options = {}) {
  const beforeConditionalUpdate = options.beforeConditionalUpdate || (async () => {});

  async function transition({ orderNumber, stripeSessionId, stripeCustomerId }) {
    const matches = await knex(ORDERS_TABLE)
      .select('id', 'order_number', 'status_order', 'payment_status')
      .where({ order_number: orderNumber });

    if (matches.length !== 1) return { result: 'not_found' };
    const order = matches[0];

    if (order.payment_status === 'paid' ||
      ['processing', 'shipped', 'fulfilled', 'delivered'].includes(order.status_order)) {
      return { result: 'already_processed' };
    }
    if (order.status_order !== 'pending' || order.payment_status !== 'pending') {
      return { result: 'state_conflict' };
    }

    await beforeConditionalUpdate(knex, order);

    const updateData = {
      payment_status: 'paid',
      status_order: 'processing',
      updated_at: new Date().toISOString(),
    };
    if (stripeSessionId !== undefined) updateData.stripe_session_id = stripeSessionId;
    if (stripeCustomerId !== undefined) updateData.stripe_customer_id = stripeCustomerId;

    const affected = await knex(ORDERS_TABLE)
      .where({
        id: order.id,
        order_number: orderNumber,
        status_order: 'pending',
        payment_status: 'pending',
      })
      .update(updateData);

    if (affected === 1) return { result: 'transitioned' };

    const current = await knex(ORDERS_TABLE)
      .select('status_order', 'payment_status')
      .where({ id: order.id })
      .first();
    if (!current) return { result: 'not_found' };
    if (current.payment_status === 'paid' ||
      ['processing', 'shipped', 'fulfilled', 'delivered'].includes(current.status_order)) {
      return { result: 'already_processed' };
    }
    return { result: 'state_conflict' };
  }

  return { transition };
}

module.exports = { createPaymentStore };
