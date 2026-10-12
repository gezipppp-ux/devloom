const { startFixtureSession } = require("../support/cli-execution.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { runExecution } = require('../../src/execution/runner.cjs');
function createFixtureChannel(_configFile, services) {
  return { id: 'tracker', async prepare({session,item,directory,config}) {
    const workitem = await services.detail(session,item);
    const task = await services.buildTask(workitem,session,directory,config);
    if (!task.execution_ready) throw new Error(task.blocked_reason);
    return {workitem,task};
  }, async transition() { return {status: 'skipped'}; } };
}
const { saveState } = require('../../src/storage/run-state.cjs');
const { SessionManager } = require('../support/session-manager.cjs');
const { FakeClient } = require('../fixtures/web-client.cjs');
const { item, png, session, temporary, workflow } = require('../support/helpers.cjs');

function runRequirement(input, dependencies = {}) {
  return runExecution(
    { ...input, channel: createFixtureChannel(input.configFile, dependencies) },
    dependencies,
  );
}

function setup(t) {
  const directory = temporary(t);
  const calls = [];
  const input = {
    config: { agent: { provider: "codex" }, workflow: { allow_write: true } },
    configFile: path.join(directory, 'config.json'),
    session,
    item,
    directory,
  };
  const dependencies = {
    repositoryCommonDirectory: (repository) => repository,
    fetchDevelopmentBaseline: async () => ({ remote: "origin", branch: "main", commit: "a".repeat(40), fetchedAt: new Date().toISOString() }),
    repositoryFor: () => directory,
    detail: async () => item,
    buildTask: async () => ({
      images: [],
      execution_ready: true,
      prompt: 'test',
    }),
    workflowInfo: async () => workflow,
    worktreePlan: () => ({
      path: path.join(directory, 'tree'),
      branch: 'codex/test',
    }),
    createWorktree: () => calls.push('worktree'),
    startSession: async ({ onSession, onStarted }) => {
      calls.push('session');
      await onSession('session-id');
      const saved = JSON.parse(
        fs.readFileSync(path.join(directory, 'run.json')),
      );
      assert.equal(saved.session_id, 'session-id');
      await onStarted();
      return { completed: true, exit_code: 0 };
    },
    applyTransition: async () => {
      const saved = JSON.parse(
        fs.readFileSync(path.join(directory, 'run.json')),
      );
      assert.ok(saved.execution_started_at);
      calls.push('transition');
      return { verified_status: 'developing' };
    },
  };
  return { calls, input, dependencies };
}

test('channel execution skips status writes, persists results and prevents duplicate dispatch', async (t) => {
  const { calls, input, dependencies } = setup(t);
  const state = await runRequirement(input, dependencies);
  assert.equal(state.execution.status, 'completed');
  assert.equal(state.transition.status, 'skipped');
  assert.equal(fs.existsSync(path.join(input.directory, '.lock')), false);
  assert.deepEqual(calls, ['worktree', 'session']);
  assert.equal((await runRequirement(input, dependencies)).reused, true);
  assert.equal(
    (await runRequirement({ ...input, retry: true }, dependencies)).reused,
    true,
  );
  assert.deepEqual(calls, ['worktree', 'session']);
});

test('initialization runs between worktree creation and Codex; failure prevents session and transition', async (t) => {
  for (const fail of [false, true]) {
    const { calls, input, dependencies } = setup(t);
    input.config.execution = { initCommands: ['pnpm install'] };
    dependencies.initializeWorktree = async ({ cwd, commands, onUpdate }) => {
      assert.equal(cwd, path.join(input.directory, 'tree'));
      assert.deepEqual(commands, ['pnpm install']);
      calls.push('initialize');
      await onUpdate({ status: fail ? 'failed' : 'completed', commands: [] }, 0);
      if (fail) throw new Error('initialization failed');
    };
    if (fail) {
      await assert.rejects(
        runRequirement(input, dependencies),
        /initialization failed/,
      );
      assert.deepEqual(calls, ['worktree', 'initialize']);
      const state = JSON.parse(
        fs.readFileSync(path.join(input.directory, 'run.json')),
      );
      assert.equal(state.execution.status, 'failed');
      assert.equal(state.transition.status, 'not_started');
      assert.equal(state.session_id, null);
      assert.equal(state.initialization.status, 'failed');
    } else {
      await runRequirement(input, dependencies);
      assert.deepEqual(calls, [
        'worktree',
        'initialize',
        'session',
      ]);
      await runRequirement(input, dependencies);
      assert.equal(calls.filter((call) => call === 'initialize').length, 1);
    }
  }
});

test('skipped channel transition retries are skipped without writes or redispatch', async (t) => {
  const { calls, input, dependencies } = setup(t);
  const state = await runRequirement(input, dependencies);
  state.transition = { status: 'failed', error: 'legacy transition failure' };
  (await saveState(path.join(input.directory, 'run.json'), state));
  dependencies.detail = () => { throw new Error('no longer in todo'); };
  const retried = await runRequirement({ ...input, retry: true }, dependencies);
  assert.equal(retried.transition.status, 'skipped');
  assert.deepEqual(calls, ['worktree', 'session']);
});

test('failed startup never transitions and retry cannot manufacture an execution start', async (t) => {
  const { calls, input, dependencies } = setup(t);
  dependencies.startSession = async ({ onSession }) => {
    onSession('created-only');
    throw new Error('authentication failed');
  };
  const state = await runRequirement(input, dependencies);
  assert.equal(state.execution.status, 'failed');
  assert.equal(state.transition.status, 'not_started');
  assert.deepEqual(calls, ['worktree']);
  await assert.rejects(
    runRequirement({ ...input, retry: true }, dependencies),
    /No confirmed execution/,
  );
});

test('transition retry preserves a concurrent Web followup on success and failure', async (t) => {
  for (const fail of [false, true]) {
    const root = temporary(t);
    const configFile = path.join(root, 'config.json');
    const client = new FakeClient();
    const manager = new SessionManager({
      runsDirectory: path.join(root, 'runs'),
      configFile,
      client,
    });
    const key = '1-2';
    const directory = manager.store.dir(key);
    const file = path.join(directory, 'run.json');
    fs.mkdirSync(directory, { recursive: true });
    const workitem = { id: '2', workspace_id: '1', title: 'retry fixture' };
    (await saveState(file, {
      agent: { provider: "codex" },
      workitem,
      worktree: { path: directory },
      session_id: 'original',
      execution_started_at: new Date().toISOString(),
      execution: { status: 'completed' },
      transition: { status: 'failed' },
    }));
    manager.worktreeReason = () => null;
    manager.runtime(key, 'original').connected = true;
    const entered = Promise.withResolvers();
    const finish = Promise.withResolvers();
    const retry = runExecution({
      config: { workspace: {}, agent: { provider: "codex" } },
      configFile,
      item: workitem,
      directory,
      retry: true,
      channel: {
        id: 'tapd',
        async transition() {
          entered.resolve();
          await finish.promise;
          if (fail) throw new Error('retry rejected');
          return { verified_status: 'developing' };
        },
      },
    });
    try {
      await entered.promise;
      await manager.send(key, 'continue during the transition retry');
      assert.equal((await manager.store.read(key)).execution.status, 'running');
      finish.resolve();
      const result = await retry;
      assert.equal(result.execution.status, 'running');
      assert.equal(result.transition.status, fail ? 'failed' : 'succeeded');
      assert.equal((await manager.store.read(key)).execution.status, 'running');
      await manager.interrupt(key);
      const completed = (await manager.store.read(key));
      assert.equal(completed.execution.status, 'interrupted');
      assert.deepEqual(completed.transition, result.transition);
    } finally {
      finish.resolve();
      await retry;
      await manager.close();
    }
  }
});

test('missing images fail before worktree or session', async (t) => {
  const { calls, input, dependencies } = setup(t);
  dependencies.buildTask = async () => {
    throw new Error('image download failed');
  };
  await assert.rejects(runRequirement(input, dependencies), /image download/);
  assert.equal(fs.existsSync(path.join(input.directory, '.lock')), false);

  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(input.directory, 'run.json')), false);
});

