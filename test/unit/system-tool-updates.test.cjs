const assert = require("node:assert/strict");
const { test } = require("node:test");
const { systemUpdatePlan, installSystemTool } = require("../../src/execution/system-tool-updates.cjs");

test("nvm 2 plan matches the running Node installation, not a different nvm", async () => {
  const adapters = {
    platform: "win32", node: "C:\\nvm\\installs\\v22.13.0\\node.exe", executable: () => "C:\\nvm\\nvm.exe", same: (a, b) => a === b,
    run: async (_command, args) => args[0] === "version" ? "v2.0.1" : JSON.stringify({ installation: { path: "C:\\nvm" }, operations: { version_root: "C:\\nvm\\installs" } }),
  };
  const plan = await systemUpdatePlan("node", { version: "22.13.0" }, adapters);
  assert.equal(plan.method, "nvm-windows-2");
  assert.equal(plan.restartRequired, true);
  assert.equal((await systemUpdatePlan("node", { version: "22.13.0" }, { ...adapters, node: "C:\\other\\node.exe" })).available, false);
  assert.equal((await systemUpdatePlan("git", {}, { ...adapters, platform: "linux" })).available, false);
});

test("nvm installs and verifies an exact target before activation, with restart explicitly required", async () => {
  const calls = [], plan = { available: true, method: "nvm-windows-2", command: "nvm.exe", directory: "C:\\nvm\\installs" };
  const run = async (command, args) => { calls.push([command, args]); return args[0] === "--version" ? "v24.2.0" : args[0] === "default" ? "Default  : v24.2.0\nLast : v22.13.0" : ""; };
  assert.deepEqual(await installSystemTool("node", "24.2.0", plan, run), { installedVersion: "24.2.0", restartRequired: true });
  assert.deepEqual(calls.slice(0, 3), [
    ["nvm.exe", ["install", "version", "24.2.0"]],
    ["C:\\nvm\\installs\\v24.2.0\\node.exe", ["--version"]],
    ["nvm.exe", ["use", "version", "24.2.0", "--no-install"]],
  ]);
  let activated = false;
  await assert.rejects(installSystemTool("node", "24.2.0", plan, async (_command, args) => { if (args[0] === "use") activated = true; return "v22.13.0"; }), /验证/);
  assert.equal(activated, false);
  await assert.rejects(installSystemTool("node", "24.2.0", plan, async (_command, args) => args[0] === "--version" ? "v24.2.0" : "Default : v22.13.0"), /未切换/);
});

test("winget pins the matching Windows build and refuses absent versions or foreign package IDs", async () => {
  const plan = { available: true, method: "winget", command: "winget.exe", packageId: "Git.Git" };
  const calls = [];
  await installSystemTool("git", "2.55.0.windows.5", plan, async (command, args) => { calls.push([command, args]); return "Version\n2.55.0.5\n2.54.0"; });
  assert.deepEqual(calls[1], ["winget.exe", ["upgrade", "--id", "Git.Git", "--exact", "--source", "winget", "--version", "2.55.0.5", "--silent", "--disable-interactivity", "--accept-source-agreements", "--accept-package-agreements"]]);
  await assert.rejects(installSystemTool("git", "2.55.0.windows.5", plan, async () => "2.54.0"), /尚未发布/);
  for (const version of ["latest", "2.55.0.windows.5 & evil"])
    await assert.rejects(installSystemTool("git", version, plan, async () => assert.fail("must not execute")));
  await assert.rejects(installSystemTool("git", "2.55.0.windows.5", { ...plan, packageId: "Other.Package" }, async () => assert.fail("must not execute")));
});

test("Windows first Git install requires absent package identity and never overwrites a hidden installation", async () => {
  const adapters = { platform: "win32", executable: () => "winget.exe", same: () => false,
    run: async () => { throw Object.assign(new Error("no matches"), { exitCode: -1978335212 }); } };
  const plan = await systemUpdatePlan("git", { missing: true }, adapters);
  assert.equal(plan.operation, "install");
  const calls = [];
  await installSystemTool("git", "2.55.0.windows.1", plan, async (_command, args) => { calls.push(args); return args[0] === "show" ? "2.55.0" : args[0] === "--version" ? "git version 2.55.0.windows.1" : ""; });
  assert.equal(calls[1][0], "install");
  assert.equal((await systemUpdatePlan("git", { missing: true }, { ...adapters, same: () => true })).available, false);
  assert.equal((await systemUpdatePlan("git", { missing: true }, { ...adapters, run: async () => "Git Git.Git 2.55.0" })).available, false);
  assert.equal((await systemUpdatePlan("git", { missing: true }, { ...adapters, run: async () => { throw new Error("source offline"); } })).available, false);
});
