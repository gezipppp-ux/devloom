const { attachOrigin } = require("../support/baseline-origin.cjs");
const { worktreeReason } = require("../../src/git/worktree-access.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { temporary } = require('../support/helpers.cjs');
const { listBaseBranches } = require('../../src/git/repository.cjs');
const { readSettings, saveSettings, executionConfig } = require('../../src/config/execution-settings.cjs');
const { samePath, absolutePath } = require('../../src/shared/paths.cjs');
const { worktreePlan, createWorktree } = require('../../src/git/worktrees.cjs');
const { repositoryFor } = require('../../src/config/repository.cjs');
const { sourceFor, runKey } = require('../../src/domain/run-identity.cjs');
const { ChannelRegistry } = require('../../src/channels/channel-registry.cjs');
const { SessionManager } = require('../support/session-manager.cjs');
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
  attachOrigin(directory);
  return git;
}

test('Web settings persist outside credentials, validate Git and place future worktrees in configured root', async (t) => {
  const directory = temporary(t),
    repo = path.join(directory, '项目 repo'),
    configFile = path.join(directory, 'tapd.local.json');
  repository(repo);
  const credential = JSON.stringify({
    agent: { provider: "codex" },
    tapd: { session: { cookie_header: 'private-test' } },
    execution: { repository: repo },
  });
  fs.writeFileSync(configFile, credential);
  const root = path.join(directory, 'another disk');
  const saved = (await saveSettings(
    {
      repository: repo,
      worktreeRoot: root,
      baseBranch: 'main',
      initCommands: ['pnpm install', 'pnpm build'],
    },
    configFile,
  ));
  assert.equal(fs.readFileSync(configFile, 'utf8'), credential);
  assert.equal((await readSettings(configFile)).worktreeRoot, fs.realpathSync(root));
  assert.equal(JSON.stringify(saved).includes('private-test'), false);
  (await assert.rejects(
    async () =>
      (await saveSettings(
        { repository: repo, worktreeRoot: 'relative', baseBranch: 'main' },
        configFile,
      )),
    /绝对路径/,
  ));
  (await assert.rejects(async () =>
    (await saveSettings(
      { repository: repo, worktreeRoot: root, baseBranch: 'refs/heads/main' },
      configFile,
    )),
  ));
  (await assert.rejects(
    async () =>
      (await saveSettings(
        { repository: repo, worktreeRoot: root, command: 'malicious' },
        configFile,
      )),
    /仅允许/,
  ));
  (await assert.rejects(
    async () => (await saveSettings({ repository: repo, worktreeRoot: repo }, configFile)),
    /不能等于/,
  ));
  assert.equal((await readSettings(configFile)).baseBranch, 'main');
  assert.deepEqual((await readSettings(configFile)).initCommands, [
    'pnpm install',
    'pnpm build',
  ]);
  const config = (await executionConfig({ agent: { provider: "codex" } }, configFile));
  assert.deepEqual(config.execution.initCommands, ['pnpm install', 'pnpm build']);
  (await saveSettings(
    { repository: repo, worktreeRoot: root, baseBranch: 'main' },
    configFile,
  ));
  assert.deepEqual((await readSettings(configFile)).initCommands, [
    'pnpm install',
    'pnpm build',
  ]);
  (await saveSettings(
    { repository: repo, worktreeRoot: root, baseBranch: 'main', initCommands: [] },
    configFile,
  ));
  assert.deepEqual((await readSettings(configFile)).initCommands, []);
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
      { execution: { repositories: { 'tracker:1': repo, 1: 'wrong' } } },
      path.join(directory, 'config.json'),
      '1',
      'tracker',
    ),
    repo,
  );
});

