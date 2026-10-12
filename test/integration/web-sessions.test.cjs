const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { AppServerClient } = require('../../src/codex/app-server-client.cjs');
const { RunStore } = require('../../src/storage/run-store.cjs');
const { normalizeItem } = require('../../src/codex/session-item.cjs');
const { worktreeReason } = require('../../src/git/worktree-access.cjs');
const { SessionManager } = require('../support/session-manager.cjs');
const { createWebServer } = require('../../src/http/server.cjs');
const { temporary } = require('../support/helpers.cjs');

const { FakeClient } = require('../fixtures/web-client.cjs');

function setup(t) {
  const directory = temporary(t);
  const store = new RunStore(directory);
  const key = '1-2';
  fs.mkdirSync(store.dir(key));
  const state = {
    agent: { provider: "codex" },
    workitem: { title: '测试需求', id: '2', workspace_id: '1' },
    worktree: { path: directory, repository: directory, branch: 'codex/test' },
    session_id: 'original',
    execution: { status: 'completed' },
    transition: { status: 'succeeded' },
  };
  fs.writeFileSync(
    path.join(store.dir(key), 'run.json'),
    JSON.stringify(state),
  );
  const client = new FakeClient();
  const manager = new SessionManager({
    store,
    client,
    configFile: path.join(directory, 'config.json'),
    worktreeReason: () => null,
  });
  t.after(() => manager.close());
  return { directory, store, key, client, manager, state };
}

test('app-server correlates parallel RPC, notifications, server requests, errors and reconnect', async (t) => {
  const client = new AppServerClient({
    command: process.execPath,
    command_args: [path.join(__dirname, '../fixtures/app-server.cjs')],
  });
  t.after(() => client.close());
  await Promise.all([client.connect(), client.connect()]);
  const results = await Promise.all([
    client.request('slow', { delay: 40 }),
    client.request('fast', {}),
  ]);
  assert.deepEqual(
    results.map((r) => r.method),
    ['slow', 'fast'],
  );
  const event = once(client, 'notification');
  await client.request('notify', {});
  assert.equal((await event)[0].params.delta, '你好');
  const approval = once(client, 'request');
  await client.request('approval', {});
  client.respond((await approval)[0].id, { decision: 'decline' });
  const question = once(client, 'request');
  await client.request('question', {});
  assert.equal((await question)[0].method, 'item/tool/requestUserInput');
  await assert.rejects(client.request('fail', {}), /fixture failure/);
  await assert.rejects(client.request('hang', {}, 15), /超时/);
  await assert.rejects(client.request('exit', {}), /连接已关闭/);
  await client.connect();
  assert.equal((await client.request('again', {})).method, 'again');
});

test('Web launch validates Codex before claiming a run or creating a worktree', async (t) => {
  const { manager, store, directory } = setup(t);
  manager.configFile = path.join(directory, 'config.json');
  manager.client.validateCommand = () => {
    throw new Error('未找到 Codex CLI');
  };
  manager.run = () => {
    assert.fail('must not create worktree');
  };
  (await assert.rejects(
    async () => (await manager.launch('1-3', { id: '3', workspace_id: '1' }, { agent: { provider: 'codex' } }, {})),
    /未找到 Codex/,
  ));
  assert.equal(fs.existsSync(store.dir('1-3')), false);
  assert.equal(manager.sessions.has('1-3'), false);
});

