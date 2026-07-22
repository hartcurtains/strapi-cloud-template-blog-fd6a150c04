'use strict';

const ORDERS_TABLE = 'orders';

function createAbandonmentStore(knex, options = {}) {
  const beforeConditionalUpdate = options.beforeConditionalUpdate || (async () => {});

  async function transition({ orderNumber }) {
    const matches = await knex(ORDERS_TABLE)
      .select('id', 'order_number', 'status_order', 'payment_status')
      .where({ order_number: orderNumber });

    if (matches.length !== 1) return { result: 'not_found' };
    const order = matches[0];

    if (order.status_order !== 'pending' || order.payment_status !== 'pending') {
      return { result: 'ineligible' };
    }

    await beforeConditionalUpdate(knex, order);

    const affected = await knex(ORDERS_TABLE)
      .where({
        id: order.id,
        order_number: orderNumber,
        status_order: 'pending',
        payment_status: 'pending',
      })
      .update({
        status_order: 'cancelled',
        payment_status: 'failed',
        updated_at: new Date().toISOString(),
      });

    if (affected === 1) return { result: 'transitioned' };

    const current = await knex(ORDERS_TABLE)
      .select('status_order', 'payment_status')
      .where({ id: order.id })
      .first();
    return current ? { result: 'ineligible' } : { result: 'not_found' };
  }

  return { transition };
}

module.exports = { createAbandonmentStore };