test('repository settings and continuation preserve Unicode, spaces and filesystem aliases', async (t) => {
  const directory = temporary(t);
  const repo = path.join(directory, process.platform === 'win32' ? '项目 repo' : '项目 repo ');
  repository(repo);
  const alias = path.join(directory, 'repository alias');
  fs.symlinkSync(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const configFile = path.join(directory, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ agent: { provider: "codex" } }));
  const root = path.join(directory, process.platform === 'win32' ? '任务 trees' : '任务 trees ');
  const settings = (await saveSettings({ repository: alias, worktreeRoot: root }, configFile));
  assert.equal(settings.repository, fs.realpathSync(repo));
  assert.equal(settings.worktreeRoot, fs.realpathSync(root));
  const config = (await executionConfig({ agent: { provider: "codex" } }, configFile));
  assert.equal(repositoryFor(config, configFile, '1'), fs.realpathSync(repo));
  const plan = await createWorktree(worktreePlan(settings.repository, { workspace_id: '1', id: '9' }, 'HEAD', { root, source: { channel: 'tracker', scope: '1', id: '9' } }));
  assert.equal(worktreeReason({ worktree: plan }), null);
  if (process.platform === 'win32')
    assert.equal(worktreeReason({ worktree: { ...plan, path: path.toNamespacedPath(plan.path) } }), null);
});

test('a non-TAPD channel runs through real Git, session controller and history without TAPD credentials', async (t) => {
  const directory = temporary(t),
    repo = path.join(directory, 'repo');
  const git = repository(repo);
  const configFile = path.join(directory, 'missing.json');
  fs.writeFileSync(configFile, JSON.stringify({ agent: { provider: "codex" } }));
  (await saveSettings(
    {
      repository: repo,
      worktreeRoot: path.join(directory, 'trees'),
      baseBranch: 'main',
    },
    configFile,
  ));
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
    resolve: async () => ({ item, config: { agent: { provider: "codex" } }, session: null }),
    search: async () => [item],
    prepare: async () => ({
      workitem: item,
      task: { execution_ready: true, images: [], prompt: '实现测试需求' },
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
  const manager = new SessionManager({
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
  const state = (await manager.store.read(started.key));
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
  (await saveSettings(
    {
      repository: repo,
      worktreeRoot: path.join(directory, 'new-root'),
      baseBranch: 'main',
    },
    configFile,
  ));
  assert.equal((await manager.store.read(started.key)).worktree.path, oldPath);
  await assert.rejects(manager.start({ channel: 'missing' }), /未接入/);
  await assert.rejects(manager.start({ channel: 'tracker' }), /已有运行记录/);
});

test('channel identity isolates duplicate IDs while preserving recorded TAPD source and images', async (t) => {
  const item = { workspace_id: '1', id: '2' };
  assert.match(runKey(sourceFor('tapd', item)), /^tapd-[a-f0-9]{32}$/);
  assert.notEqual(
    runKey(sourceFor('tracker', item)),
    runKey(sourceFor('other', item)),
  );
  const store = new RunStore(temporary(t));
  assert.throws(() => store.dir('../secret'), /无效/);
  assert.throws(() => sourceFor('../tracker', item), /Invalid/);
  fs.mkdirSync(store.dir('1-2'));
  fs.writeFileSync(
    path.join(store.dir('1-2'), 'requirement.json'),
    JSON.stringify({
      images: [{ path: path.join(store.dir('1-2'), 'a.png') }],
    }),
  );
  const presenter = new SessionPresenter({ store });
  assert.equal((await presenter.images('1-2')).length, 1);
  assert.equal((await presenter.summary('1-2', {
    workitem: item, source: sourceFor('tapd', item), agent: { provider: "codex" },
  })).source.channel, 'tapd');
});

test('HTTP dispatches source searches and protects persisted settings with same-origin token', async (t) => {
  const directory = temporary(t),
    repo = path.join(directory, 'repo');
  repository(repo);
  const configFile = path.join(directory, 'tapd.local.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({ agent: { provider: "codex" }, tapd: { session: { cookie_header: 'secret-cookie' } } }),
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
  const application = createWebServer({ testIdentity: true,
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
    baseBranch: 'main',
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
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: payload,
      })
    ).status,
    200,
  );
  const settings = await (await fetch(`${url}/api/settings`)).text();
  assert.ok(!settings.includes('secret-cookie'));
});

test('baseline options only list origin branches and never switch the checkout', (t) => {
  const directory = temporary(t),
    repo = path.join(directory, 'repo');
  const git = repository(repo);
  git('branch', 'feature/payment');
  git('tag', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git('update-ref', 'refs/remotes/other/private', 'HEAD');
  const branches = listBaseBranches(repo);
  assert.deepEqual(branches, [{ value: 'main', label: 'origin/main', name: 'main' }]);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.throws(() => listBaseBranches('relative-path'), /绝对路径/);
});
