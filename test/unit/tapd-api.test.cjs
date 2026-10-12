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
  const result = await detail(session, selected);
  assert.equal(result.id, item.id);
  assert.equal(result.title, item.title);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /get_info/);
  t.mock.method(global, 'fetch', async () =>
    json({ get_workitem_basic_info_ret: { meta: { code: 403 }, data: {} } }),
  );
  await assert.rejects(detail(session, selected), /rejected/);
});

test('direct ID detail preserves long TAPD titles from either name or title without a todo title', async (t) => {
  const title = '【生产】套餐本月已用积分在完成AI生成任务后，没有实时刷新已用积分，需要人工手动刷新';
  const selected = { id: item.id, workspace_id: item.workspace_id, type: 'story' };
  for (const fields of [{ name: title }, { title }, { name: '  ', title }]) {
    t.mock.method(global, 'fetch', async () => json({ get_workitem_basic_info_ret: {
      data: { id: item.id, workspace_id: item.workspace_id, ...fields },
    } }));
    assert.equal((await detail(session, selected)).title, title);
  }
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

test('untyped direct IDs detect story, bug and board cards without todo membership', async (t) => {
  for (const target of ['story', 'bug', 'board_card']) {
    const calls = [];
    t.mock.method(global, 'fetch', async (url, options) => {
      assert.match(String(url), /get_info$/);
      const body = JSON.parse(options.body);
      calls.push(body.entity_type);
      if (body.entity_type === target)
        return json({ get_workitem_basic_info_ret: { data: item } });
      return json({ get_workitem_basic_info_ret: target === 'board_card'
        ? { meta: { code: 404 }, data: {} } : { data: {} } });
    });
    const result = await detail(session, { id: item.id, workspace_id: item.workspace_id });
    assert.equal(result.type, target);
    assert.deepEqual(calls, ['story', 'bug', 'board_card'].slice(0, calls.length));
  }
});

test('type detection preserves failures and never retries network, login or identity errors', async (t) => {
  const selected = { id: item.id, workspace_id: item.workspace_id };
  for (const [response, message] of [
    [() => new Response('', { status: 403 }), /HTTP 403/],
    [() => new Response('<html>login</html>'), /non-JSON/],
    [() => json({}, 403), /rejected/],
    [() => { throw new Error('network failure'); }, /network failure/],
    [() => json({ get_workitem_basic_info_ret: { data: { ...item, id: '999' } } }), /different item/],
    [() => json({ get_workitem_basic_info_ret: { data: { ...item, workspace_id: '999' } } }), /different workspace/],
  ]) {
    let calls = 0;
    t.mock.method(global, 'fetch', async () => { calls++; return response(); });
    await assert.rejects(detail(session, selected), message);
    assert.equal(calls, 1);
  }
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return json({ get_workitem_basic_info_ret: { meta: { code: 403 }, data: {} } });
  });
  await assert.rejects(detail(session, selected), /无法读取.*story:.*bug:.*board_card:/);
  assert.equal(calls, 3, 'all candidate failures remain visible; none is silently skipped');
});

test('refreshing credentials preserves repository mapping, image hosts and workflow fields', async (t) => {
  const file = path.join(temporary(t), 'tapd.local.json');
  const config = {
    tapd: { session, image_hosts: ['cdn.example.com'] },
    workflow: { allow_write: true, fields: { owner: 'me' } },
    execution: { repositories: { 1: '/repo' } },
  };
  fs.writeFileSync(file, JSON.stringify(config));
  (await saveSession({ ...session, cookie_header: 'refreshed' }, file));
  const saved = JSON.parse(fs.readFileSync(file));
  assert.deepEqual(saved.workflow, config.workflow);
  assert.deepEqual(saved.execution, config.execution);
  assert.deepEqual(saved.tapd.image_hosts, ['cdn.example.com']);
  assert.equal(saved.tapd.session.cookie_header, 'refreshed');
});
