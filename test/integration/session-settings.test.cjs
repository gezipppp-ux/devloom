const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { setImmediate: afterMicrotasks } = require('node:timers/promises');
const { RunStore } = require('../../src/storage/run-store.cjs');
const { SessionManager } = require('../support/session-manager.cjs');
const { WorkspaceManager } = require('../../src/application/workspace-manager.cjs');
const { createWebServer } = require('../../src/http/server.cjs');
const { FakeClient } = require('../fixtures/web-client.cjs');
const { temporary } = require('../support/helpers.cjs');

const defaults = { model: '', reasoningEffort: '', permissionMode: 'ask' };
const selected = {
  model: 'fixture-model-a', reasoningEffort: 'high', permissionMode: 'ask',
};
const next = {
  model: 'fixture-model-b', reasoningEffort: 'medium', permissionMode: 'full',
};

function saveRun(store, key, directory) {
  const state = {
    source: { channel: 'tapd', workspace: '1', id: key.slice(2) },
    agent: { provider: "codex" },
    workitem: { title: '设置回归测试', id: key.slice(2), workspace_id: '1' },
    worktree: { path: directory, repository: directory, branch: 'codex/fixture' },
    session_id: 'original',
    execution: { status: 'completed' },
    transition: { status: 'succeeded' },
  };
  fs.mkdirSync(store.dir(key), { recursive: true });
  fs.writeFileSync(path.join(store.dir(key), 'run.json'), JSON.stringify(state));
  store.writeTaskMetadata(key, { type: 'bug', progress: 'review' });
  return state;
}

