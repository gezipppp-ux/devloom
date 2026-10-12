const assert = require("node:assert/strict");
const { test } = require("node:test");
const { temporary } = require("../support/helpers.cjs");
const { EnvironmentServices } = require("../../src/application/environment-services.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");

async function fixture(t, overrides = {}) {
  const dataDirectory = temporary(t);
  (await saveSystemSettings({ memberStorageRoot: dataDirectory }, dataDirectory));
  return new EnvironmentServices({ dataDirectory, inspect: async () => ({ version: "1.0.0", satisfies: true, launch: { command: "private-command" } }), latest: async () => ({ version: "2.0.0" }), plan: async () => ({ available: true }), install: async () => {}, ...overrides });
}

test("environment report keeps failed probes and latest lookups distinct and private commands absent", async t => {
  const service = (await fixture(t, {
    inspect: async id => { if (id === "git") throw new Error("missing Git"); return { version: "1.0.0", satisfies: true, launch: { command: "private-command" } }; },
    latest: async id => { if (id === "npm") throw new Error("offline"); return { version: "2.0.0" }; },
  }));
  const initial = await service.read();
  assert.equal(initial.ready, false);
  assert.equal(initial.tools[0].latestStatus, "unchecked");
  const checked = await service.checkLatest();
  assert.equal(checked.tools.find(tool => tool.id === "npm").latestStatus, "error");
  assert.equal(checked.tools.find(tool => tool.id === "git").status, "unknown");
  assert.equal(checked.tools[0].latestStatus, "available");
  assert.equal(JSON.stringify(checked).includes("private-command"), false);
});

test("update preflight serializes requests, reauthorizes and verifies the installed result", async t => {
  let release, entered, version = "1.0.0", authorized = 0;
  const installing = new Promise(resolve => { entered = resolve; });
  const service = (await fixture(t, { inspect: async () => ({ version }), install: async () => { entered(); await new Promise(resolve => { release = resolve; }); version = "2.0.0"; } }));
  const input = { id: "codex", version: "2.0.0" };
  assert.equal((await service.start(input, () => authorized++)).status, "running");
  await installing;
  await assert.rejects(service.start(input, () => {}), /正在/);
  assert.equal(authorized, 1);
  release();
  await service.pending;
  assert.equal(service.status().job.status, "completed");
  assert.equal(service.status().busy, false);
  await assert.rejects(service.start(input, () => {}), /无需更新/);
});

test("busy tasks, changed targets, revoked permission and unsupported installers never run updates", async t => {
  const input = { id: "npm", version: "2.0.0" };
  for (const overrides of [
    { managers: () => [{ startingRequests: 1 }] },
    { cloning: () => true },
    { latest: async () => ({ version: "3.0.0" }) },
    { plan: async () => ({ available: false, reason: "unsupported" }) },
  ]) {
    const service = (await fixture(t, { ...overrides, install: async () => assert.fail("must not install") }));
    await assert.rejects(service.start(input, () => {}));
    assert.equal(service.busy, false);
  }
  const revoked = (await fixture(t, { install: async () => assert.fail("must not install") }));
  await assert.rejects(revoked.start(input, () => { throw new Error("revoked"); }), /revoked/);
  await assert.rejects(revoked.start(input, async () => { throw new Error("async revoked"); }), /async revoked/);
  assert.equal(revoked.busy, false);
  await assert.rejects(revoked.start({ ...input, command: "evil" }, () => {}), /参数/);
  await revoked.close();
  await assert.rejects(revoked.start(input, () => {}), /关闭/);
});

test("failed installation and stale PATH never report success; polling does not repeat installation", async t => {
  for (const install of [async () => { throw new Error("permission denied"); }, async () => {}]) {
    const service = (await fixture(t, { install }));
    await service.start({ id: "npm", version: "2.0.0" }, () => {});
    await service.pending;
    assert.equal(service.status().job.status, "failed");
    assert.equal(service.status().busy, false);
    assert.equal(service.status().job.status, "failed");
  }
});

test("Node installation is recorded as pending restart without pretending the live runtime changed", async t => {
  const service = (await fixture(t, { install: async () => ({ installedVersion: "2.0.0", restartRequired: true }) }));
  await service.start({ id: "node", version: "2.0.0" }, () => {});
  await service.pending;
  assert.equal(service.status().job.status, "restart-required");
  const report = await service.read();
  assert.equal(report.tools.find(tool => tool.id === "node").version, "2.0.0");
  assert.equal(report.tools.find(tool => tool.id === "node").pendingRestart, true);
  assert.equal(report.runningNode, process.version);
  await assert.rejects(service.start({ id: "node", version: "2.0.0" }, () => {}), /先重启/);
});
