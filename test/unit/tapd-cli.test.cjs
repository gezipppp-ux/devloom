const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { argument, configPath } = require('../../src/cli/arguments.cjs');
const { dataRoot } = require('../../src/config/runtime.cjs');
const {
  captureSession,
} = require('../../src/channels/tapd/capture-session.cjs');
const search = require('../../src/cli/tapd/search.cjs');
const detail = require('../../src/cli/tapd/detail.cjs');
const task = require('../../src/cli/tapd/task.cjs');
const users = require('../../src/cli/tapd/users.cjs');
const transitions = require('../../src/cli/tapd/transitions.cjs');
const run = require('../../src/cli/tapd/run.cjs');
const authCookie = require('../../src/cli/tapd/auth-cookie.cjs');
const capture = require('../../src/cli/tapd/capture-session.cjs');
const {
  item,
  session,
  temporary,
  workflow,
} = require('../support/helpers.cjs');

const workspace = 'd51f20c5-ad56-48fb-b55c-c1c45027b249';
function output() {
  return {
    text: '',
    write(text) {
      this.text += text;
    },
  };
}

test('all CLI imports are inert even with invalid arguments and authentication environment', (t) => {
  const directory = temporary(t);
  const cli = path.resolve(__dirname, '../../src/cli');
  const program = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    global.fetch = () => { throw new Error('Unexpected network request'); };
    process.argv = ['node', 'fixture', '--config'];
    process.exit = () => { throw new Error('Unexpected process exit'); };
    for (const file of fs.readdirSync(${JSON.stringify(path.join(cli, 'tapd'))}))
      require(path.join(${JSON.stringify(path.join(cli, 'tapd'))}, file));
    require(${JSON.stringify(path.join(cli, 'arguments.cjs'))});
    require(${JSON.stringify(path.join(cli, 'execute.cjs'))});
    require(${JSON.stringify(path.join(cli, 'web.cjs'))});
    assert.equal(process.exitCode, undefined);
    process.stdout.write('loaded');
  `;
  const result = execFileSync(process.execPath, ['-e', program], {
    cwd: directory,
    env: {
      ...process.env,
      TAPD_COOKIE_HEADER: 'dsc-token=fake',
      TAPD_WORKSPACE_ID: '1',
      TAPD_SESSION_OUTPUT: path.join(directory, 'must-not-exist.json'),
      TAPD_CDP_URL: 'invalid-url',
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(result, 'loaded');
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('CLI arguments retain explicit file, workspace, environment and INIT_CWD precedence', (t) => {
  const directory = temporary(t);
  const env = {
    INIT_CWD: directory,
    TAPD_CONFIG: 'environment.json',
    RUNNER_WORKSPACE: workspace,
  };
  assert.equal(argument('--port', '4317', []), '4317');
  assert.equal(argument('--id', null, ['--id', '42']), '42');
  assert.throws(
    () => argument('--id', null, ['--id', '--type']),
    /requires a value/,
  );
  assert.equal(
    configPath(undefined, ['--config', 'explicit.json'], env),
    path.join(directory, 'explicit.json'),
  );
  assert.equal(
    configPath(undefined, [], env),
    path.join(dataRoot, 'workspaces', workspace, 'config.json'),
  );
  assert.equal(
    configPath('output.json', ['--config', 'ignored.json'], env),
    path.join(directory, 'output.json'),
  );
  assert.equal(
    configPath(undefined, [], {
      INIT_CWD: directory,
      TAPD_CONFIG: 'environment.json',
    }),
    path.join(directory, 'environment.json'),
  );
  assert.equal(
    configPath(undefined, [], {}),
    path.join(dataRoot, 'config', 'tapd.local.json'),
  );
  assert.throws(
    () => configPath(undefined, ['--app-workspace', '../escape'], {}),
    /Invalid/,
  );
  assert.equal(
    configPath(
      undefined,
      ['--config', 'explicit.json', '--app-workspace', '../ignored'],
      env,
    ),
    path.join(directory, 'explicit.json'),
  );
});

test('search, detail, task preview and user commands preserve payloads and safe output', async (t) => {
  const directory = temporary(t);
  const file = path.join(directory, 'config.json');
  const argv = ['--config', file];
  const env = { INIT_CWD: directory };
  const stdout = output();
  const loadSession = (value) => {
    assert.equal(value, file);
    return session;
  };
  await search.main(
    [...argv, '--type', 'story', '--query', '示例', '--output', 'search.json'],
    env,
    {
      loadSession,
      stdout,
      todos: async (value, options) => {
        assert.equal(value, session);
        assert.equal(options.type, 'story');
        assert.equal(options.query, '示例');
        return [item];
      },
    },
  );
  assert.equal(JSON.parse(stdout.text).items[0].id, item.id);
  assert.equal(
    fs.readFileSync(path.join(directory, 'search.json'), 'utf8'),
    stdout.text.trimEnd(),
  );
  stdout.text = '';
  const selectItem = async (_session, options) => {
    assert.equal(options.id, item.id);
    return item;
  };
  await detail.main([...argv, '--id', item.id], env, {
    loadSession,
    selectItem,
    detail: async () => item,
    stdout,
  });
  assert.deepEqual(JSON.parse(stdout.text), item);
  stdout.text = '';
  await task.main([...argv, '--id', item.id], env, {
    loadSession,
    loadConfig: () => ({ workspace: { id: workspace } }),
    selectItem,
    detail: async () => item,
    stdout,
    buildTask: async (_item, _session, target) => {
      assert.equal(
        target,
        path.join(
          directory,
          'runs',
          `${item.workspace_id}-${item.id}`,
          'preview',
        ),
      );
      return { execution_ready: true, images: [{ path: 'fixture.png' }] };
    },
  });
  assert.equal(JSON.parse(stdout.text).image_count, 1);
  stdout.text = '';
  await users.main([...argv, '--q', 'zhang', '--per-page', '25'], env, {
    loadSession,
    stdout,
    searchUsers: async (_session, options) => {
      assert.equal(options.query, 'zhang');
      assert.equal(options.perPage, 25);
      assert.equal(options.workspace, session.request_body.group_id);
      return [{ id: 1, nick: '张三', name: '张三', cookie: 'must-not-print' }];
    },
  });
  assert.equal(JSON.parse(stdout.text).users[0].id, '1');
  assert.ok(!stdout.text.includes('must-not-print'));
});

test('transition CLI keeps read-only mode and requires explicit identity before applying', async () => {
  const stdout = output();
  const calls = [];
  const dependencies = {
    loadSession: () => session,
    loadConfig: () => ({ workflow: { allow_write: true } }),
    stdout,
    selectItem: async (_session, options) => {
      calls.push(options);
      return item;
    },
    workflowInfo: async () => workflow,
    applyTransition: async (_session, value, config, target) => {
      assert.equal(value, item);
      assert.equal(config.allow_write, true);
      assert.equal(target, 'developing');
      return { verified_status: target };
    },
  };
  await transitions.main(['--id', item.id], {}, dependencies);
  assert.equal(JSON.parse(stdout.text).current_status, workflow.current_status);
  await assert.rejects(
    transitions.main(['--apply'], {}, dependencies),
    /explicit --id/,
  );
  assert.equal(calls.length, 1);
  stdout.text = '';
  await transitions.main(
    ['--apply', '--id', item.id, '--to', 'developing'],
    {},
    dependencies,
  );
  assert.equal(JSON.parse(stdout.text).verified_status, 'developing');
});

test('run CLI preserves status-only reads, retry flags, stderr callbacks and result exit codes', async (t) => {
  const directory = temporary(t);
  const file = path.join(directory, 'config.json');
  const config = { workspace: { id: workspace }, tapd: { session } };
  const argv = ['--config', file, '--id', item.id];
  const stdout = output(),
    stderr = output();
  const state = {
    execution: { status: 'completed' },
    transition: { status: 'succeeded' },
  };
  const dependencies = {
    loadConfig: () => config,
    loadSession: () => session,
    stdout,
    stderr,
    runRequirement: async (input, callbacks) => {
      assert.equal(input.retry, true);
      assert.equal(input.configFile, file);
      assert.equal(input.item.id, item.id);
      callbacks.onSession('fake-session', { path: 'recorded-tree' });
      callbacks.onTransition(state.transition);
      return state;
    },
  };
  assert.equal(
    await run.main([...argv, '--retry-transition'], {}, dependencies),
    0,
  );
  assert.equal(
    stderr.text,
    'Codex session: fake-session\nWorktree: recorded-tree\nChannel transition: succeeded\n',
  );
  state.transition.status = 'failed';
  assert.equal(
    await run.main([...argv, '--retry-transition'], {}, dependencies),
    1,
  );
  const runDirectory = path.join(
    directory,
    'runs',
    `${item.workspace_id}-${item.id}`,
  );
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(runDirectory, 'run.json'), JSON.stringify(state));
  stdout.text = '';
  await run.main(
    [...argv, '--status'],
    {},
    {
      ...dependencies,
      runRequirement: () => assert.fail('Status must not execute a task'),
    },
  );
  assert.deepEqual(JSON.parse(stdout.text), state);
});

test('authentication CLI uses explicit settings and capture endpoint without leaking secrets', async (t) => {
  const directory = temporary(t);
  const stdout = output();
  const file = path.join(directory, 'cookie.json');
  await authCookie.main(
    ['--config', path.join(directory, 'ignored.json')],
    {
      TAPD_COOKIE_HEADER: 'dsc-token=fake-secret',
      TAPD_WORKSPACE_ID: '1',
      TAPD_SESSION_OUTPUT: file,
    },
    { stdout },
  );
  assert.equal(
    JSON.parse(fs.readFileSync(file)).tapd.session.request_body.dsc_token,
    'fake-secret',
  );
  assert.ok(!stdout.text.includes('fake-secret'));
  assert.equal(fs.existsSync(path.join(directory, 'ignored.json')), false);
  let captured;
  await capture.main(
    ['--output', 'captured.json'],
    { INIT_CWD: directory, TAPD_CDP_URL: 'http://fixture.invalid' },
    {
      stdout,
      captureSession: async (url) => {
        assert.equal(url, 'http://fixture.invalid');
        return session;
      },
      saveSession: (value, outputFile) => {
        assert.equal(value, session);
        captured = outputFile;
        return outputFile;
      },
    },
  );
  assert.equal(captured, path.join(directory, 'captured.json'));
});

test('capture service returns credentials to its caller and closes the browser on success and failure', async () => {
  let closed = 0,
    clicked = false;
  const endpoint =
    'https://www.tapd.cn/api/my_worktable/my_worktable/get_my_worktable_by_page';
  const request = {
    method: () => 'POST',
    url: () => endpoint,
    postDataJSON: () => session.request_body,
  };
  const response = { url: () => endpoint, request: () => request };
  const page = {
    url: () => 'https://www.tapd.cn/tapd_fe/my/work',
    reload: async () => {},
    waitForResponse: async (predicate) => {
      assert.equal(predicate(response), true);
      return response;
    },
    getByText: () => ({
      click: async () => {
        clicked = true;
      },
    }),
  };
  const browser = {
    contexts: () => [
      {
        pages: () => [page],
        cookies: async () => [{ name: 'dsc-token', value: 'fake' }],
      },
    ],
    close: async () => {
      closed += 1;
    },
  };
  const browserType = { connectOverCDP: async () => browser };
  const result = await captureSession('http://fixture.invalid', browserType);
  assert.equal(result.cookie_header, 'dsc-token=fake');
  assert.equal(clicked, true);
  assert.equal(closed, 1);
  page.reload = async () => {
    throw new Error('fixture failed');
  };
  await assert.rejects(
    captureSession('http://fixture.invalid', browserType),
    /fixture failed/,
  );
  assert.equal(closed, 2);
  page.reload = async () => {};
  let rejectResponse;
  page.waitForResponse = () =>
    new Promise((_resolve, reject) => {
      rejectResponse = reject;
    });
  page.getByText = () => ({
    click: async () => {
      throw new Error('click failed');
    },
  });
  await assert.rejects(
    captureSession('http://fixture.invalid', browserType),
    /click failed/,
  );
  rejectResponse(new Error('Browser closed while waiting for response'));
  assert.equal(closed, 3);
});

test('CLI guards preserve failure exit codes and prefixes without invoking real services', (t) => {
  const directory = temporary(t);
  for (const [name, args, prefix] of [
    ['auth-cookie', [], 'Cookie session setup failed:'],
    ['capture-session', ['--output'], 'TAPD session bootstrap failed:'],
    ['users', ['--config'], 'TAPD user search failed:'],
    ['run', ['--config'], '--config requires a value.'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, `../../src/cli/tapd/${name}.cjs`), ...args],
      {
        cwd: directory,
        env: {
          ...process.env,
          TAPD_COOKIE_HEADER: '',
          TAPD_WORKSPACE_ID: '',
          TAPD_CONFIG: '',
          RUNNER_WORKSPACE: '',
        },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      },
    );
    assert.equal(result.status, 1, name);
    assert.ok(result.stderr.includes(prefix), result.stderr);
    assert.equal(result.stdout, '');
  }
});