async function setup(t) {
  const directory = temporary(t);
  const store = new RunStore(directory);
  const key = '1-2';
  const state = saveRun(store, key, directory);
  const client = new FakeClient();
  const configFile = path.join(directory, 'config.json');
  const manager = new SessionManager({ store, client, configFile, worktreeReason: () => null });
  const application = createWebServer({ testIdentity: true, manager, configFile });
  const origin = await application.listen(0);
  t.after(() => application.close());
  const { token } = await (await fetch(`${origin}/api/bootstrap`)).json();
  const post = (action, input, extraHeaders = {}) => fetch(`${origin}/api/runs/${key}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, ...extraHeaders },
    body: JSON.stringify(input),
  });
  async function settings(input) {
    const response = await post('execution-settings', input);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  return { directory, store, key, state, client, manager, configFile, origin, post, settings };
}

test('explicit agent sessions default to ask; idle settings persist without starting or resuming a turn', async (t) => {
  const { manager, key, client, settings, store, state } = await setup(t);
  const initial = await manager.view(key);
  assert.deepEqual(initial.executionSettings, defaults);
  assert.equal(initial.activeExecutionSettings, null);
  assert.equal(initial.settingsPending, false);
  client.calls.length = 0;
  const events = [];
  manager.on('event', (event) => events.push(event));
  assert.deepEqual(await settings(selected), { executionSettings: selected, pending: false });
  assert.ok(client.calls.every((call) => call.method === 'model/list'));
  const event = events.find((entry) => entry.type === 'execution-settings');
  assert.equal(event.key, key);
  assert.deepEqual(event.executionSettings, selected);
  assert.equal(event.settingsPending, false);
  const saved = (await store.read(key));
  for (const field of ['source', 'workitem', 'worktree', 'session_id', 'execution', 'transition'])
    assert.deepEqual(saved[field], state[field], field + ' must stay unchanged');
  assert.deepEqual((await store.readTaskMetadata(key)), { type: 'bug', progress: 'review' });
  assert.deepEqual((await manager.view(key)).executionSettings, selected);
  await manager.send(key, '使用已保存配置');
  const turn = client.calls.find((entry) => entry.method === 'turn/start');
  assert.equal(turn.params.model, selected.model);
  assert.equal(turn.params.effort, selected.reasoningEffort);
  assert.deepEqual((await manager.view(key)).activeExecutionSettings, selected);
});

test('active settings remain pending through approvals and steer, then apply to the next turn on the same session', async (t) => {
  const { manager, key, client, settings, store, state } = await setup(t);
  await settings(selected);
  const first = await manager.send(key, '第一轮');
  const originalTurn = structuredClone(client.calls.find((entry) => entry.method === 'turn/start'));
  client.emit('request', {
    id: 72,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'original', command: 'fixture-command' },
  });
  await manager.events.drain();
  assert.deepEqual(await settings(next), { executionSettings: next, pending: true });
  let view = await manager.view(key);
  assert.deepEqual(view.executionSettings, next);
  assert.deepEqual(view.activeExecutionSettings, selected);
  assert.equal(view.settingsPending, true);
  assert.equal(view.requests.length, 1, 'a pending setting must not approve or discard the current request');
  assert.deepEqual(client.calls.find((entry) => entry.method === 'turn/start'), originalTurn);
  await manager.respond(key, 'number:72', { decision: 'decline' });
  await manager.send(key, '仍补充第一轮');
  const steer = client.calls.findLast((entry) => entry.method === 'turn/steer');
  assert.equal(steer.params.expectedTurnId, first.turnId);
  for (const field of ['model', 'effort', 'approvalPolicy', 'approvalsReviewer', 'sandboxPolicy'])
    assert.equal(Object.hasOwn(steer.params, field), false);
  assert.equal((await manager.view(key)).settingsPending, true);
  await manager.interrupt(key);
  view = await manager.view(key);
  assert.deepEqual(view.executionSettings, next, 'completion must not overwrite saved settings');
  assert.equal(view.activeExecutionSettings, null);
  const second = await manager.send(key, '第二轮');
  assert.equal(second.sessionId, first.sessionId);
  assert.notEqual(second.turnId, first.turnId);
  const turn = client.calls.findLast((entry) => entry.method === 'turn/start');
  assert.equal(turn.params.model, next.model);
  assert.equal(turn.params.effort, next.reasoningEffort);
  view = await manager.view(key);
  assert.deepEqual(view.activeExecutionSettings, next);
  assert.equal(view.settingsPending, false);
  assert.deepEqual((await store.read(key)).worktree, state.worktree);
  assert.deepEqual((await store.read(key)).transition, state.transition);
  assert.equal(client.calls.filter((entry) => entry.method === 'thread/start').length, 0);
});

test('saved next-turn settings survive a new manager', async (t) => {
  const { manager, key, settings, directory, configFile } = await setup(t);
  await settings(next);
  await manager.close();
  const client = new FakeClient();
  const restarted = new SessionManager({
    store: new RunStore(directory), client, configFile, worktreeReason: () => null,
  });
  t.after(() => restarted.close());
  assert.deepEqual((await restarted.view(key)).executionSettings, next);
  await restarted.send(key, '重启后继续');
  assert.deepEqual((await restarted.view(key)).activeExecutionSettings, next);
  assert.equal(client.calls.find((entry) => entry.method === 'turn/start').params.model, next.model);
});

test('partial settings preserve other fields and explicit defaults clear model, effort and permission overrides', async (t) => {
  const { manager, key, settings, client } = await setup(t);
  await settings(next);
  const full = await manager.send(key, '完全访问轮');
  const fullTurn = client.calls.findLast((entry) => entry.method === 'turn/start');
  assert.equal(fullTurn.params.approvalPolicy, 'never');
  assert.deepEqual(fullTurn.params.sandboxPolicy, { type: 'dangerFullAccess' });
  await manager.interrupt(key);
  assert.deepEqual(await settings({ permissionMode: 'ask' }), {
    executionSettings: { ...next, permissionMode: 'ask' }, pending: false,
  });
  assert.deepEqual(await settings(defaults), { executionSettings: defaults, pending: false });
  const ask = await manager.send(key, '恢复默认配置');
  assert.equal(ask.sessionId, full.sessionId);
  const turn = client.calls.findLast((entry) => entry.method === 'turn/start');
  assert.equal(turn.params.model, 'fixture-model-a', 'default model must replace the previous override');
  assert.equal(turn.params.effort, 'low', 'default effort must replace the previous override');
  assert.equal(turn.params.approvalPolicy, 'on-request');
  assert.equal(turn.params.approvalsReviewer, 'user');
  assert.deepEqual(turn.params.sandboxPolicy, {
    type: 'workspaceWrite', writableRoots: [(await manager.store.read(key)).worktree.path],
    networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false,
  });
  assert.deepEqual((await manager.view(key)).activeExecutionSettings, defaults);
});

test('invalid, offline and failed settings writes leave disk and current settings untouched', async (t) => {
  const { store, key, settings, post, client, manager } = await setup(t);
  await settings(selected);
  const saved = fs.readFileSync(path.join(store.dir(key), 'run.json'), 'utf8');
  const savedSettings = (await store.readExecutionSettings(key));
  for (const input of [
    null, [], { permissionMode: 'unknown' }, { permissionMode: null },
    { permissionMode: false }, { model: null }, { reasoningEffort: null },
    { model: 'fixture-model-b', reasoningEffort: 'high' },
    { model: '', reasoningEffort: 'high' }, { model: 'missing' },
    { sandboxPolicy: { type: 'dangerFullAccess' } }, { approvalPolicy: 'never' },
  ]) {
    const response = await post('execution-settings', input);
    assert.equal(response.status, 400, JSON.stringify(input));
    assert.equal(fs.readFileSync(path.join(store.dir(key), 'run.json'), 'utf8'), saved);
    assert.deepEqual((await store.readExecutionSettings(key)), savedSettings);
  }
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === 'model/list') throw new Error('fixture model discovery offline');
    return request(method, params);
  };
  assert.equal((await post('execution-settings', next)).status, 400);
  client.request = request;
  const updateExecutionSettings = store.updateExecutionSettings.bind(store);
  store.updateExecutionSettings = () => { throw new Error('fixture settings write failed'); };
  try {
    assert.equal((await post('execution-settings', { permissionMode: 'full' })).status, 400);
  } finally {
    store.updateExecutionSettings = updateExecutionSettings;
  }
  assert.equal(fs.readFileSync(path.join(store.dir(key), 'run.json'), 'utf8'), saved);
  assert.deepEqual((await store.readExecutionSettings(key)), savedSettings);
  assert.deepEqual((await manager.view(key)).executionSettings, selected);
});

test('auto requires capabilities before saving settings or preparing new tasks on any channel', async (t) => {
  const { client, settings, post, manager, store } = await setup(t);
  client.inspectExecutionCapabilities = async () => ({ autoReview: false });
  assert.equal((await post('execution-settings', { permissionMode: 'auto' })).status, 400);
  assert.deepEqual(await settings({ permissionMode: 'full' }), {
    executionSettings: { ...defaults, permissionMode: 'full' }, pending: false,
  });
  for (const channel of ['manual', 'tapd']) {
    manager.channels = { get: () => ({ id: channel, resolve: () => assert.fail('must reject before source preparation') }) };
    await assert.rejects(manager.start({ channel, permissionMode: 'auto' }), /自动审批/);
    await assert.rejects(manager.start({ channel, permissionMode: 'unknown' }), /无效/);
  }
  assert.equal((await store.list()).length, 1);
  assert.equal(client.calls.filter(({ method }) => method === 'thread/start').length, 0);
});

test('a settings change cannot split an in-flight turn-start snapshot', async (t) => {
  const { settings, post, manager, key, client } = await setup(t);
  await settings(selected);
  const request = client.request.bind(client);
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  client.request = async (method, params) => {
    if (method === 'turn/start') { entered(); await gate; }
    return request(method, params);
  };
  const sending = manager.send(key, '延迟的本轮启动');
  await started;
  try {
    assert.equal((await post('execution-settings', next)).status, 400);
  } finally {
    release();
  }
  await sending;
  assert.deepEqual((await manager.view(key)).activeExecutionSettings, selected);
  assert.deepEqual(await settings(next), { executionSettings: next, pending: true });
  assert.deepEqual((await manager.view(key)).activeExecutionSettings, selected);
});

test('a failed applied-settings write leaves the started turn visible and interruptible', async (t) => {
  const { settings, manager, key, store } = await setup(t);
  await settings(next);
  const events = [];
  manager.on('event', (event) => events.push(event));
  const write = store.updateExecutionSettings.bind(store);
  store.updateExecutionSettings = () => { throw new Error('fixture applied settings unavailable'); };
  try {
    const result = await manager.send(key, '设置存盘异常时仍可停止');
    assert.ok(result.turnId);
    assert.equal(manager.sessions.get(key).connected, true);
    assert.equal(manager.sessions.get(key).status, 'running');
    assert.deepEqual((await manager.view(key)).activeExecutionSettings, next);
    assert.ok(events.some((event) => event.error?.includes('fixture applied settings unavailable')));
    await manager.interrupt(key);
    assert.equal(manager.sessions.get(key).turnId, null);
  } finally {
    store.updateExecutionSettings = write;
  }
});

test('late initial turn acknowledgement cannot overwrite newer saved and applied settings', async (t) => {
  const { manager, client, store, key, state, settings } = await setup(t);
  const file = path.join(store.dir(key), 'run.json');
  fs.unlinkSync(file);
  const initialState = {
    ...state,
    agent: { provider: "codex", ...selected },
  };
  manager.run = async (_input, { startSession }) => {
    await startSession({
      repository: state.worktree.path,
      task: { prompt: '第一轮延迟响应', images: [] },
      onSession(id) {
        initialState.session_id = id;
        fs.writeFileSync(file, JSON.stringify(initialState));
      },
      onStarted() {},
    });
    // The initial runner finishes from its own original configuration snapshot.
    // Saving that snapshot must never erase a pending choice saved by the UI.
    fs.writeFileSync(file, JSON.stringify(initialState));
    return initialState;
  };
  const request = client.request.bind(client);
  let enter, release, finish;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const acknowledged = new Promise((resolve) => { finish = resolve; });
  let first = true;
  client.request = async (method, params) => {
    const response = await request(method, params);
    if (method === 'turn/start' && first) {
      first = false;
      enter();
      await gate;
      finish();
    }
    return response;
  };
  (await manager.launch(key, state.workitem, { agent: initialState.agent }, {}, {}));
  const runtime = manager.sessions.get(key);
  try {
    await entered;
    assert.deepEqual(await settings(next), { executionSettings: next, pending: true });
    client.notify('turn/completed', { turn: { id: runtime.turnId, status: 'completed' } });
  await manager.events.drain();
    await runtime.operation;
    assert.deepEqual((await manager.view(key)).executionSettings, next);
    await manager.send(key, '后续一轮');
    await manager.interrupt(key);
    assert.deepEqual((await store.readExecutionSettings(key)).active, next);
    release();
    await acknowledged;
    await afterMicrotasks();
    assert.deepEqual((await store.readExecutionSettings(key)).active, next);
    assert.deepEqual((await manager.view(key)).executionSettings, next);
  } finally {
    release();
    if (runtime.turnId) await manager.interrupt(key);
    await runtime.operation;
  }
});

test('execution settings API keeps token, origin, read-only and workspace boundaries', async (t) => {
  const { post, manager, store, key } = await setup(t);
  assert.equal((await post('execution-settings', next, { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal((await post('execution-settings', next, { origin: 'https://foreign.invalid' })).status, 403);
  manager.worktreeReason = () => '原 worktree 已不可用';
  assert.equal((await post('execution-settings', next)).status, 400);
  assert.equal((await store.read(key)).codex, undefined);

  const directory = temporary(t);
  const workspaces = new WorkspaceManager({
    directory: path.join(directory, 'workspaces'),
    createManager: (options) => new SessionManager({ ...options, client: new FakeClient(), worktreeReason: () => null }),
  });
  const a = (await workspaces.save({ name: '设置 A' }));
  const b = (await workspaces.save({ name: '设置 B' }));
  const aContext = (await workspaces.get(a.id));
  const bContext = (await workspaces.get(b.id));
  saveRun(aContext.sessions.store, key, directory);
  const application = createWebServer({ testIdentity: true, workspaces });
  const origin = await application.listen(0);
  t.after(() => application.close());
  const { token } = await (await fetch(`${origin}/api/bootstrap`)).json();
  const scoped = (id) => fetch(`${origin}/api/workspaces/${id}/runs/${key}/execution-settings`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify(next),
  });
  assert.equal((await scoped(b.id)).status, 404);
  assert.equal(await bContext.sessions.store.hasRun(key), false);
  assert.equal((await scoped(a.id)).status, 200);
  assert.deepEqual((await aContext.sessions.view(key)).executionSettings, next);
  assert.equal(bContext.sessions.client.calls.length, 0);
});
