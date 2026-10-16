const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { AppServerClient } = require('../../src/codex/app-server-client.cjs');
const { temporary } = require('../support/helpers.cjs');

test('supplier credentials reach only the dedicated child environment and native overrides preserve the shared home', async t => {
  const directory = temporary(t), script = path.join(directory, 'supplier-child.cjs');
  fs.writeFileSync(script, `require('node:readline').createInterface({input:process.stdin}).on('line', line => {
    const message = JSON.parse(line);
    if (message.id) process.stdout.write(JSON.stringify({ id: message.id, result: {
      keyPresent: process.env.DEVLOOM_AGENT_API_KEY === 'fixture-private-key', args: process.argv.slice(2),
      home: process.env.CODEX_HOME || null, diagnostic: 'fixture-private-key'
    } })+'\\n');
  });`);
  const supplier = { mode: 'api-key', apiKey: 'fixture-private-key', baseUrl: 'https://fixture.invalid/v1', defaultModel: 'custom-model' };
  const client = new AppServerClient({ command: process.execPath, command_args: [script] }, { supplier });
  client.inspectExecutionCapabilities = async () => ({ supplierConfiguration: true });
  t.after(() => client.close());
  await client.connect();
  const probe = await client.request('probe', {});
  assert.equal(probe.keyPresent, true);
  assert.equal(probe.home, process.env.CODEX_HOME || null);
  assert.equal(probe.diagnostic, '[redacted]');
  assert.doesNotMatch(JSON.stringify(client.child.spawnargs), /fixture-private-key/);
  assert.ok(probe.args.includes('model_providers.web_coding_supplier.wire_api="responses"'));
  assert.ok(probe.args.includes('model_providers.web_coding_supplier.env_key="DEVLOOM_AGENT_API_KEY"'));
  assert.equal(process.env.DEVLOOM_AGENT_API_KEY, undefined);
});

test('explicit shutdown is terminal and cannot launch another transport', async () => {
  const client = new AppServerClient({ command: process.execPath });
  client.close();
  client.open = () => assert.fail('closed transport must not spawn');
  await assert.rejects(client.connect(), /服务已关闭/);
  assert.throws(() => client.inspectExecutionCapabilities(), /服务已关闭/);
});

test('failed initialization cannot close a replacement connection started by disconnect listeners', async (t) => {
  const directory = temporary(t);
  const failed = path.join(directory, '失败 连接.cjs');
  const ready = path.join(directory, '可用 连接.cjs');
  fs.writeFileSync(
    failed,
    'process.stdin.resume(); process.stdin.once("data", () => process.exit(1));',
  );
  fs.writeFileSync(
    ready,
    `
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const message=JSON.parse(line);
      process.stdout.write('null\\n42\\n"startup log"\\n[]\\n');
      if(message.id) process.stdout.write(JSON.stringify({id:message.id,result:{ok:true}})+'\\n');
    });
  `,
  );
  const client = new AppServerClient({
    command: process.execPath,
    command_args: [failed],
  });
  t.after(() => client.close());
  let replacement;
  client.once('disconnected', () => {
    client.config.command_args = [ready];
    replacement = client.connect();
  });
  await assert.rejects(client.connect(), /连接已关闭/);
  await replacement;
  assert.deepEqual(await client.request('probe', {}, 1000), { ok: true });
});

test('closed stdout rejects pending RPC promptly even when the process remains alive', async (t) => {
  const directory = temporary(t);
  const script = path.join(directory, '关闭 输出.cjs');
  fs.writeFileSync(
    script,
    `
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const message=JSON.parse(line);
      if(message.method==='initialize') process.stdout.write(JSON.stringify({id:message.id,result:{}})+'\\n');
    });
    setInterval(()=>{},1000);
  `,
  );
  const client = new AppServerClient({
    command: process.execPath,
    command_args: [script],
  });
  t.after(() => client.close());
  await client.connect();
  const child = client.child;
  let childClosed = false;
  child.once('close', () => {
    childClosed = true;
  });
  const pending = client.request('pending', {}, 1000);
  child.stdout.destroy();
  await assert.rejects(pending, /输出连接已关闭/);
  await client.close();
  assert.equal(
    childClosed,
    true,
    'shutdown must await the disconnected process cleanup',
  );
  assert.equal(client.child, null);
});

