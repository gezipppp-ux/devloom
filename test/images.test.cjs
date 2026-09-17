const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const {
  collectImages,
  downloadImage,
  extractImages,
} = require('../src/tapd_images.cjs');
const { buildTask } = require('../src/tapd_task_package.cjs');
const { item, png, session, temporary } = require('./helpers.cjs');

test('extract HTML, lazy, Markdown and reference images, resolve and deduplicate URLs', () => {
  assert.deepEqual(
    extractImages({
      ...item,
      description:
        '<img src="/a.png?a=1&amp;b=2"><img src="placeholder" data-src="//www.tapd.cn/b.png">',
      markdown_description:
        '![a](https://www.tapd.cn/a.png?a=1&b=2) ![b](/screen(1).png "caption") ![c][ref]\n[ref]: <https://www.tapd.cn/c.png>',
    }),
    [
      'https://www.tapd.cn/a.png?a=1&b=2',
      'https://www.tapd.cn/b.png',
      'https://www.tapd.cn/screen(1).png',
      'https://www.tapd.cn/c.png',
    ],
  );
});

test('download authenticated image and strip Cookie on allowed CDN redirect', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/image.png' },
        })
      : new Response(png);
  });
  const result = await collectImages(
    { ...item, description: '<img src="/image">' },
    session,
    temporary(t),
    { image_hosts: ['cdn.example.com'] },
  );
  assert.equal(result.length, 1);
  assert.deepEqual(fs.readFileSync(result[0].path), png);
  assert.equal(calls[0].headers.cookie, session.cookie_header);
  assert.equal(calls[1].headers.cookie, undefined);
});

test('reject foreign redirects, login HTML and oversized images', async (t) => {
  t.mock.method(
    global,
    'fetch',
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/collect' },
      }),
  );
  await assert.rejects(
    downloadImage('https://www.tapd.cn/a', session),
    /not allowed/,
  );
  t.mock.method(
    global,
    'fetch',
    async () => new Response('<html>Login</html>'),
  );
  await assert.rejects(
    collectImages(
      { ...item, description: '<img src="/a">' },
      session,
      temporary(t),
    ),
    /image 1.*not PNG/,
  );
  t.mock.method(
    global,
    'fetch',
    async () =>
      new Response(png, {
        headers: { 'content-length': String(11 * 1024 * 1024) },
      }),
  );
  await assert.rejects(
    downloadImage('https://www.tapd.cn/a', session),
    /10 MiB/,
  );
});

test('official file.tapd.cn receives login but other subdomains do not', async (t) => {
  const cookies = [];
  t.mock.method(global, 'fetch', async (_url, options) => {
    cookies.push(options.headers.cookie);
    return new Response(png);
  });
  await downloadImage('https://file.tapd.cn/image.png', session);
  await downloadImage('https://other.tapd.cn/image.png', session);
  assert.deepEqual(cookies, [session.cookie_header, undefined]);
});

test('image-only requirements are executable and task records match local attachments', async (t) => {
  const directory = temporary(t);
  const task = await buildTask(
    {
      ...item,
      description: `<p><img src="data:image/png;base64,${png.toString('base64')}"></p>`,
    },
    session,
    directory,
  );
  assert.equal(task.execution_ready, true);
  assert.equal(task.images.length, 1);
  assert.match(task.codex_prompt, /--image/);
  assert.equal(
    JSON.parse(fs.readFileSync(`${directory}/tapd-task.json`)).images[0].path,
    task.images[0].path,
  );
  const empty = await buildTask(
    { ...item, description: '<p><br>&nbsp;</p>' },
    session,
    temporary(t),
  );
  assert.equal(empty.execution_ready, false);
});