test('initialization progress is streamed, can be interrupted, and remains visible after reload', async (t) => {
  const { manager, client, store, key, state, directory } = setup(t);
  fs.unlinkSync(path.join(store.dir(key), 'run.json'));
  manager.configFile = path.join(directory, 'config.json');
  state.session_id = null;
  state.execution = { status: 'initializing' };
  state.initialization = {
    status: 'running',
    commands: [
      { command: 'pnpm install', status: 'running', output: 'installing' },
    ],
  };
  const save = () =>
    fs.writeFileSync(
      path.join(store.dir(key), 'run.json'),
      JSON.stringify(state),
    );
  const events = [];
  manager.on('event', (event) => events.push(event));
  manager.run = async (_input, { signal, onInitialization }) => {
    save();
    onInitialization(state.initialization, 0);
    await new Promise((resolve) =>
      signal.addEventListener('abort', resolve, { once: true }),
    );
    state.initialization.status = 'interrupted';
    state.initialization.commands[0].status = 'interrupted';
    state.execution = { status: 'failed', error: '初始化已停止' };
    save();
    onInitialization(state.initialization, 0);
    return state;
  };
  (await manager.launch(key, state.workitem, { agent: { provider: "codex" } }, {}));
  assert.equal((await manager.view(key)).status, 'initializing');
  assert.ok(events.some((event) => event.item?.output === 'installing'));
  await manager.interrupt(key);
  await manager.sessions.get(key).operation;
  assert.equal(client.calls.length, 0);
  manager.sessions.delete(key);
  const view = await manager.view(key);
  assert.equal(view.items[0].status, 'interrupted');
  assert.equal(view.items[0].output, 'installing');
  assert.equal(view.error, '初始化已停止');
});

test('same session supports resume, streamed tool output, steering, interruption and another turn', async (t) => {
  const { manager, key, client, store } = setup(t);
  const first = await manager.send(key, '继续实现');
  assert.equal(first.sessionId, 'original');
  assert.equal(
    client.calls.find((c) => c.method === 'thread/resume').params.threadId,
    'original',
  );
  client.notify('item/commandExecution/outputDelta', {
    turnId: first.turnId,
    itemId: 'command',
    delta: '测试通过',
  });
  await manager.events.drain();
  await manager.send(key, '请补充测试');
  assert.equal(client.calls.at(-1).method, 'turn/steer');
  assert.equal(client.calls.at(-1).params.expectedTurnId, first.turnId);
  assert.equal(
    (await manager.view(key)).items.find((i) => i.id === 'command').output,
    '测试通过',
  );
  await manager.interrupt(key);
  assert.equal((await store.read(key)).execution.status, 'interrupted');
  const next = await manager.send(key, '继续');
  assert.equal(next.sessionId, first.sessionId);
  assert.notEqual(next.turnId, first.turnId);
  assert.equal(
    client.calls.filter((c) => c.method === 'thread/resume').length,
    1,
  );
  await manager.history(key, 'cursor-2');
  assert.equal(client.calls.at(-1).params.cursor, 'cursor-2');
});

test('questions and approvals require explicit valid answers; unsupported requests are rejected', async (t) => {
  const { manager, client, key } = setup(t);
  await manager.send(key, 'start');
  client.emit('request', {
    id: 8,
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'original',
      questions: [{ id: 'choice', question: '选择？' }],
    },
  });
  await manager.events.drain();
  await assert.rejects(manager.send(key, 'another'), /先处理/);
  await assert.rejects(manager.respond(key, 'number:8', { answers: {} }), /回答/);
  await manager.respond(key, 'number:8', { answers: { choice: '选项一' } });
  assert.deepEqual(client.calls.at(-1).result, {
    answers: { choice: { answers: ['选项一'] } },
  });
  client.emit('request', {
    id: '9',
    method: 'item/fileChange/requestApproval',
    params: { threadId: 'original' },
  });
  await manager.events.drain();
  await manager.respond(key, 'string:9', { decision: 'decline' });
  assert.deepEqual(client.calls.at(-1).result, { decision: 'decline' });
  await assert.rejects(
    manager.respond(key, 'string:9', { decision: 'accept' }),
    /失效/,
  );
  client.emit('request', {
    id: 10,
    method: 'unknown',
    params: { threadId: 'original' },
  });
  await manager.events.drain();
  assert.equal(client.calls.at(-1).rejected, 10);
});

