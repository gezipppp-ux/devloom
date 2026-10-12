const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { temporary, png } = require('../support/helpers.cjs');
const { createManualChannel } = require('../../src/channels/manual/adapter.cjs');
const { ManualUploadStore } = require('../../src/channels/manual/manual-upload-store.cjs');
const { titleSlug } = require('../../src/channels/manual/task-package.cjs');
const { ChannelRegistry } = require('../../src/channels/channel-registry.cjs');
const { worktreePlan, createWorktree } = require('../../src/git/worktrees.cjs');
const { validateWorktreeName } = require('../../src/domain/worktree-name.cjs');
const { sourceFor } = require('../../src/domain/run-identity.cjs');
const { createWebServer } = require('../../src/http/server.cjs');
const { SessionManager } = require('../support/session-manager.cjs');
const { saveSettings } = require('../../src/config/execution-settings.cjs');
const { FakeClient } = require('../fixtures/web-client.cjs');

function fixture(t) {
  const directory = temporary(t);
  const configFile = path.join(directory, 'missing.json');
  fs.writeFileSync(configFile, JSON.stringify({ agent: { provider: "codex" } }));
  const uploadDirectory = path.join(directory, 'uploads');
  return {
    directory,
    configFile,
    uploadDirectory,
    channel: createManualChannel(configFile, {
      uploadDirectory,
    }),
  };
}
function repository(directory) {
  fs.mkdirSync(directory);
  const git = (...args) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(directory, 'README.md'), 'fixture');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-m',
    'fixture',
  );
  return git;
}

test('manual channel validates input, preserves full text and copies image-only requirements without TAPD credentials', async (t) => {
  const { directory, channel, uploadDirectory } = fixture(t);
  const base = {
    requestId: randomUUID(),
    title: '新增登录入口',
    content: '完整内容\n' + '测试'.repeat(10000),
  };
  const resolved = await channel.resolve(base);
  assert.match(resolved.config.prompt_templates.manual, /\{\{content\}\}/);
  const text = await channel.prepare({ ...resolved, directory });
  assert.ok(text.task.prompt.includes(base.content));
  assert.equal(text.worktreeSlug, 'xin-zeng-deng-lu-ru-kou');
  const uploaded = (await channel.uploadImage(png));
  const jpeg = Buffer.from([255, 216, 255, 217]);
  const second = (await channel.uploadImage(jpeg));
  const imageOnly = await channel.resolve({
    ...base,
    content: '',
    images: [uploaded.id, second.id],
  });
  const prepared = await channel.prepare({ ...imageOnly, directory });
  assert.deepEqual(fs.readFileSync(prepared.task.images[0].path), png);
  assert.deepEqual(fs.readFileSync(prepared.task.images[1].path), jpeg);
  assert.deepEqual(prepared.task.images.map((image) => ({
    index: image.index,
    source: image.source,
    name: path.basename(image.path),
  })), [
    { index: 1, source: `manual-image:${uploaded.id}`, name: '01.png' },
    { index: 2, source: `manual-image:${second.id}`, name: '02.jpg' },
  ]);
  assert.ok(prepared.task.prompt.endsWith([
    '附带 2 张本地图片，顺序与用户上传顺序一致，请结合图片理解需求。',
    `图片 1：${prepared.task.images[0].path}`,
    `图片 2：${prepared.task.images[1].path}`,
  ].join('\n')));
  assert.equal(prepared.workitem.image_ids, undefined);
  assert.deepEqual(imageOnly.item.image_ids, [uploaded.id, second.id]);
  assert.ok(prepared.task.images[0].path.startsWith(directory + path.sep));
  assert.equal((await channel.transition()).status, 'skipped');
  for (const invalid of [
    { title: '' },
    { title: 'a'.repeat(201) },
    { content: 'a'.repeat(60001) },
    { content: '', images: [] },
    { requestId: '../escape' },
    { images: ['../escape'] },
    { images: [randomUUID()] },
    { images: Array(21).fill(uploaded.id) },
    { images: [uploaded.id, uploaded.id] },
    { worktreeName: '../outside' },
    { worktreeName: '/srv/task' },
    { worktreeName: 'D:\\task' },
  ])
    await assert.rejects(channel.resolve({ ...base, ...invalid }));
  (await assert.rejects(
    async () => (await channel.uploadImage(Buffer.from('<html>no image</html>'))),
    /PNG/,
  ));
  (await assert.rejects(
    async () => (await channel.uploadImage(Buffer.alloc(10 * 1024 * 1024 + 1))),
    /10 MiB/,
  ));
  const expired = new Date(Date.now() - 25 * 60 * 60 * 1000);
  fs.utimesSync(path.join(uploadDirectory, uploaded.id), expired, expired);
  await assert.rejects(
    channel.resolve({ ...base, images: [uploaded.id] }),
    /过期/,
  );
  (await channel.uploadImage(png));
  assert.equal(fs.existsSync(path.join(uploadDirectory, uploaded.id)), false);
  assert.equal(fs.existsSync(path.join(uploadDirectory, second.id)), true);
  assert.deepEqual(fs.readFileSync(prepared.task.images[0].path), png);
});

test('concurrent cleanup of expired uploads does not reject an unrelated new upload', async (t) => {
  const directory = temporary(t);
  const uploads = new ManualUploadStore(directory);
  const expired = (await uploads.upload(png));
  const file = path.join(directory, expired.id);
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  fs.utimesSync(file, old, old);
  const readDirectory = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function (target, ...args) {
    const names = readDirectory.call(this, target, ...args);
    if (target === directory && fs.existsSync(file)) fs.unlinkSync(file);
    return names;
  });
  const next = (await uploads.upload(png));
  assert.deepEqual((await uploads.read(next.id)).bytes, png);
});

