const assert = require("node:assert/strict");
const { test } = require("node:test");
const { temporary } = require("../support/helpers.cjs");
const { EnvironmentServices } = require("../../src/application/environment-services.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");

test("missing-tool batch serializes Git before Codex, excludes concurrent requests and reauthorizes each tool", async t => {
  const order = [], installed = new Set();
  let release, entered, authorizations = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const service = await fixture(t, {
    inspect: async id => { if (!installed.has(id)) throw Object.assign(new Error("missing"), { code: "TOOL_NOT_FOUND" }); return { version: "2.0.0" }; },
    plan: async () => ({ available: true, operation: "install" }),
    install: async id => { order.push(id); if (id === "git") { entered(); await new Promise(resolve => { release = resolve; }); } installed.add(id); },
  });
  const input = { tools: ["codex", "git"].map(id => ({ id, version: "2.0.0" })) };
  assert.equal((await service.installMissing(input, () => authorizations++)).busy, true);
  await started;
  await assert.rejects(service.installMissing(input, () => {}));
  await assert.rejects(service.start({ id: "npm", version: "2.0.0" }, () => {}));
  release(); await service.batchPending;
  assert.deepEqual(order, ["git", "codex"]);
  assert.equal(authorizations, 3);
  assert.equal(service.status().busy, false);
  assert.equal(service.status().batch.status, "completed");
});

test("missing-tool batch stops at failure or restart and cannot install after permission revocation", async t => {
  for (const outcome of ["failure", "restart", "revoked"]) {
    const order = []; let authorized = 0;
    const service = await fixture(t, {
      inspect: async () => { throw Object.assign(new Error("missing"), { code: "TOOL_NOT_FOUND" }); },
      plan: async () => ({ available: true, operation: "install" }),
      install: async id => { order.push(id); if (outcome === "failure") throw new Error("fixture failure"); return { installedVersion: "2.0.0", restartRequired: outcome === "restart" }; },
    });
    await service.installMissing({ tools: ["git", "codex"].map(id => ({ id, version: "2.0.0" })) }, () => { if (++authorized === 3) throw new Error("revoked"); });
    await service.batchPending;
    assert.deepEqual(order, ["git"]);
    assert.equal(service.status().batch.status, outcome === "restart" ? "restart-required" : "failed");
    assert.equal(service.status().busy, false);
  }
});

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

test("first installation distinguishes missing tools from broken probes, reauthorizes, and reprobes", async t => {
  let installed = false, authorized = 0;
  const service = await fixture(t, {
    inspect: async id => { if (id === "codex" && !installed) throw Object.assign(new Error("missing"), { code: "TOOL_NOT_FOUND" }); return { version: "2.0.0", satisfies: true }; },
    plan: async (_id, inspected) => ({ available: true, operation: inspected.missing ? "install" : "update" }),
    install: async () => { installed = true; },
  });
  const initial = (await service.checkLatest()).tools.find(tool => tool.id === "codex");
  assert.equal(initial.missing, true);
  assert.equal(initial.installAvailable, true);
  assert.equal(initial.latestStatus, "installable");
  assert.equal(initial.updateAvailable, false);
  assert.equal(initial.installVersion, "2.0.0");
  const input = { id: "codex", version: "2.0.0", operation: "install" };
  await service.start(input, () => authorized++);
  await service.pending;
  assert.equal(authorized, 1);
  assert.equal(service.job.operation, "install");
  assert.equal(service.job.status, "completed");
  assert.doesNotMatch(service.job.message, /登录|认证/);
  const report = await service.read();
  assert.equal(report.ready, true);
  assert.equal(report.tools.find(tool => tool.id === "codex").installAvailable, false);
  await assert.rejects(service.start(input, () => {}), /已检测到/);
  const broken = await fixture(t, { inspect: async () => { throw new Error("broken probe"); }, install: async () => assert.fail("must not install") });
  assert.equal((await broken.read()).tools[0].installAvailable, false);
  await assert.rejects(broken.start(input, () => {}), /broken probe/);
});

test("Linux first Git install confirms distro target, refuses changed candidates and revoked permission", async t => {
  const overrides = { inspect: async () => { throw Object.assign(new Error("missing"), { code: "TOOL_NOT_FOUND" }); },
    latest: async () => assert.fail("distro installs do not require upstream latest"),
    plan: async () => ({ available: true, operation: "install", targetVersion: "2.43.0", source: "Linux APT 软件源" }),
    install: async () => ({ installedVersion: "2.43.0" }) };
  const input = { id: "git", version: "2.43.0", operation: "install" };
  const service = await fixture(t, overrides);
  assert.equal((await service.read()).tools.find(tool => tool.id === "git").installSource, "Linux APT 软件源");
  await service.start(input, () => {});
  await service.pending;
  assert.equal(service.job.status, "completed");
  await assert.rejects(service.start({ ...input, version: "2.44.0" }, () => {}), /目标版本已变化/);
  const revoked = await fixture(t, { ...overrides, install: async () => assert.fail("must not install") });
  await assert.rejects(revoked.start(input, () => { throw new Error("revoked"); }), /revoked/);
  await assert.rejects(revoked.start({ ...input, operation: "shell" }, () => {}), /参数/);
});
