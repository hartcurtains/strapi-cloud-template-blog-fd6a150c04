'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/plugins/order-management/shared/fetch-all-fabrics.js'), 'utf8');
const { fetchAllFabrics } = Function(`${source.replace('export { fetchAllFabrics };', '')}; return { fetchAllFabrics };`)();

function response(data, page, pageCount, total, ok = true, status = 200) {
  return { ok, status, async json() { return { data, meta: { pagination: { page, pageSize: 3, pageCount, total } } }; } };
}

test('Ashley Wilde fabric catalogue fetches page 2 completely and deduplicates lookup records', async () => {
  const requests = [];
  const pages = [
    [
      { id: 1, documentId: 'alaska', name: 'Alaska' },
      { id: 2, documentId: 'arezzo', name: 'Arezzo' },
      { id: 3, documentId: 'berkeley', name: 'Berkeley' },
    ],
    [
      { id: 30, documentId: 'berkeley', name: 'Berkeley' },
      { id: 4, documentId: 'cherington', name: 'Cherington' },
      { id: 5, documentId: 'baltica', name: 'Baltica' },
    ],
  ];
  const result = await fetchAllFabrics({
    pageSize: 3,
    populate: ['brand', 'images'],
    publicationState: 'preview',
    async fetchImpl(url) {
      requests.push(url);
      const page = Number(new URL(url, 'http://local').searchParams.get('pagination[page]'));
      return response(pages[page - 1], page, 2, 6);
    },
  });

  assert.equal(result.totalFetched, result.meta.pagination.total);
  assert.equal(requests.length, 2);
  assert.match(requests[0], /pagination%5Bpage%5D=1/);
  assert.match(requests[1], /pagination%5Bpage%5D=2/);
  assert.match(requests[0], /publicationState=preview/);
  assert.match(requests[0], /sort=id%3Aasc/);
  assert.deepEqual(result.data.map((fabric) => fabric.name), ['Alaska', 'Arezzo', 'Berkeley', 'Cherington', 'Baltica']);
  assert.equal(result.data.filter((fabric) => fabric.documentId === 'berkeley').length, 1);
});

test('Ashley Wilde fabric catalogue tolerates an overlapping page only when unique physical IDs match total', async () => {
  const pages = [
    [{ id: 1, documentId: 'a' }, { id: 2, documentId: 'b' }, { id: 3, documentId: 'c' }],
    [{ id: 3, documentId: 'c' }, { id: 4, documentId: 'd' }, { id: 5, documentId: 'e' }],
  ];
  const result = await fetchAllFabrics({
    pageSize: 3,
    async fetchImpl(url) {
      const page = Number(new URL(url, 'http://local').searchParams.get('pagination[page]'));
      return response(pages[page - 1], page, 2, 5);
    },
  });
  assert.equal(result.totalFetched, 5);
  assert.deepEqual(result.data.map((fabric) => fabric.id), [1, 2, 3, 4, 5]);
});

test('Ashley Wilde fabric catalogue fails clearly instead of analysing an incomplete page set', async () => {
  await assert.rejects(
    fetchAllFabrics({
      pageSize: 2,
      async fetchImpl(url) {
        const page = Number(new URL(url, 'http://local').searchParams.get('pagination[page]'));
        return page === 1
          ? response([{ id: 1, name: 'Page one' }, { id: 2, name: 'Still page one' }], 1, 2, 3)
          : response([], 2, 2, 3, false, 500);
      },
    }),
    /Complete fabric catalogue request failed on page 2 \(500\)/
  );
});
