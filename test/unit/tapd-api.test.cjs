const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { detail, selectItem, todos } = require('../../src/channels/tapd/detail.cjs');
const { request } = require('../../src/channels/tapd/http.cjs');
const { saveSession } = require('../../src/channels/tapd/auth-utils.cjs');
const { item, json, session, temporary } = require('../support/helpers.cjs');

test('search traverses pages despite total zero, filters and preserves captured request', async (t) => {
  const original = structuredClone(session.request_body);
  const pages = [];
  t.mock.method(global, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    pages.push(body.page);
    assert.deepEqual(body.select_object_types, ['story']);
    return json(
      JSON.stringify({
        record_total: '0',
        workitem_list:
          body.page === 1
            ? [
                { ...item, entity_type: 'Story', name: '其他', title: '' },
                { ...item, id: '2', entity_type: 'Bug' },
              ]
            : [{ ...item, id: '3', entity_type: 'Story', status: 'open' }],
      }),
      body.page === 1 ? '0' : 0,
    );
  });
  const results = await todos(session, {
    type: 'story',
    query: '示例',
    status: 'open',
  });
  assert.deepEqual(
    results.map((row) => row.id),
    ['3'],
  );
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(session.request_body, original);
});

test('direct ID lookup does not depend on todo membership and rejects missing nested detail', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url) => {
    calls.push(String(url));
    return json({ get_workitem_basic_info_ret: { data: item } });
  });
  const selected = await selectItem(session, { id: item.id });
  assert.equal((await detail(session, selected)).id, item.id);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /get_info/);
  t.mock.method(global, 'fetch', async () =>
    json({ get_workitem_basic_info_ret: { meta: { code: 403 }, data: {} } }),
  );
  await assert.rejects(detail(session, selected), /rejected/);
});

test('API rejects redirects, non-JSON login pages and foreign credential destinations', async (t) => {
  t.mock.method(global, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return new Response('<html>login</html>');
  });
  await assert.rejects(request(session, session.endpoint), /non-JSON/);
  await assert.rejects(request(session, 'https://example.com'), /endpoint/);
});

test('refreshing credentials preserves repository mapping, image hosts and workflow fields', (t) => {
  const file = path.join(temporary(t), 'tapd.local.json');
  const config = {
    tapd: { session, image_hosts: ['cdn.example.com'] },
    workflow: { allow_write: true, fields: { owner: 'me' } },
    codex: { repositories: { 1: '/repo' } },
  };
  fs.writeFileSync(file, JSON.stringify(config));
  saveSession({ ...session, cookie_header: 'refreshed' }, file);
  const saved = JSON.parse(fs.readFileSync(file));
  assert.deepEqual(saved.workflow, config.workflow);
  assert.deepEqual(saved.codex, config.codex);
  assert.deepEqual(saved.tapd.image_hosts, ['cdn.example.com']);
  assert.equal(saved.tapd.session.cookie_header, 'refreshed');
});
