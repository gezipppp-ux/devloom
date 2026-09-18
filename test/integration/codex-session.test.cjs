const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { startSession } = require('../../src/codex/cli-session.cjs');
const { temporary } = require('../support/helpers.cjs');

function options(t, mode = 'success') {
  const directory = temporary(t);
  return {
    directory,
    repository: directory,
    config: {
      command: process.execPath,
      command_args: [path.join(__dirname, '../fixtures/codex.cjs'), mode],
    },
    task: {
      images: [{ path: path.join(directory, 'image with spaces.png') }],
      codex_prompt: '需求包含 "quotes" 和 $(literal)，请结合图片。',
    },
    onSession() {},
    onStarted() {},
  };
}

test('new persistent session uses stdin, isolated cwd and --image; strips TAPD env', async (t) => {
  const input = options(t);
  input.repository = path.join(input.directory, '工作区 with spaces');
  fs.mkdirSync(input.repository);
  input.config.model = 'fixture-model';
  input.config.reasoning_effort = 'high';
  const calls = [];
  input.onSession = (id) => calls.push(id);
  input.onStarted = () => calls.push('running');
  process.env.TAPD_TEST_SECRET = 'do-not-pass';
  t.after(() => {
    delete process.env.TAPD_TEST_SECRET;
  });
  const result = await startSession(input);
  assert.equal(result.completed, true);
  assert.deepEqual(calls, ['session-test-123', 'running']);
  const captured = JSON.parse(
    fs.readFileSync(path.join(input.directory, 'final.md')),
  );
  assert.equal(captured.prompt, input.task.codex_prompt);
  assert.equal(captured.cwd, input.repository);
  assert.equal(
    captured.args[captured.args.indexOf('--image') + 1],
    input.task.images[0].path,
  );
  assert.equal(captured.args.includes('--ephemeral'), false);
  assert.equal(
    captured.args[captured.args.indexOf('--model') + 1],
    'fixture-model',
  );
  assert.equal(
    captured.args[captured.args.indexOf('-c') + 1],
    'model_reasoning_effort="high"',
  );
  assert.equal(captured.tapdEnv, null);
});

for (const mode of ['fail', 'thread-only', 'timeout']) {
  test(`${mode} does not confirm execution start`, async (t) => {
    const input = options(t, mode);
    if (mode === 'timeout') input.config.startup_timeout_ms = 100;
    let started = false;
    input.onStarted = () => {
      started = true;
    };
    await assert.rejects(
      startSession(input),
      /before execution|startup timeout/,
    );
    assert.equal(started, false);
  });
}

test('missing Codex executable rejects without changing workflow', async (t) => {
  const input = options(t);
  input.config.command = path.join(input.directory, 'missing-codex.exe');
  let started = false;
  input.onStarted = () => {
    started = true;
  };
  await assert.rejects(startSession(input), /指定的命令不可用/);
  assert.equal(started, false);
});

test('a failed turn remains failed after execution started', async (t) => {
  const result = await startSession(options(t, 'turn-fail'));
  assert.equal(result.completed, false);
  assert.match(result.error, /turn failure/);
});

test('startup timeout stops descendants behind a launcher in a Unicode path', async (t) => {
  const input = options(t);
  const script = path.join(input.directory, '模拟 launcher 空格.cjs');
  const heartbeat = path.join(input.directory, 'heartbeat.txt');
  const pidFile = path.join(input.directory, 'child.pid');
  fs.writeFileSync(
    script,
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const child = require('node:child_process').spawn(process.execPath, ['-e',
      "const fs=require('node:fs'); const beat=()=>fs.appendFileSync(process.argv[1],'x'); beat(); setInterval(beat,30); setTimeout(()=>process.exit(),5000);",
      path.join(__dirname,'heartbeat.txt')
    ], {stdio:'ignore', windowsHide:true});
    fs.writeFileSync(path.join(__dirname,'child.pid'), String(child.pid));
    process.stdin.resume();
    setInterval(()=>{},1000);
  `,
  );
  input.config.command_args = [script];
  input.config.startup_timeout_ms = 1000;
  t.after(() => {
    if (fs.existsSync(pidFile)) {
      try {
        process.kill(Number(fs.readFileSync(pidFile)), 'SIGKILL');
      } catch {
        /* already stopped */
      }
    }
  });
  await assert.rejects(startSession(input), /startup timeout/);
  assert.ok(
    fs.existsSync(heartbeat),
    'descendant must start before the timeout',
  );
  const size = fs.statSync(heartbeat).size;
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(
    fs.statSync(heartbeat).size,
    size,
    'descendant must stop writing when its launcher is stopped',
  );
});