test('modern optional questions allow steering while blocking questions and approvals still fence it', async (t) => {
  const { manager, client, key } = setup(t);
  const { turnId } = await manager.send(key, 'start');
  const params = { threadId: 'original', turnId, itemId: 'ask', isBlocking: false,
    questions: [
      { id: 'scope', header: '范围', question: '选择范围', options: [{ label: '全部', description: '覆盖全部模块' }] },
      { id: 'notes', header: '说明', question: '补充说明', options: null, isOther: true },
      { id: '__proto__', header: '密文', question: '输入密文', isSecret: true },
    ] };
  client.emit('request', { id: 80, method: 'item/tool/requestUserInput', params });
  await manager.events.drain();
  assert.equal((await manager.view(key)).requests[0].blocking, false);
  await manager.send(key, '继续检查');
  assert.equal(client.calls.at(-1).method, 'turn/steer');
  await assert.rejects(manager.respond(key, 'number:80', { answers: { scope: '全部' } }), /回答/);
  await manager.respond(key, 'number:80', { answers: JSON.parse('{"scope":"全部","notes":" 自定义范围 ","__proto__":"密文"}') });
  assert.deepEqual(client.calls.at(-1), { response: 80, result: { answers: JSON.parse('{"scope":{"answers":["全部"]},"notes":{"answers":["自定义范围"]},"__proto__":{"answers":["密文"]}}') } });
  await assert.rejects(manager.respond(key, 'number:80', { answers: {} }), /失效/);
  for (const blocking of [true, undefined]) {
    client.emit('request', { id: 81, method: 'item/tool/requestUserInput', params: { ...params, isBlocking: blocking } });
  await manager.events.drain();
    await assert.rejects(manager.send(key, '不要绕过'), /先处理/);
    client.notify('serverRequest/resolved', { requestId: 81 });
  await manager.events.drain();
    assert.equal((await manager.view(key)).requests.length, 0);
  }
  client.emit('request', { id: 82, method: 'item/fileChange/requestApproval', params: { threadId: 'original', isBlocking: false } });
  await manager.events.drain();
  await assert.rejects(manager.send(key, '不要绕过审批'), /先处理/);
});

test('invalid, stale and foreign questions cannot be answered; completion and disconnect clear pending questions', async (t) => {
  const { manager, client, key } = setup(t);
  const { turnId } = await manager.send(key, 'start');
  const params = { threadId: 'original', turnId, questions: [{ id: 'a', question: '回答？' }] };
  for (const patch of [
    { questions: null }, { questions: [] }, { questions: [null] },
    { questions: [{ id: 'a', question: 'A' }, { id: 'a', question: 'B' }] },
    { questions: [{ id: 'a', question: 'A', options: [null] }] },
    { threadId: 'foreign' }, { turnId: 'old-turn' },
  ]) {
    client.emit('request', { id: 90, method: 'item/tool/requestUserInput', params: { ...params, ...patch } });
  await manager.events.drain();
    assert.equal(client.calls.at(-1).rejected, 90);
    assert.equal((await manager.view(key)).requests.length, 0);
  }
  client.emit('request', { id: 91, method: 'item/tool/requestUserInput', params });
  await manager.events.drain();
  for (const answers of [null, [], { a: ' ' }, { a: ['A'] }, { a: 'x'.repeat(20001) }])
    await assert.rejects(manager.respond(key, 'number:91', { answers }), /回答/);
  client.notify('serverRequest/resolved', { threadId: 'foreign', requestId: 91 });
  await manager.events.drain();
  assert.equal((await manager.view(key)).requests.length, 1);
  await manager.interrupt(key);
  await assert.rejects(manager.respond(key, 'number:91', { answers: { a: 'A' } }), /失效/);
  const next = await manager.send(key, 'continue');
  client.emit('request', { id: 92, method: 'item/tool/requestUserInput', params: { ...params, turnId: next.turnId, isBlocking: false } });
  await manager.events.drain();
  const events = [];
  manager.on('event', (event) => events.push(event));
  client.emit('disconnected', new Error('offline'));
  await manager.events.drain();
  await assert.rejects(manager.respond(key, 'number:92', { answers: { a: 'A' } }), /失效/);
  assert.deepEqual(events.at(-1).requests, []);
});