test('a workspace Git credential provider configures only its Codex child and is disposed on shutdown', async (t) => {
  const directory = temporary(t);
  const script = path.join(directory, '检查 Git 环境.cjs');
  fs.writeFileSync(
    script,
    `
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const message=JSON.parse(line);
      if(message.id) process.stdout.write(JSON.stringify({id:message.id,result:{
        config:process.env.GIT_CONFIG_VALUE_0,
        askpass:process.env.GIT_ASKPASS || null,
      }})+'\\n');
    });
  `,
  );
  let disposed = false;
  const original = process.env.GIT_ASKPASS;
  process.env.GIT_ASKPASS = '/inherited/credential-helper';
  const client = new AppServerClient(
    { command: process.execPath, command_args: [script] },
    {
      gitCredentialProvider: async () => ({
        env: {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'credential.interactive',
          GIT_CONFIG_VALUE_0: 'false',
        },
        dispose: () => { disposed = true; },
      }),
    },
  );
  try {
    await client.connect();
    assert.deepEqual(await client.request('probe', {}, 1000), {
      config: 'false',
      askpass: null,
    });
  } finally {
    if (original === undefined) delete process.env.GIT_ASKPASS;
    else process.env.GIT_ASKPASS = original;
    await client.close();
  }
  assert.equal(disposed, true);
});

test('shutdown cleans credentials that finish loading after a connection closes', async () => {
  let release, disposed = false;
  const ready = new Promise(resolve => { release = resolve; });
  const client = new AppServerClient(
    { command: process.execPath },
    {
      gitCredentialProvider: async () => {
        await ready;
        return { env: {}, dispose: () => { disposed = true; } };
      },
    },
  );
  const connecting = client.connect();
  await Promise.resolve();
  await client.close();
  release();
  await assert.rejects(connecting, /服务已关闭/);
  assert.equal(disposed, true);
});

test('thread identity configuration preserves shell filters and settings without copying Git authentication', async () => {
  for (const policy of [
    { inherit: 'none', set: { CUSTOM: 'preserved' }, include_only: ['CUSTOM'], exclude: ['GIT_*'] },
    { inherit: 'core', set: { CUSTOM: 'preserved' }, filters: { CUSTOM: 'include', 'GIT_*': 'exclude' } },
    { inherit: 'all', set: { CUSTOM: 'preserved' }, filters: { '*TOKEN*': 'exclude' } },
    { inherit: 'all', ignore_default_excludes: false, exclude: [], include_only: [], set: { CUSTOM: 'preserved' }, experimental_use_profile: false },
  ]) {
    const env = { GIT_AUTHOR_NAME: 'Chosen', GIT_AUTHOR_EMAIL: 'chosen@example.invalid', GIT_COMMITTER_NAME: 'Chosen', GIT_COMMITTER_EMAIL: 'chosen@example.invalid', GIT_CONFIG_VALUE_0: 'Authorization: secret', GIT_SSH_COMMAND: 'private-key-path' };
    const client = new AppServerClient({}, { gitCredentialProvider: async () => ({ env }) });
    client.request = async (method, params) => {
      assert.equal(method, 'config/read');
      assert.deepEqual(params, { cwd: '/task', includeLayers: false });
      return { config: { shell_environment_policy: policy } };
    };
    const config = await client.gitIdentityConfig('/task');
    assert.equal(config.shell_environment_policy.inherit, policy.inherit);
    assert.equal(config.shell_environment_policy.set.CUSTOM, 'preserved');
    assert.equal(config.shell_environment_policy.set.GIT_AUTHOR_NAME, 'Chosen');
    assert.equal(config.shell_environment_policy.set.GIT_COMMITTER_EMAIL, 'chosen@example.invalid');
    if (policy.include_only?.length) assert.ok(config.shell_environment_policy.include_only.includes('GIT_AUTHOR_NAME'));
    if (policy.filters?.CUSTOM) assert.equal(config.shell_environment_policy.filters.GIT_AUTHOR_NAME, 'include');
    if (!policy.include_only && !policy.filters?.CUSTOM) assert.deepEqual(config.shell_environment_policy.filters, policy.filters);
    assert.doesNotMatch(JSON.stringify(config), /Authorization|secret|private-key-path|GIT_CONFIG_VALUE/);
    assert.equal(policy.set.GIT_AUTHOR_NAME, undefined);
    env.GIT_AUTHOR_NAME = undefined;
    env.GIT_AUTHOR_EMAIL = undefined;
    env.GIT_COMMITTER_NAME = undefined;
    env.GIT_COMMITTER_EMAIL = undefined;
    assert.deepEqual((await client.gitIdentityConfig('/task')).shell_environment_policy, policy);
    await client.close();
  }
});

