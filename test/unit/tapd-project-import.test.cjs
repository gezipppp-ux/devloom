const assert = require('node:assert/strict');
const { test } = require('node:test');
const { importProjectTapd } = require('../../src/channels/tapd/project-import.cjs');
const { item, session, json, png } = require('../support/helpers.cjs');

test('project imports retain controlled image download host, signature and per-image limits', async t => {
  let description = '<img src="https://evil.example/screen.png">', mode = 'valid';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url));
    if (String(url).includes('/aggregation/')) return json({ get_workitem_basic_info_ret: { data: { ...item, description } } });
    if (mode === 'oversize') return new Response(png, { headers: { 'content-length': String(10 * 1024 * 1024 + 1) } });
    return new Response(mode === 'invalid' ? '<svg/>' : png);
  });
  const input = { items: [{ id: item.id, type: 'story' }] };
  await assert.rejects(importProjectTapd({ tapd: { session } }, input), /host is not allowed/);
  assert.equal(requests.length, 1);
  description = '<img src="https://file.tapd.cn/screen.png">';
  mode = 'oversize';
  await assert.rejects(importProjectTapd({ tapd: { session } }, input), /exceeds 10 MiB/);
  mode = 'invalid';
  await assert.rejects(importProjectTapd({ tapd: { session } }, input), /not PNG/);
  const before = requests.length;
  description = Array.from({ length: 21 }, (_, index) => `<img src="https://file.tapd.cn/${index}.png">`).join('');
  await assert.rejects(importProjectTapd({ tapd: { session } }, input), /20/);
  assert.equal(requests.length, before + 1, 'reject image count before downloading');
});

test('project import image material is bounded across the complete requested batch', async t => {
  const large = Buffer.alloc(10 * 1024 * 1024); png.copy(large);
  let downloads = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('/aggregation/')) {
      const id = JSON.parse(options.body).entity_id;
      return json({ get_workitem_basic_info_ret: { data: { ...item, id, description: `<img src="https://file.tapd.cn/${id}.png">` } } });
    }
    downloads++;
    return new Response(large);
  });
  await assert.rejects(importProjectTapd({ tapd: { session } }, { items: ['1', '2', '3'].map(id => ({ id, type: 'story' })) }), /20 MiB/);
  assert.equal(downloads, 3);
});