test('removed worktrees, external CLI locks, active clients and duplicate web ownership fence mutations', async (t) => {
  const { manager, client, store, key, directory } = setup(t);
  manager.worktreeReason = () => '工作区已移除';
  await assert.rejects(manager.send(key, 'start'), /已移除/);
  manager.worktreeReason = () => null;
  fs.mkdirSync(path.join(store.dir(key), '.lock'));
  await assert.rejects(manager.send(key, 'start'), /CLI/);
  fs.rmdirSync(path.join(store.dir(key), '.lock'));
  const old = client.request.bind(client);
  client.request = (method, params) =>
    method === 'thread/read'
      ? Promise.resolve({ thread: { status: { type: 'active' } } })
      : old(method, params);
  await assert.rejects(manager.send(key, 'start'), /另一个客户端/);
  const secondStore = new RunStore(directory);
  assert.throws(() => secondStore.claim(key), /另一个 Web CLI/);
  assert.equal(
    client.calls.some((c) => c.method === 'turn/start'),
    false,
  );
});

test('first Web turn sends images and transitions only after turn started, preserving transition state', async (t) => {
  const { manager, client, store, key, state } = setup(t);
  fs.unlinkSync(path.join(store.dir(key), 'run.json'));
  let started = 0;
  manager.run = async (_input, { startSession }) => {
    const execution = await startSession({
      repository: state.worktree.path,
      task: { prompt: '图文需求', images: [{ path: 'C:/image.png' }] },
      onSession(id) {
        state.session_id = id;
        fs.writeFileSync(
          path.join(store.dir(key), 'run.json'),
          JSON.stringify(state),
        );
      },
      onStarted() {
        started++;
      },
    });
    return { ...state, execution };
  };
  const original = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === 'turn/start') {
      assert.equal(started, 0);
      assert.equal(params.input[1].type, 'localImage');
    }
    return original(method, params);
  };
  (await manager.launch(key, state.workitem, { workflow: {}, agent: { provider: "codex" } }, {}, {}));
  const runtime = manager.sessions.get(key);
  while (!runtime.turnId)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(started, 1);
  client.notify('turn/completed', {
    turn: { id: runtime.turnId, status: 'completed' },
  });
  await manager.events.drain();
  await runtime.operation;
  assert.equal(runtime.status, 'completed');
  assert.equal((await store.read(key)).transition.status, 'succeeded');
});

test('disconnect rejects startup and clears pending questions; reconnect resumes original identity', async (t) => {
  const { manager, client, key } = setup(t);
  await manager.send(key, 'first');
  client.emit('request', {
    id: 9,
    method: 'item/fileChange/requestApproval',
    params: { threadId: 'original' },
  });
  await manager.events.drain();
  client.close();
  await manager.events.drain();
  assert.equal(manager.sessions.get(key).status, 'disconnected');
  assert.equal(manager.sessions.get(key).requests.size, 0);
  assert.equal((await manager.send(key, 'reconnect')).sessionId, 'original');
});

test('unconfirmed first turn times out without TAPD transition or a connected continuation', async (t) => {
  const { manager, client, store, key, state } = setup(t);
  fs.unlinkSync(path.join(store.dir(key), 'run.json'));
  let started = false;
  manager.run = async (_input, { startSession }) => {
    try {
      await startSession({
        repository: state.worktree.path,
        task: { prompt: 'test', images: [] },
        onSession(id) {
          state.session_id = id;
          fs.writeFileSync(
            path.join(store.dir(key), 'run.json'),
            JSON.stringify(state),
          );
        },
        onStarted() {
          started = true;
        },
      });
      assert.fail('start must time out');
    } catch (error) {
      return {
        ...state,
        execution: { status: 'failed', error: error.message },
      };
    }
  };
  const original = client.request.bind(client);
  client.request = (method, params) =>
    method === 'turn/start'
      ? Promise.resolve({ turn: { id: 'unconfirmed', status: 'inProgress' } })
      : original(method, params);
  (await manager.launch(
    key,
    state.workitem,
    { workflow: {}, agent: { provider: "codex", startupTimeoutMs: 15 } },
    {},
    {},
  ));
  const runtime = manager.sessions.get(key);
  await runtime.operation;
  assert.equal(started, false);
  assert.equal(runtime.status, 'failed');
  assert.equal(runtime.connected, false);
  assert.match(runtime.error, /未收到/);
});

