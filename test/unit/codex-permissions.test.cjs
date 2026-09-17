const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const { PERMISSION_MODES, validatePermissionMode } = require('../../src/domain/permissions.cjs');
const {
  threadPermissionParams, turnPermissionParams, permissionOptions, assertPermissionAvailable,
} = require('../../src/codex/permissions.cjs');
const { inspectExecutionCapabilities } = require('../../src/codex/capabilities.cjs');
const { temporary } = require('../support/helpers.cjs');

test('permission presets map to exact native approval and sandbox policies', () => {
  const cwd = path.resolve('fixture-worktree');
  assert.deepEqual(PERMISSION_MODES.map(({ id }) => id), ['ask', 'auto', 'full']);
  for (const [mode, reviewer] of [['ask', 'user'], ['auto', 'auto_review']]) {
    assert.deepEqual(threadPermissionParams(mode), {
      approvalPolicy: 'on-request', approvalsReviewer: reviewer, sandbox: 'workspace-write',
    });
    assert.deepEqual(turnPermissionParams(mode, cwd), {
      approvalPolicy: 'on-request', approvalsReviewer: reviewer,
      sandboxPolicy: {
        type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false,
        excludeTmpdirEnvVar: false, excludeSlashTmp: false,
      },
    });
  }
  assert.deepEqual(threadPermissionParams('full'), {
    approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access',
  });
  assert.deepEqual(turnPermissionParams('full', cwd), {
    approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' },
  });
  assert.deepEqual(threadPermissionParams(), threadPermissionParams('ask'));
});

test('permission validation rejects unknown values and invalid working directories', () => {
  assert.equal(validatePermissionMode(), 'ask');
  for (const value of ['', null, false, 0, [], {}, 'never', 'workspace-write', 'FULL'])
    assert.throws(() => validatePermissionMode(value), /无效/);
  for (const cwd of ['', 'relative/path', null, undefined])
    assert.throws(() => turnPermissionParams('full', cwd), /工作区路径/);
});

test('automatic approval is advertised and accepted only with proven native support', async () => {
  for (const client of [
    {},
    { inspectExecutionCapabilities: async () => ({ autoReview: false }) },
    { inspectExecutionCapabilities: async () => ({ autoReview: 'true' }) },
    { inspectExecutionCapabilities: async () => { throw new Error('fixture unsupported'); } },
  ]) {
    const options = await permissionOptions(client);
    assert.equal(options.find(({ id }) => id === 'ask').available, true);
    assert.equal(options.find(({ id }) => id === 'full').available, true);
    const automatic = options.find(({ id }) => id === 'auto');
    assert.equal(automatic.available, false);
    assert.equal(typeof automatic.reason, 'string');
    await assert.rejects(assertPermissionAvailable(client, 'auto'), /自动审批/);
    await assertPermissionAvailable(client, 'ask');
    await assertPermissionAvailable(client, 'full');
  }
  const supported = { inspectExecutionCapabilities: async () => ({ autoReview: true }) };
  assert.ok((await permissionOptions(supported)).every(({ available }) => available));
  await assertPermissionAvailable(supported, 'auto');
  await assert.rejects(assertPermissionAvailable(supported, 'missing'), /无效/);
});

test('schema capability inspection requires support on start, resume and turns, and cleans generated files', async (t) => {
  const directory = temporary(t);
  let index = 0;
  for (const scenario of [
    {},
    { missingProperty: 'ThreadStartParams' },
    { missingProperty: 'ThreadResumeParams' },
    { missingReviewer: 'TurnStartParams' },
    { malformed: 'ThreadResumeParams' },
    { missing: 'TurnStartParams' },
  ]) {
    const log = path.join(directory, `schema-${++index}.jsonl`);
    const scenarioFile = path.join(directory, `scenario-${index}.json`);
    fs.writeFileSync(scenarioFile, JSON.stringify({ ...scenario, log }));
    const resolved = { command: process.execPath, args: [path.resolve(__dirname, '../fixtures/execution-schema.cjs'), scenarioFile] };
    if (scenario.malformed || scenario.missing) {
      await assert.rejects(inspectExecutionCapabilities(resolved));
    } else {
      assert.deepEqual(await inspectExecutionCapabilities(resolved), { autoReview: index === 1 });
      await inspectExecutionCapabilities(resolved);
      assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1,
        'successful capability inspection must be cached per executable identity');
    }
    for (const entry of fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse))
      assert.equal(fs.existsSync(entry.directory), false, 'temporary generated schemas must be removed');
  }
});

test('failed capability discovery can retry and never forwards TAPD credentials or thread identity', async (t) => {
  const directory = temporary(t);
  const scenarioFile = path.join(directory, 'scenario.json');
  const log = path.join(directory, 'schema.jsonl');
  fs.writeFileSync(scenarioFile, JSON.stringify({ log, failOnce: path.join(directory, 'failed') }));
  const resolved = { command: process.execPath, args: [path.resolve(__dirname, '../fixtures/execution-schema.cjs'), scenarioFile] };
  const previous = { cookie: process.env.TAPD_SCHEMA_FIXTURE, thread: process.env.CODEX_THREAD_ID };
  process.env.TAPD_SCHEMA_FIXTURE = 'fixture-only';
  process.env.CODEX_THREAD_ID = 'fixture-thread';
  try {
    await assert.rejects(inspectExecutionCapabilities(resolved), /fixture schema generation failed/);
    assert.deepEqual(await inspectExecutionCapabilities(resolved), { autoReview: true });
  } finally {
    if (previous.cookie === undefined) delete process.env.TAPD_SCHEMA_FIXTURE;
    else process.env.TAPD_SCHEMA_FIXTURE = previous.cookie;
    if (previous.thread === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previous.thread;
  }
  const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.credentialPresent, false);
    assert.equal(entry.threadPresent, false);
    assert.equal(fs.existsSync(entry.directory), false);
  }
});
