const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { startSession } = require('../src/codex_session.cjs');
const { temporary } = require('./helpers.cjs');

function options(t, mode = 'success') {
  const directory = temporary(t);
  return {
    directory,
    repository: directory,
    config: {
      command: process.execPath,
      command_args: [path.join(__dirname, 'fixtures/codex.cjs'), mode],
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
  assert.equal(captured.args[captured.args.indexOf('--model') + 1], 'fixture-model');
  assert.equal(captured.args[captured.args.indexOf('-c') + 1], 'model_reasoning_effort="high"');
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