test('completion before turn/start response cannot resurrect a completed turn', async (t) => {
  const { manager, client, key } = setup(t);
  const original = client.request.bind(client);
  client.request = async (method, params) => {
    const result = await original(method, params);
    if (method === 'turn/start')
      client.notify('turn/completed', {
        turn: { ...result.turn, status: 'completed' },
      });
    return result;
  };
  await manager.send(key, 'fast');
  await manager.events.drain();
  assert.equal(manager.sessions.get(key).turnId, null);
  assert.equal(manager.sessions.get(key).status, 'completed');
});

test('worktree registration is required even when a leftover directory exists', (t) => {
  const directory = temporary(t);
  execFileSync('git', ['init', directory], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const tree = path.join(directory, 'leftover');
  fs.mkdirSync(tree);
  fs.writeFileSync(path.join(tree, '.git'), 'stale');
  assert.match(
    worktreeReason({
      worktree: { repository: directory, path: tree, branch: 'codex/removed' },
    }),
    /移除/,
  );
  assert.equal(
    normalizeItem({ id: '1', type: 'userMessage', content: 'not an array' })
      .text,
    '',
  );
});

test('HTTP validates origin/token/body, preserves Chinese chunking and streams events', async (t) => {
  const directory = temporary(t);
  fs.writeFileSync(path.join(directory, 'index.html'), '<h1>fixture</h1>');
  const manager = new EventEmitter();
  manager.list = () => [];
  manager.close = async () => {};
  manager.send = async (key, text) => ({ key, text });
  const application = createWebServer({ testIdentity: true,
    manager,
    staticDirectory: directory,
    configFile: path.join(directory, 'missing.json'),
  });
  const origin = await application.listen(0);
  t.after(() => application.close());
  const { token } = await (await fetch(`${origin}/api/bootstrap`)).json();
  assert.equal((await fetch(origin)).status, 200);
  assert.equal(
    (
      await fetch(`${origin}/api/runs`, {
        headers: { origin: 'http://evil.test' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/runs/1-2/messages`, {
        method: 'POST',
        body: '{}',
      })
    ).status,
    403,
  );
  const headers = { 'content-type': 'application/json', 'x-csrf-token': token };
  assert.equal(
    (
      await fetch(`${origin}/api/runs/1-2/messages`, {
        method: 'POST',
        headers,
        body: '{',
      })
    ).status,
    400,
  );
  const payload = Buffer.from(JSON.stringify({ text: '中文指令' }));
  const result = await new Promise((resolve, reject) => {
    const request = http.request(
      `${origin}/api/runs/1-2/messages`,
      { method: 'POST', headers },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => resolve(JSON.parse(data)));
      },
    );
    request.on('error', reject);
    for (const byte of payload) request.write(Buffer.from([byte]));
    request.end();
  });
  assert.equal(result.text, '中文指令');
  assert.notEqual((await fetch(`${origin}/%2e%2e%5cpackage.json`)).status, 200);
  const abort = new AbortController();
  const response = await fetch(`${origin}/api/events`, {
    signal: abort.signal,
  });
  const reader = response.body.getReader();
  await reader.read();
  manager.emit('event', { key: '1-2', type: 'state', status: 'running' });
  assert.match(Buffer.from((await reader.read()).value).toString(), /running/);
  abort.abort();
});