test('manual names preserve English, transliterate Chinese, isolate duplicates and keep custom names inside configured root', (t) => {
  const { directory } = fixture(t);
  const repo = path.join(directory, 'repo');
  repository(repo);
  const root = path.join(directory, 'worktrees');
  assert.equal(titleSlug('Add Login API'), 'add-login-api');
  assert.equal(titleSlug('登录 Login 2'), 'deng-lu-login-2');
  assert.equal(titleSlug('✨'), 'requirement');
  assert.ok(titleSlug('测试'.repeat(100)).length <= 64);
  for (const value of [
    'CON',
    'nul',
    '../outside',
    'two/names',
    'two\\names',
    '.git',
    '-option',
    'a'.repeat(17),
  ])
    assert.throws(() => validateWorktreeName(value));
  const item = { id: randomUUID(), workspace_id: 'local' };
  const options = {
    root,
    source: sourceFor('manual', item),
    slug: titleSlug('新增登录入口'),
  };
  const plan = worktreePlan(repo, item, 'main', options);
  assert.match(
    path.basename(plan.path),
    /^xin-zeng-deng-lu-[a-f0-9]{12}$/,
  );
  assert.deepEqual(worktreePlan(repo, item, 'main', options), plan);
  assert.notEqual(
    worktreePlan(repo, item, 'main', {
      ...options,
      source: sourceFor('manual', { ...item, id: randomUUID() }),
    }).path,
    plan.path,
  );
  const custom = worktreePlan(repo, item, 'main', {
    ...options,
    name: 'login-entry',
  });
  assert.match(path.basename(custom.path), /^login-entry-[a-f0-9]{12}$/);
  assert.equal(path.dirname(custom.path), path.dirname(plan.path));
  assert.equal(custom.branch, plan.branch);
  fs.mkdirSync(custom.path, { recursive: true });
  assert.throws(() => createWorktree(custom), /already exists/);
  assert.throws(() =>
    worktreePlan(repo, item, 'main', { ...options, name: '../../escape' }),
  );
  assert.match(
    path.basename(
      worktreePlan(repo, { id: '2', workspace_id: '1' }, 'main', { root }).path,
    ),
    /^tapd-[a-f0-9]{12}$/,
  );
});

test('manual upload HTTP requires same origin and token, checks bytes, and keeps JSON limits', async (t) => {
  const { channel, configFile } = fixture(t);
  const manager = new EventEmitter();
  manager.close = async () => {};
  const server = createWebServer({ testIdentity: true,
    configFile,
    manager,
    channels: new ChannelRegistry([channel]),
  });
  const origin = await server.listen(0);
  t.after(() => server.close());
  const bootstrap = await (await fetch(origin + '/api/bootstrap')).json();
  const url = origin + '/api/channels/manual/images';
  const headers = {
    'x-tapd-token': bootstrap.token,
    'content-type': 'image/png',
  };
  assert.equal((await fetch(url, { method: 'POST', body: png })).status, 403);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { ...headers, origin: 'https://example.invalid' },
        body: png,
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(url, { method: 'POST', headers, body: 'bad' })).status,
    400,
  );
  const response = await fetch(url, { method: 'POST', headers, body: png });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).bytes, png.length);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers,
        body: Buffer.alloc(10 * 1024 * 1024 + 1),
      })
    ).status,
    400,
  );
});

test(
  'manual Web session uses custom folder and local images, skips sync and prevents duplicate execution',
  { timeout: 20000 },
  async (t) => {
    const { channel, directory, configFile } = fixture(t);
    const repo = path.join(directory, 'repo');
    const git = repository(repo);
    (await saveSettings(
      {
        repository: repo,
        worktreeRoot: path.join(directory, 'worktrees'),
        baseRef: 'main',
        initCommands: [],
      },
      configFile,
    ));
    const client = new FakeClient();
    const manager = new SessionManager({
      configFile,
      runsDirectory: path.join(directory, 'runs'),
      client,
      channels: new ChannelRegistry([channel]),
    });
    t.after(() => manager.close());
    const input = {
      channel: 'manual',
      requestId: randomUUID(),
      title: '新增登录入口',
      images: [(await channel.uploadImage(png)).id],
      worktreeName: 'login-entry',
    };
    const started = await manager.start(input);
    const runtime = manager.sessions.get(started.key);
    while (!runtime.turnId) {
      if (runtime.status === 'failed')
        throw new Error('Manual task failed before turn start');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    client.notify('turn/completed', {
      turn: { id: runtime.turnId, status: 'completed' },
    });
    await runtime.operation;
    const state = (await manager.store.read(started.key));
    assert.match(path.basename(state.worktree.path), /^login-entry-[a-f0-9]{12}$/);
    assert.equal(state.transition.status, 'skipped');
    assert.equal(git('branch', '--show-current'), 'main');
    const sent = client.calls.find((call) => call.method === 'turn/start')
      .params.input;
    const image = sent.find((entry) => entry.type === 'localImage');
    assert.deepEqual(fs.readFileSync(image.path), png);
    assert.ok(sent[0].text.includes(input.title));
    const view = await manager.view(started.key);
    assert.equal(view.requirement.title, input.title);
    assert.equal(view.images.length, 1);
    await assert.rejects(manager.start(input), /已有运行记录/);
  },
);
