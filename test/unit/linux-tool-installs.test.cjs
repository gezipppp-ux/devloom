const assert = require("node:assert/strict");
const { test } = require("node:test");
const { linuxGitInstallPlan, installLinuxGit } = require("../../src/execution/linux-tool-installs.cjs");
const { systemUpdatePlan } = require("../../src/execution/system-tool-updates.cjs");

test("Linux APT first install uses the distro candidate and verifies Git without a shell", async () => {
  const adapters = { platform: "linux", uid: () => 0, executable: name => ["apt-get", "apt-cache"].includes(name) ? `/usr/bin/${name}` : null,
    run: async () => "git:\n  Installed: (none)\n  Candidate: 1:2.43.0-1ubuntu7.3\n" };
  const plan = await systemUpdatePlan("git", { missing: true }, adapters);
  assert.equal(plan.method, "apt");
  assert.equal(plan.targetVersion, "2.43.0");
  const calls = [];
  await installLinuxGit("2.43.0", plan, async (...args) => { calls.push(args); return args[1][0] === "--version" ? "git version 2.43.0" : ""; });
  assert.deepEqual(calls[0][1], ["install", "--yes", "--no-install-recommends", "git=1:2.43.0-1ubuntu7.3"]);
  assert.equal(calls[0][2].env.DEBIAN_FRONTEND, "noninteractive");
  assert.deepEqual(calls[1].slice(0, 2), ["/usr/bin/git", ["--version"]]);
  await assert.rejects(installLinuxGit("2.44.0", plan, async () => assert.fail("must not install")), /参数/);
  await assert.rejects(installLinuxGit("2.43.0", plan, async () => "git version 2.42.0"), /验证/);
  for (const policy of ["Installed: 1:2.43.0-1ubuntu7\nCandidate: 1:2.43.0-1ubuntu7", "Installed: (none)\nCandidate: (none)", "Installed: (none)\nCandidate: 2.43.0-rc1"])
    assert.equal((await linuxGitInstallPlan({ ...adapters, run: async () => policy })).available, false);
});

test("Linux DNF selects a pinned RPM version and protects existing or unknown installations", async () => {
  const adapters = { uid: () => 0, executable: name => ["dnf", "rpm"].includes(name) ? `/usr/bin/${name}` : null,
    run: async command => { if (command.endsWith("rpm")) throw Object.assign(new Error("absent"), { exitCode: 1 }); return "2.47.3-1.el9_6\n"; } };
  const plan = await linuxGitInstallPlan(adapters);
  assert.equal(plan.method, "dnf");
  assert.equal(plan.targetVersion, "2.47.3");
  const calls = [];
  await installLinuxGit("2.47.3", plan, async (command, args) => { calls.push([command, args]); return args[0] === "--version" ? "git version 2.47.3" : ""; });
  assert.deepEqual(calls[0], ["/usr/bin/dnf", ["install", "--assumeyes", "git-2.47.3-1.el9_6"]]);
  assert.equal((await linuxGitInstallPlan({ ...adapters, run: async () => "git installed" })).available, false);
  assert.equal((await linuxGitInstallPlan({ ...adapters, run: async () => { throw new Error("unknown"); } })).available, false);
  assert.equal((await linuxGitInstallPlan({ ...adapters, uid: () => 1000, run: async () => assert.fail("no probes needed") })).available, false);
  assert.equal((await linuxGitInstallPlan({ ...adapters, executable: () => null })).available, false);
});
