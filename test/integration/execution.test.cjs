const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { runExecution } = require('../../src/execution/runner.cjs');
const { createTapdChannel } = require('../../src/channels/tapd/adapter.cjs');
const { saveState } = require('../../src/storage/run-state.cjs');
const { SessionManager } = require('../../src/application/session-manager.cjs');
const { FakeClient } = require('../fixtures/web-client.cjs');
const { item, png, session, temporary, workflow } = require('../support/helpers.cjs');

function runRequirement(input, dependencies = {}) {
  return runExecution(
    { ...input, channel: createTapdChannel(input.configFile, dependencies) },
    dependencies,
  );
}

function setup(t) {
  const directory = temporary(t);
  const calls = [];
  const input = {
    config: { workflow: { allow_write: true } },
    configFile: path.join(directory, 'config.json'),
    session,
    item,
    directory,
  };
  const dependencies = {
    repositoryFor: () => directory,
    detail: async () => item,
    buildTask: async () => ({
      images: [],
      execution_ready: true,
      codex_prompt: 'test',
    }),
    workflowInfo: async () => workflow,
    worktreePlan: () => ({
      path: path.join(directory, 'tree'),
      branch: 'codex/test',
    }),
    createWorktree: () => calls.push('worktree'),
    startSession: async ({ onSession, onStarted }) => {
      calls.push('session');
      onSession('session-id');
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

test('session execution precedes status write, persists results and prevents duplicate dispatch', async (t) => {
  const { calls, input, dependencies } = setup(t);
  const state = await runRequirement(input, dependencies);
  assert.equal(state.execution.status, 'completed');
  assert.equal(state.transition.status, 'succeeded');
  assert.equal(fs.existsSync(path.join(input.directory, '.lock')), false);
  assert.deepEqual(calls, ['worktree', 'session', 'transition']);
  assert.equal((await runRequirement(input, dependencies)).reused, true);
  assert.equal(
    (await runRequirement({ ...input, retry: true }, dependencies)).reused,
    true,
  );
  assert.deepEqual(calls, ['worktree', 'session', 'transition']);
});

test('initialization runs between worktree creation and Codex; failure prevents session and transition', async (t) => {
  for (const fail of [false, true]) {
    const { calls, input, dependencies } = setup(t);
    input.config.codex = { init_commands: ['pnpm install'] };
    dependencies.initializeWorktree = async ({ cwd, commands, onUpdate }) => {
      assert.equal(cwd, path.join(input.directory, 'tree'));
      assert.deepEqual(commands, ['pnpm install']);
      calls.push('initialize');
      onUpdate({ status: fail ? 'failed' : 'completed', commands: [] }, 0);
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
        'transition',
      ]);
      await runRequirement(input, dependencies);
      assert.equal(calls.filter((call) => call === 'initialize').length, 1);
    }
  }
});

test('transition retry works after todo removal, without another detail fetch or session', async (t) => {
  const { calls, input, dependencies } = setup(t);
  let attempts = 0;
  dependencies.applyTransition = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('network failure');
    return { verified_status: 'developing' };
  };
  let state = await runRequirement(input, dependencies);
  assert.equal(state.execution.status, 'completed');
  assert.equal(state.transition.status, 'failed');
  dependencies.detail = () => {
    throw new Error('no longer in todo');
  };
  state = await runRequirement({ ...input, retry: true }, dependencies);
  assert.equal(state.transition.status, 'succeeded');
  assert.deepEqual(calls, ['worktree', 'session']);
  assert.equal(attempts, 2);
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
    saveState(file, {
      workitem,
      worktree: { path: directory },
      session_id: 'original',
      execution_started_at: new Date().toISOString(),
      execution: { status: 'completed' },
      transition: { status: 'failed' },
    });
    manager.worktreeReason = () => null;
    manager.runtime(key, 'original').connected = true;
    const entered = Promise.withResolvers();
    const finish = Promise.withResolvers();
    const retry = runExecution({
      config: { workspace: {} },
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
      assert.equal(manager.store.read(key).execution.status, 'running');
      finish.resolve();
      const result = await retry;
      assert.equal(result.execution.status, 'running');
      assert.equal(result.transition.status, fail ? 'failed' : 'succeeded');
      assert.equal(manager.store.read(key).execution.status, 'running');
      await manager.interrupt(key);
      const completed = manager.store.read(key);
      assert.equal(completed.execution.status, 'interrupted');
      assert.deepEqual(completed.transition, result.transition);
    } finally {
      finish.resolve();
      await retry;
      await manager.close();
    }
  }
});

test('missing images or required fields fail before worktree, session or TAPD mutation', async (t) => {
  const { calls, input, dependencies } = setup(t);
  dependencies.buildTask = async () => {
    throw new Error('image download failed');
  };
  await assert.rejects(runRequirement(input, dependencies), /image download/);
  assert.equal(fs.existsSync(path.join(input.directory, '.lock')), false);
  dependencies.buildTask = async () => ({ images: [], execution_ready: true });
  dependencies.workflowInfo = async () => ({
    ...workflow,
    my_all_transitions: [
      {
        ...workflow.my_all_transitions[0],
        Appendfield: [{ FieldName: 'tester', Notnull: 'yes' }],
      },
    ],
  });
  await assert.rejects(runRequirement(input, dependencies), /tester/);
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
        codex: {
          repository,
          worktree_root: path.join(temporaryRoot, 'external-worktrees'),
          command: process.execPath,
          command_args: [path.join(__dirname, '../fixtures/codex.cjs'), 'success'],
        },
      },
    },
    {
      detail: async () => withImage,
      workflowInfo: async () => workflow,
      applyTransition: async () => ({ verified_status: 'developing' }),
    },
  );
  assert.equal(state.execution.status, 'completed');
  assert.equal(state.transition.status, 'succeeded');
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