test('exclusive lock blocks concurrent dispatch; uncertain state is not redispatched', async (t) => {
  const { calls, input, dependencies } = setup(t);
  fs.mkdirSync(path.join(input.directory, '.lock'));
  await assert.rejects(runRequirement(input, dependencies), /locked/);
  assert.equal(fs.existsSync(path.join(input.directory, '.lock')), true,
    'a rejected runner must preserve the existing owner lock');
  fs.rmdirSync(path.join(input.directory, '.lock'));
  fs.writeFileSync(
    path.join(input.directory, 'run.json'),
    JSON.stringify({
      agent: { provider: "codex" },
      source: { channel: "tracker", scope: item.workspace_id, id: item.id },
      workitem: item,
      execution: { status: 'starting' },
      transition: { status: 'not_started' },
    }),
  );
  assert.equal((await runRequirement(input, dependencies)).reused, true);
  assert.deepEqual(calls, []);
});

test('full pipeline uses one real Git worktree, image attachment and simulated Codex, preserving root changes', async (t) => {
  const temporaryRoot = temporary(t);
  const repository = path.join(temporaryRoot, 'repo');
  const directory = path.join(temporaryRoot, 'run');
  fs.mkdirSync(repository);
  const git = (...args) =>
    execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(repository, 'tracked.txt'), 'committed');
  git('add', 'tracked.txt');
  git(
    '-c',
    'user.name=TAPD Test',
    '-c',
    'user.email=tapd-test@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-m',
    'test fixture',
  );
  const remote = path.join(temporaryRoot, 'remote.git');
  git('clone', '--bare', repository, remote);
  git('remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(repository, 'tracked.txt'), 'root dirty');
  fs.writeFileSync(path.join(repository, 'untracked.txt'), 'root untracked');
  const withImage = {
    ...item,
    description: `<img src="data:image/png;base64,${png.toString('base64')}">`,
  };
  const state = await runRequirement(
    {
      item,
      session,
      directory,
      configFile: path.join(temporaryRoot, 'config.json'),
      config: {
        workflow: { allow_write: true },
        execution: {
          repository,
          baseBranch: 'main',
          worktreeRoot: path.join(temporaryRoot, 'external-worktrees'),
        },
        agent: {
          provider: "codex",
          options: {
            command: process.execPath,
            command_args: [path.join(__dirname, '../fixtures/codex.cjs'), 'success'],
          },
        },
      },
    },
    {
      startSession: startFixtureSession,
      detail: async () => withImage,
      buildTask: async (_item, _session, target) => {
        const image = path.join(target, '01.png');
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(image, png);
        return { prompt: 'Implement the fixture requirement', images: [{path: image}], execution_ready: true };
      },
      workflowInfo: async () => workflow,
      applyTransition: async () => ({ verified_status: 'developing' }),
    },
  );
  assert.equal(state.execution.status, 'completed');
  assert.equal(state.transition.status, 'skipped');
  assert.equal(state.image_count, 1);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(
    fs.readFileSync(path.join(repository, 'tracked.txt'), 'utf8'),
    'root dirty',
  );
  assert.equal(
    fs.readFileSync(path.join(state.worktree.path, 'tracked.txt'), 'utf8'),
    'committed',
  );
  assert.equal(
    fs.existsSync(path.join(state.worktree.path, 'untracked.txt')),
    false,
  );
  fs.writeFileSync(
    path.join(state.worktree.path, 'codex-result.txt'),
    'isolated',
  );
  assert.equal(fs.existsSync(path.join(repository, 'codex-result.txt')), false);
  const final = JSON.parse(fs.readFileSync(path.join(directory, 'final.md')));
  assert.equal(final.cwd, state.worktree.path);
  assert.ok(final.args.includes('--image'));
  assert.match(state.worktree.branch, /^codex\/[a-f0-9]{12}$/);
  const otherPath = path.join(
    temporaryRoot,
    'changed-worktree-root',
    'same-task',
  );
  const { createWorktree } = require('../../src/git/worktrees.cjs');
  assert.throws(
    () => createWorktree({ ...state.worktree, path: otherPath }),
    /任务分支已存在/,
  );
  assert.equal(fs.existsSync(otherPath), false);
  assert.equal(
    fs.readFileSync(path.join(state.worktree.path, 'codex-result.txt'), 'utf8'),
    'isolated',
  );
});

test('execution awaits asynchronous channel validation and worktree creation before starting Codex', async (t) => {
  const { calls, input, dependencies } = setup(t);
  const channel = createFixtureChannel(input.configFile, dependencies);
  let releaseValidation, releaseWorktree, enteredValidation, enteredWorktree;
  const validating = new Promise(resolve => { enteredValidation = resolve; });
  const creating = new Promise(resolve => { enteredWorktree = resolve; });
  const validationGate = new Promise(resolve => { releaseValidation = resolve; });
  const worktreeGate = new Promise(resolve => { releaseWorktree = resolve; });
  channel.validate = async () => { enteredValidation(); await validationGate; calls.push('validated'); };
  dependencies.createWorktree = async () => { enteredWorktree(); await worktreeGate; calls.push('worktree'); };
  const execution = runExecution({ ...input, channel }, dependencies);
  try {
    await validating;
    assert.deepEqual(calls, []);
    releaseValidation();
    await creating;
    assert.deepEqual(calls, ['validated']);
    releaseWorktree();
    assert.equal((await execution).execution.status, 'completed');
    assert.deepEqual(calls, ['validated', 'worktree', 'session']);
  } finally { releaseValidation(); releaseWorktree(); }
});
