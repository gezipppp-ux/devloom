const { worktreeReason } = require("../../src/git/worktree-access.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { temporary } = require('../support/helpers.cjs');
const { listBaseRefs } = require('../../src/git/repository.cjs');
const { readSettings, saveSettings, executionConfig } = require('../../src/config/execution-settings.cjs');
const { samePath, absolutePath } = require('../../src/shared/paths.cjs');
const { worktreePlan } = require('../../src/git/worktrees.cjs');
const { repositoryFor } = require('../../src/config/repository.cjs');
const { sourceFor, runKey } = require('../../src/domain/run-identity.cjs');
const { ChannelRegistry } = require('../../src/channels/registry.cjs');
const { WebSessions } = require('../../src/application/sessions.cjs');
const { RunStore } = require('../../src/storage/run-store.cjs');
const { SessionPresenter } = require('../../src/application/session-presenter.cjs');
const { createWebServer } = require('../../src/http/server.cjs');
const { FakeClient } = require('../fixtures/web-client.cjs');

function repository(directory) {
  fs.mkdirSync(directory);
  const git = (...args) =>
    execFileSync('git', ['-C', directory, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'committed');
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

test('Web settings persist outside credentials, validate Git and place future worktrees in configured root', (t) => {
  const directory = temporary(t),
    repo = path.join(directory, '项目 repo'),
    configFile = path.join(directory, 'tapd.local.json');
  repository(repo);
  const credential = JSON.stringify({
    tapd: { session: { cookie_header: 'private-test' } },
    codex: { repository: repo },
  });
  fs.writeFileSync(configFile, credential);
  const root = path.join(directory, 'another disk');
  const saved = saveSettings(
    {
      repository: repo,
      worktreeRoot: root,
      baseRef: 'main',
      initCommands: ['pnpm install', 'pnpm build'],
    },
    configFile,
  );
  assert.equal(fs.readFileSync(configFile, 'utf8'), credential);
  assert.equal(readSettings(configFile).worktreeRoot, fs.realpathSync(root));
  assert.equal(JSON.stringify(saved).includes('private-test'), false);
  assert.throws(
    () =>
      saveSettings(
        { repository: repo, worktreeRoot: 'relative', baseRef: 'main' },
        configFile,
      ),
    /绝对路径/,
  );
  assert.throws(() =>
    saveSettings(
      { repository: repo, worktreeRoot: root, baseRef: 'does-not-exist' },
      configFile,
    ),
  );
  assert.throws(
    () =>
      saveSettings(
        { repository: repo, worktreeRoot: root, command: 'malicious' },
        configFile,
      ),
    /仅允许/,
  );
  assert.throws(
    () => saveSettings({ repository: repo, worktreeRoot: repo }, configFile),
    /不能等于/,
  );
  assert.equal(readSettings(configFile).baseRef, 'main');
  assert.deepEqual(readSettings(configFile).initCommands, [
    'pnpm install',
    'pnpm build',
  ]);
  const config = executionConfig({}, configFile);
  assert.deepEqual(config.codex.init_commands, ['pnpm install', 'pnpm build']);
  saveSettings(
    { repository: repo, worktreeRoot: root, baseRef: 'main' },
    configFile,
  );
  assert.deepEqual(readSettings(configFile).initCommands, [
    'pnpm install',
    'pnpm build',
  ]);
  saveSettings(
    { repository: repo, worktreeRoot: root, baseRef: 'main', initCommands: [] },
    configFile,
  );
  assert.deepEqual(readSettings(configFile).initCommands, []);
  assert.equal(repositoryFor(config, configFile, 'scope'), repo);
  const item = { workspace_id: 'scope', id: 'issue/123' },
    source = sourceFor('tracker', item);
  const plan = worktreePlan(repo, item, 'main', { root, source });
  assert.ok(
    path.relative(root, plan.path) &&
      !path.relative(root, plan.path).startsWith('..'),
  );
  assert.equal(plan.path.includes('issue/123'), false);
  assert.notEqual(
    plan.path,
    worktreePlan(repo, item, 'main', { root, source: sourceFor('other', item) })
      .path,
  );
});

test('path validation respects Linux case and Windows drives; repositories are explicit and scoped by channel', (t) => {
  assert.equal(samePath('/srv/Repo', '/srv/repo', 'linux'), false);
  assert.equal(samePath('D:\\Repo', 'd:\\repo', 'win32'), true);
  assert.equal(
    absolutePath('/srv/worktrees', 'root', 'linux'),
    '/srv/worktrees',
  );
  assert.throws(
    () => absolutePath('D:\\worktrees', 'root', 'linux'),
    /绝对路径/,
  );
  assert.equal(absolutePath('D:\\worktrees', 'root', 'win32'), 'D:\\worktrees');
  const directory = temporary(t),
    repo = path.join(directory, 'repo');
  repository(repo);
  assert.throws(
    () => repositoryFor({}, path.join(directory, 'config.json'), '1'),
    /配置/,
  );
  assert.equal(
    repositoryFor(
      { codex: { repositories: { 'tracker:1': repo, 1: 'wrong' } } },
      path.join(directory, 'config.json'),
      '1',
      'tracker',
    ),
    repo,
  );
});

test('a non-TAPD channel runs through real Git, session controller and history without TAPD credentials', async (t) => {
  const directory = temporary(t),
    repo = path.join(directory, 'repo');
  const git = repository(repo);
  const configFile = path.join(directory, 'missing.json');
  saveSettings(
    {
      repository: repo,
      worktreeRoot: path.join(directory, 'trees'),
      baseRef: 'main',
    },
    configFile,
  );
  const item = {
    id: 'DEV-42',
    workspace_id: 'platform',
    title: '来自第二渠道',
  };
  const calls = [];
  const channel = {
    id: 'tracker',
    capabilities: { assignees: false, search: true },
    describe: () => ({
      id: 'tracker',
      label: 'Test tracker',
      capabilities: { assignees: false, search: true },
      workspace: 'platform',
    }),
    resolve: async () => ({ item, config: {}, session: null }),
    search: async () => [item],
    prepare: async () => ({
      workitem: item,
      task: { execution_ready: true, images: [], codex_prompt: '实现测试需求' },
      target: 'developing',
    }),
    transition: async ({ state }) => {
      assert.ok(state.execution_started_at);
      calls.push('transition');
      return { verified_status: 'developing' };
    },
  };
  const channels = new ChannelRegistry([channel]),
    client = new FakeClient();
  const manager = new WebSessions({
    runsDirectory: path.join(directory, 'runs'),
    configFile,
    channels,
    client,
  });
  t.after(() => manager.close());
  const started = await manager.start({
    channel: 'tracker',
    id: item.id,
    workspace: item.workspace_id,
  });
  const runtime = manager.sessions.get(started.key);
  while (!runtime.turnId)
    await new Promise((resolve) => setTimeout(resolve, 1));
  client.notify('turn/completed', {
    turn: { id: runtime.turnId, status: 'completed' },
  });
  await runtime.operation;
  const state = manager.store.read(started.key);
  assert.equal(state.source.channel, 'tracker');
  assert.deepEqual(calls, ['transition']);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(worktreeReason(state), null);
  assert.equal(
    fs.readFileSync(path.join(state.worktree.path, 'a.txt'), 'utf8'),
    'committed',
  );
  assert.equal((await manager.view(started.key)).source.channel, 'tracker');
  await manager.send(started.key, '继续');
  assert.equal(client.calls.at(-1).params.threadId, 'original');
  const oldPath = state.worktree.path;
  saveSettings(
    {
      repository: repo,
      worktreeRoot: path.join(directory, 'new-root'),
      baseRef: 'main',
    },
    configFile,
  );
  assert.equal(manager.store.read(started.key).worktree.path, oldPath);
  await assert.rejects(manager.start({ channel: 'missing' }), /未接入/);
  await assert.rejects(manager.start({ channel: 'tracker' }), /已有运行记录/);
});

test('channel identity isolates duplicate IDs while legacy TAPD keys and images remain readable', (t) => {
  const item = { workspace_id: '1', id: '2' };
  assert.equal(runKey(sourceFor('tapd', item)), '1-2');
  assert.notEqual(
    runKey(sourceFor('tracker', item)),
    runKey(sourceFor('other', item)),
  );
  const store = new RunStore(temporary(t));
  assert.throws(() => store.dir('../secret'), /无效/);
  assert.throws(() => sourceFor('../tracker', item), /Invalid/);
  fs.mkdirSync(store.dir('1-2'));
  fs.writeFileSync(
    path.join(store.dir('1-2'), 'tapd-task.json'),
    JSON.stringify({
      images: [{ path: path.join(store.dir('1-2'), 'a.png') }],
    }),
  );
  const presenter = new SessionPresenter({ store });
  assert.equal(presenter.images('1-2').length, 1);
  assert.equal(presenter.summary('1-2', { workitem: item }).source.channel, 'tapd');
});

test('HTTP dispatches source searches and protects persisted settings with same-origin token', async (t) => {
  const directory = temporary(t),
    repo = path.join(directory, 'repo');
  repository(repo);
  const configFile = path.join(directory, 'tapd.local.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({ tapd: { session: { cookie_header: 'secret-cookie' } } }),
  );
  const calls = [];
  const channel = {
    id: 'fixture',
    capabilities: { search: true, assignees: true },
    describe: () => ({ id: 'fixture' }),
    resolve: async () => {},
    prepare: async () => {},
    transition: async () => {},
    search: async (input) => {
      calls.push(input);
      return [{ id: 'ISSUE-1' }];
    },
    searchUsers: async (input) => {
      calls.push(input);
      return [{ id: 'u', nick: '张三', name: '张三' }];
    },
  };
  const manager = new EventEmitter();
  manager.close = async () => {};
  const application = createWebServer({
    configFile,
    manager,
    channels: new ChannelRegistry([channel]),
  });
  const url = await application.listen(0);
  t.after(() => application.close());
  const { token } = await (await fetch(`${url}/api/bootstrap`)).json();
  const users = await (
    await fetch(`${url}/api/users?channel=fixture&workspace=team&query=zhang`)
  ).json();
  assert.equal(users.users[0].nick, '张三');
  assert.equal(calls.at(-1).workspace, 'team');
  assert.equal(
    (await fetch(`${url}/api/requirements?channel=missing`)).status,
    400,
  );
  assert.equal(
    (
      await (
        await fetch(`${url}/api/requirements?channel=fixture&workspace=team`)
      ).json()
    ).items[0].id,
    'ISSUE-1',
  );
  const payload = JSON.stringify({
    repository: repo,
    worktreeRoot: path.join(directory, 'worktrees'),
    baseRef: 'main',
  });
  assert.equal(
    (
      await fetch(`${url}/api/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${url}/api/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tapd-token': token },
        body: payload,
      })
    ).status,
    200,
  );
  const settings = await (await fetch(`${url}/api/settings`)).text();
  assert.ok(!settings.includes('secret-cookie'));
});

test('installation-independent data directory routes configuration outside the source package', (t) => {
  const directory = temporary(t);
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `process.stdout.write(require(${JSON.stringify(path.resolve(__dirname, '../../src/cli/arguments.cjs'))}).configPath())`,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, RUNNER_DATA_DIR: directory, TAPD_CONFIG: '' },
    },
  );
  assert.equal(output, path.join(directory, 'config', 'tapd.local.json'));
});

test('base reference options distinguish branches and tags, omit symbolic remotes and never switch branches', (t) => {
  const directory = temporary(t),
    repo = path.join(directory, 'repo');
  const git = repository(repo);
  git('branch', 'feature/payment');
  git('tag', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const refs = listBaseRefs(repo);
  assert.ok(refs.some((ref) => ref.value === 'HEAD'));
  assert.ok(
    refs.some((ref) => ref.value === 'refs/heads/main' && ref.kind === 'local'),
  );
  assert.ok(
    refs.some((ref) => ref.value === 'refs/tags/main' && ref.kind === 'tag'),
  );
  assert.ok(
    refs.some(
      (ref) =>
        ref.value === 'refs/remotes/origin/main' && ref.kind === 'remote',
    ),
  );
  assert.ok(!refs.some((ref) => ref.value === 'refs/remotes/origin/HEAD'));
  assert.equal(git('branch', '--show-current'), 'main');
  assert.throws(() => listBaseRefs('relative-path'), /绝对路径/);
});