test('unset config/read policy fields are omitted from session flags because JSON null becomes a TOML string', async () => {
  const policy = { inherit: null, ignore_default_excludes: null, exclude: null, set: null, include_only: null, filters: null, experimental_use_profile: null };
  const env = { GIT_AUTHOR_NAME: 'Chosen', GIT_AUTHOR_EMAIL: 'chosen@example.invalid', GIT_COMMITTER_NAME: 'Chosen', GIT_COMMITTER_EMAIL: 'chosen@example.invalid' };
  const client = new AppServerClient({}, { gitCredentialProvider: async () => ({ env }) });
  client.request = async () => ({ config: { shell_environment_policy: policy } });
  assert.deepEqual(await client.gitIdentityConfig('/task'), { shell_environment_policy: { set: env } });
  assert.ok(Object.values(policy).every(value => value === null), 'do not mutate the config/read response');
  for (const name of Object.keys(env)) delete env[name];
  assert.deepEqual(await client.gitIdentityConfig('/task'), { shell_environment_policy: { set: {} } });
  await client.close();
});

test('reconnect and idle revision changes reload credentials and dispose only stopped children', async t => {
  const directory = temporary(t), script = path.join(directory, 'credential-version.cjs');
  fs.writeFileSync(script, `require('node:readline').createInterface({input:process.stdin}).on('line', line => {
    const m = JSON.parse(line);
    if (m.id) setTimeout(() => process.stdout.write(JSON.stringify({id:m.id,result:process.env.FIXTURE_VERSION})+'\\n'), m.params?.delay || 0);
  });`);
  let revision = 1, loads = 0;
  const resources = [];
  const client = new AppServerClient({ command: process.execPath, command_args: [script] }, {
    gitCredentialRevision: () => revision,
    gitCredentialProvider: async () => {
      loads++;
      const resource = { disposed: false };
      resources.push(resource);
      return { env: { FIXTURE_VERSION: String(revision) }, revision, dispose: () => {
        assert.ok(client.closedChildren.has(resource.child), 'do not remove a live child key');
        resource.disposed = true;
      } };
    },
  });
  t.after(() => client.close());
  await client.connect();
  resources.at(-1).child = client.child;
  assert.equal((await client.refreshGitCredentials()), false);
  revision = 2;
  const pending = client.request('probe', { delay: 30 });
  assert.equal((await client.refreshGitCredentials()), false, 'never rotate during an RPC');
  assert.equal(await pending, '1');
  assert.equal((await client.refreshGitCredentials()), true);
  await Promise.all([...client.stopping]);
  assert.equal(resources[0].disposed, true);
  await client.connect();
  resources.at(-1).child = client.child;
  assert.equal(await client.request('probe', {}), '2');
  revision = 3;
  client.disconnected(new Error('fixture disconnect'));
  await client.connect();
  resources.at(-1).child = client.child;
  assert.equal(await client.request('probe', {}), '3');
  assert.equal(loads, 3);
  await client.close();
  assert.ok(resources.every(resource => resource.disposed));
});
