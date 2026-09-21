const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { AppServerClient } = require('../../src/codex/app-server-client.cjs');
const { temporary } = require('../support/helpers.cjs');

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
  assert.equal(client.refreshGitCredentials(), false);
  revision = 2;
  const pending = client.request('probe', { delay: 30 });
  assert.equal(client.refreshGitCredentials(), false, 'never rotate during an RPC');
  assert.equal(await pending, '1');
  assert.equal(client.refreshGitCredentials(), true);
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
