const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { resolveCodex } = require('../../src/codex/command.cjs');
const { AppServer } = require('../../src/codex/app-server.cjs');

function host(platform, files, env = {}) {
  return {
    platform,
    env,
    home: platform === 'win32' ? 'C:\\Users\\runner' : '/home/runner',
    node: platform === 'win32' ? 'C:\\node\\node.exe' : '/opt/node/bin/node',
    fs: {
      statSync(file) {
        if (!files[file]) throw new Error('ENOENT');
        return {
          isFile: () => !files[file].directory,
          mtimeMs: files[file].time || 0,
        };
      },
      accessSync(file, mode) {
        if (
          !files[file] ||
          (mode === fs.constants.X_OK && files[file].executable === false)
        )
          throw new Error('EACCES');
      },
      realpathSync(file) {
        return files[file].target || file;
      },
      readdirSync() {
        return [];
      },
    },
  };
}

test('Linux PATH respects priority, skips nonexecutable files and empty/relative entries', () => {
  const options = host(
    'linux',
    {
      '/bad/codex': { executable: false },
      '/valid/codex': {},
      '/usr/bin/codex': {},
    },
    { PATH: ':relative:/bad:/valid' },
  );
  assert.deepEqual(resolveCodex({}, options), {
    command: '/valid/codex',
    args: [],
  });
});

test('Linux service without login PATH finds user installation and Node sibling npm symlink', () => {
  const options = host('linux', { '/home/runner/.local/bin/codex': {} });
  assert.equal(
    resolveCodex({}, options).command,
    '/home/runner/.local/bin/codex',
  );
  options.fs = host('linux', {
    '/opt/node/bin/node': {},
    '/opt/node/bin/codex': {
      target: '/opt/node/lib/node_modules/@openai/codex/bin/codex.js',
    },
  }).fs;
  assert.deepEqual(resolveCodex({}, options), {
    command: '/opt/node/bin/node',
    args: ['/opt/node/lib/node_modules/@openai/codex/bin/codex.js'],
  });
});

test('explicit config and CODEX_BIN take precedence; invalid cross-platform config never silently falls back', () => {
  const options = host(
    'linux',
    { '/chosen/codex': {}, '/env/codex': {}, '/bin/codex': {} },
    { PATH: '/bin', CODEX_BIN: '/env/codex' },
  );
  assert.equal(
    resolveCodex({ command: '/chosen/codex' }, options).command,
    '/chosen/codex',
  );
  assert.equal(resolveCodex({}, options).command, '/env/codex');
  assert.throws(
    () => resolveCodex({ command: 'C:\\old\\codex.exe' }, options),
    /迁移系统/,
  );
  assert.throws(
    () => resolveCodex({ command: './codex' }, options),
    /指定的命令不可用/,
  );
});

test('Windows PATH is case insensitive and handles spaces; npm shim uses Node without a shell', () => {
  const options = host(
    'win32',
    {
      'C:\\Program Files\\Codex\\codex.exe': {},
      'C:\\npm\\codex.cmd': {},
      'C:\\node\\node.exe': {},
      'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js': {},
    },
    { Path: '"C:\\Program Files\\Codex";C:\\npm' },
  );
  assert.equal(
    resolveCodex({}, options).command,
    'C:\\Program Files\\Codex\\codex.exe',
  );
  assert.deepEqual(
    resolveCodex(
      { command: 'C:\\npm\\codex.cmd', command_args: ['--example'] },
      options,
    ),
    {
      command: 'C:\\node\\node.exe',
      args: [
        'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
        '--example',
      ],
    },
  );
});

test('Windows desktop version directory is found without PATH; newest installation wins', () => {
  const root = 'C:\\Local\\OpenAI\\Codex\\bin';
  const options = host(
    'win32',
    {
      [`${root}\\old`]: { directory: true, time: 1 },
      [`${root}\\new`]: { directory: true, time: 2 },
      [`${root}\\old\\codex.exe`]: {},
      [`${root}\\new\\codex.exe`]: {},
    },
    { LOCALAPPDATA: 'C:\\Local' },
  );
  options.fs.readdirSync = () =>
    ['old', 'new'].map((name) => ({ name, isDirectory: () => true }));
  assert.equal(resolveCodex({}, options).command, `${root}\\new\\codex.exe`);
});

test('missing installations and unsupported shell shims produce actionable errors', () => {
  assert.throws(
    () => resolveCodex({}, host('linux', {})),
    /systemd.*PATH|PATH.*systemd/,
  );
  const options = host('win32', {
    'C:\\tools\\codex.cmd': {},
    'C:\\tools\\run.bat': {},
  });
  assert.throws(
    () => resolveCodex({ command: 'C:\\tools\\codex.cmd' }, options),
    /脚本启动器/,
  );
  assert.throws(
    () => resolveCodex({ command: 'C:\\tools\\run.bat' }, options),
    /脚本启动器/,
  );
});

test('native executable preserves argument arrays and failed discovery can reconnect after correction', async () => {
  assert.deepEqual(
    resolveCodex({
      command: process.execPath,
      command_args: ['file with spaces.js'],
    }),
    { command: process.execPath, args: ['file with spaces.js'] },
  );
  const client = new AppServer({ command: './missing-codex' });
  await assert.rejects(client.connect(), /指定的命令不可用/);
  assert.equal(client.connection, null);
});
