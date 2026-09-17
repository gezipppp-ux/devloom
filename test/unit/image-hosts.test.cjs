const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { saveTapdSettings } = require('../../src/channels/tapd/settings.cjs');
const { downloadImage } = require('../../src/channels/tapd/images.cjs');
const { png, session, temporary } = require('../support/helpers.cjs');

test('TAPD settings persist canonical image hosts that allow the configured downloads', async (t) => {
  const file = path.join(temporary(t), 'config.json');
  const settings = saveTapdSettings(file, {
    workspaceId: '1',
    cookie: 'dsc-token=fake',
    imageHosts: ['CDN.EXAMPLE.COM', 'cdn.example.com'],
  });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(settings.imageHosts, ['cdn.example.com']);
  assert.deepEqual(saved.tapd.image_hosts, settings.imageHosts);
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://cdn.example.com/image.png');
    assert.equal(options.headers.cookie, undefined);
    return new Response(png);
  });
  assert.deepEqual(
    await downloadImage(
      'https://cdn.example.com/image.png',
      saved.tapd.session,
      saved.tapd.image_hosts,
    ),
    png,
  );
});

test('legacy mixed-case image hosts allow redirects without expanding Cookie destinations', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url: String(url), cookie: options.headers.cookie });
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/image.png' },
        })
      : new Response(png);
  });
  assert.deepEqual(
    await downloadImage('https://file.tapd.cn/image.png', session, [
      'CDN.EXAMPLE.COM',
    ]),
    png,
  );
  assert.deepEqual(calls, [
    { url: 'https://file.tapd.cn/image.png', cookie: session.cookie_header },
    { url: 'https://cdn.example.com/image.png', cookie: undefined },
  ]);
  await assert.rejects(
    downloadImage('https://cdn.example.com.evil/image.png', session, [
      'CDN.EXAMPLE.COM',
    ]),
    /not allowed/,
  );
  assert.equal(calls.length, 2);
});
