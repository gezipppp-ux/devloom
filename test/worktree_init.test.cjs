const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { temporary } = require('./helpers.cjs');
const {
  initializeWorktree,
  validateInitCommands,
} = require('../src/worktree_init.cjs');

function setup(t) {
  const directory = temporary(t);
  const cwd = path.join(directory, 'worktree with spaces');
  fs.mkdirSync(cwd);
  const command = (name, script) => {
    const file = path.join(directory, `${name}.cjs`);
    fs.writeFileSync(file, script);
    return `"${process.execPath}" "${file}"`;
  };
  let state;
  const onUpdate = (value) => {
    state = structuredClone(value);
  };
  return { directory, cwd, command, onUpdate, state: () => state };
}

test('initialization runs commands in order inside the worktree and streams/persists output', async (t) => {
  const fixture = setup(t);
  const commands = [
    fixture.command(
      'one',
      "require('node:fs').writeFileSync('marker.txt', 'ready'); console.log('first');",
    ),
    fixture.command(
      'two',
      "console.log(require('node:fs').readFileSync('marker.txt','utf8')); console.log(process.cwd());",
    ),
  ];
  await initializeWorktree({ ...fixture, commands });
  const state = fixture.state();
  assert.equal(state.status, 'completed');
  assert.deepEqual(
    state.commands.map((entry) => entry.exit_code),
    [0, 0],
  );
  assert.match(state.commands[1].output, /ready/);
  assert.ok(state.commands[1].output.includes(fixture.cwd));
  assert.equal(
    fs.existsSync(path.join(fixture.directory, 'marker.txt')),
    false,
  );
  assert.match(
    fs.readFileSync(path.join(fixture.directory, 'initialization.log'), 'utf8'),
    /first/,
  );
});

test('nonzero exit stops remaining commands, retains stderr and exit code', async (t) => {
  const fixture = setup(t);
  await assert.rejects(
    initializeWorktree({
      ...fixture,
      commands: [
        fixture.command(
          'fail',
          "console.error('install failed'); process.exit(7);",
        ),
        fixture.command(
          'never',
          "require('node:fs').writeFileSync('should-not-exist', 'bad');",
        ),
      ],
    }),
    /第 1 条.*退出码 7/,
  );
  assert.equal(fixture.state().commands[0].exit_code, 7);
  assert.match(fixture.state().commands[0].output, /install failed/);
  assert.equal(fixture.state().commands[1].status, 'skipped');
  assert.equal(
    fs.existsSync(path.join(fixture.cwd, 'should-not-exist')),
    false,
  );
});

for (const action of ['abort', 'timeout']) {
  test(`initialization ${action} stops the command process tree`, async (t) => {
    const fixture = setup(t);
    const controller = new AbortController();
    const commands = [
      fixture.command(
        'wait',
        "console.log('waiting'); setInterval(()=>{}, 1000);",
      ),
    ];
    await assert.rejects(
      initializeWorktree({
        ...fixture,
        commands,
        signal: controller.signal,
        timeoutMs: action === 'timeout' ? 500 : 10000,
        onUpdate(state) {
          fixture.onUpdate(state);
          if (
            action === 'abort' &&
            state.commands[0].output.includes('waiting')
          )
            controller.abort();
        },
      }),
      action === 'abort' ? /已停止/ : /超时/,
    );
    assert.equal(
      fixture.state().status,
      action === 'abort' ? 'interrupted' : 'failed',
    );
  });
}

test('empty configuration skips initialization and malformed commands are rejected', async (t) => {
  const fixture = setup(t);
  await initializeWorktree({ ...fixture, commands: [] });
  assert.equal(
    fs.existsSync(path.join(fixture.directory, 'initialization.log')),
    false,
  );
  for (const commands of [
    'pnpm install',
    [''],
    ['a\nb'],
    Array(21).fill('echo hi'),
  ])
    assert.throws(() => validateInitCommands(commands), /初始化命令/);
});
