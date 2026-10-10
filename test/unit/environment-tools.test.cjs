const assert = require("node:assert/strict");
const { test } = require("node:test");
const { toolVersion, compareVersions } = require("../../src/domain/tool-version.cjs");
const path = require("node:path");
const { latestTool, installTool, inspectTool, updatePlan } = require("../../src/execution/environment-tools.cjs");
const { runTool } = require("../../src/shared/tool-process.cjs");

test("tool process arguments remain literal and failures hide raw diagnostics", async () => {
  const input = "literal & $value ; not a shell";
  assert.equal(await runTool(process.execPath, ["-e", "process.stdout.write(process.argv[1])", input]), input);
  await assert.rejects(runTool(process.execPath, ["-e", "process.stderr.write('private diagnostic');process.exit(7)"]), error => error.message.includes("7") && !error.message.includes("private"));
  await assert.rejects(runTool(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 100 }), /超时/);
});

test("Codex probes use the configured launcher and treat failed login status as a failed requirement", async () => {
  const calls = [];
  const result = await inspectTool("codex", {
    codex: () => ({ command: "fixture-node", args: ["fixture-codex.js"] }),
    run: async (command, args) => { calls.push([command, args]); if (args.includes("login")) throw new Error("not authenticated"); return "codex-cli 0.99.0"; },
  });
  assert.equal(result.version, "0.99.0");
  assert.equal(result.satisfies, false);
  assert.deepEqual(calls[1], ["fixture-node", ["fixture-codex.js", "login", "status"]]);
  await assert.rejects(inspectTool("git", { executable: () => null }), /未找到/);
});

test("automatic update only manages the exact active npm global installation", async () => {
  const root = path.resolve("fixture-global");
  const active = path.join(root, "@openai/codex/bin/codex.js");
  const adapters = {
    npm: () => ({ command: "fixture-node", args: ["npm-cli.js"], script: path.join(root, "npm/bin/npm-cli.js") }),
    run: async () => root,
    same: (left, right) => left === right,
    system: async () => ({ available: false }),
  };
  assert.equal((await updatePlan("codex", { launch: { command: "node", args: [active] } }, adapters)).available, true);
  assert.equal((await updatePlan("codex", { launch: { command: "desktop-codex", args: [] } }, adapters)).available, false);
  assert.equal((await updatePlan("npm", {}, adapters)).available, true);
  assert.equal((await updatePlan("node", {}, adapters)).available, false);
});

test("tool versions handle Git for Windows and compare numeric segments", () => {
  assert.equal(toolVersion("git version 2.51.0.windows.1"), "2.51.0.windows.1");
  assert.equal(compareVersions("2.51.0.windows.2", "2.51.0.windows.1"), 1);
  assert.equal(compareVersions("2.51.0.windows.1", "2.5.0"), 1);
  assert.equal(toolVersion("codex-cli 0.120.0"), "0.120.0");
  assert.equal(toolVersion("v22.13.0"), "22.13.0");
  assert.equal(toolVersion("unknown"), null);
  assert.equal(compareVersions("0.100.0", "0.99.0"), 1);
  assert.equal(compareVersions("22.12.0", "22.13.0"), -1);
  assert.throws(() => compareVersions(null, "22.13.0"));
});

test("latest sources select LTS and stable versions, never release candidates", async () => {
  const node = await latestTool("node", async () => [{ version: "v26.1.0", lts: false }, { version: "v24.2.0", lts: "Krypton" }, { version: "v24.12.0", lts: "Krypton" }]);
  assert.equal(node.version, "24.12.0");
  const git = await latestTool("git", async () => [{ name: "v2.52.0-rc1" }, { name: "v2.51.0" }], "linux");
  assert.equal(git.version, "2.51.0");
  assert.equal((await latestTool("git", async () => ({ tag_name: "v2.51.0.windows.2" }), "win32")).version, "2.51.0.windows.2");
  await assert.rejects(latestTool("npm", async () => ({ version: "1.0.0; evil" })), /无效/);
  await assert.rejects(latestTool("node", async () => []), /LTS/);
});

test("updates pin an allowlisted package version and enforce engine compatibility without a shell", async () => {
  const calls = [], plan = { available: true, method: "npm", command: "fixture-node", args: ["fixture npm-cli.js"] };
  await installTool("codex", "1.2.3", plan, async (...args) => calls.push(args));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["fixture-node", ["fixture npm-cli.js", "install", "--global", "@openai/codex@1.2.3", "--registry=https://registry.npmjs.org", "--engine-strict", "--no-audit", "--no-fund"]]);
  for (const [id, version] of [["git", "1.2.3"], ["npm", "latest"], ["npm", "1.2.3 && evil"]])
    await assert.rejects(installTool(id, version, plan, async () => assert.fail("must not execute")));
});
