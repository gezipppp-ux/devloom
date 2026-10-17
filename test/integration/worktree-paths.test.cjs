const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { createServer } = require("node:http");
const { setTimeout: delay } = require("node:timers/promises");
const { temporary } = require("../support/helpers.cjs");
const { createWorktree, worktreePlan } = require("../../src/git/worktrees.cjs");
const { withRepositoryOperation } = require("../../src/storage/git-operations.cjs");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const source = { channel: "manual", scope: "manual", id: "11111111-2222-4333-8444-555555555555" };

function command(repository, args, input) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"], input,
  }).replace(/\r?\n$/, "");
}

function fixture(t) {
  const directory = temporary(t);
  const repository = path.join(directory, "repo");
  fs.mkdirSync(repository);
  command(repository, ["init", "-b", "main"]);
  command(repository, ["config", "user.name", "Fixture"]);
  command(repository, ["config", "user.email", "test@example.invalid"]);
  command(repository, ["config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(repository, "file.txt"), "fixture\n");
  command(repository, ["add", "."]);
  command(repository, ["-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"]);
  return { directory, repository, root: path.join(directory, "trees") };
}

function checkoutHook({ directory, repository }, exitCode = 0) {
  const hooks = path.join(directory, "hooks");
  const ready = path.join(directory, "hook-ready");
  const release = path.join(directory, "hook-release");
  const quote = (value) => `'${value.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;
  const args = [process.execPath, path.resolve(__dirname, "../fixtures/worktree-hook.cjs"), ready, release, String(exitCode)];
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, "post-checkout"), `#!/bin/sh\nexec ${args.map(quote).join(" ")}\n`, { mode: 0o755 });
  command(repository, ["config", "core.hooksPath", hooks.replaceAll("\\", "/")]);
  return { ready, release };
}

async function hookPid(file) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const value = Number(fs.readFileSync(file, "utf8"));
      if (value > 0) return value;
    }
    await delay(20);
  }
  assert.fail("Checkout hook did not start");
}

test("task paths have one compact directory and retain full identity in their stable hash", (t) => {
  const { repository, root } = fixture(t);
  const plan = worktreePlan(repository, {}, "main", {
    root, workspaceId, source, slug: "a-very-long-readable-title-that-keeps-growing",
  });
  const canonical = fs.realpathSync.native(repository);
  const id = createHash("sha256").update(JSON.stringify([
    process.platform === "win32" ? canonical.toLowerCase() : canonical,
    workspaceId, source.channel, source.scope, source.id,
  ])).digest("hex").slice(0, 12);
  assert.equal(plan.path, path.join(root, `a-very-long-read-${id}`));
  assert.equal(plan.branch, `codex/${id}`);
  assert.equal(path.relative(root, plan.path).split(path.sep).length, 1);
  assert.ok(path.basename(plan.path).length <= 29);
  const renamed = worktreePlan(repository, {}, "main", { root, workspaceId, source, name: "custom" });
  assert.equal(renamed.branch, plan.branch);
  assert.equal(renamed.path, path.join(root, `custom-${id}`));
  assert.throws(() => worktreePlan(repository, { workspace_id: "1", id: "2" }, "main", { root }), /source identity/);
  const cli = worktreePlan(repository, {}, "main", { root, source });
  assert.match(path.basename(cli.path), /^manual-[a-f0-9]{12}$/);
  assert.match(cli.branch, /^codex\/[a-f0-9]{12}$/);
  const identities = [
    { workspaceId: "21111111-1111-4111-8111-111111111111", source },
    { workspaceId, source: { ...source, scope: "another" } },
    { workspaceId, source: { ...source, id: "another" } },
    { workspaceId, source: { ...source, channel: "issue" } },
  ].map((identity) => worktreePlan(repository, {}, "main", { root, name: "custom", ...identity }));
  assert.equal(new Set([renamed.branch, ...identities.map((entry) => entry.branch)]).size, 5);
});

test("canonical repository identity is stable through aliases but separates different repositories", (t) => {
  const { directory, repository, root } = fixture(t);
  const options = { root, workspaceId, source, name: "task" };
  const plan = worktreePlan(repository, {}, "main", options);
  const alias = path.join(directory, "alias");
  fs.symlinkSync(repository, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal(worktreePlan(alias, {}, "main", options).branch, plan.branch);
  if (process.platform === "win32")
    assert.equal(worktreePlan(repository.toUpperCase(), {}, "main", options).branch, plan.branch);
  const another = path.join(directory, "other-repo");
  command(directory, ["clone", repository, another]);
  assert.notEqual(worktreePlan(another, {}, "main", options).branch, plan.branch);
});

test("existing directories and branches are rejected without overwrite or identity reuse", async (t) => {
  const { repository, root } = fixture(t);
  const plan = worktreePlan(repository, {}, "main", { root, workspaceId, source });
  fs.mkdirSync(plan.path, { recursive: true });
  const marker = path.join(plan.path, "marker.txt");
  fs.writeFileSync(marker, "keep");
  await assert.rejects(createWorktree(plan), /already exists/);
  assert.equal(fs.readFileSync(marker, "utf8"), "keep");
  assert.throws(() => command(repository, ["rev-parse", "--verify", plan.branch]));
  fs.unlinkSync(marker);
  fs.rmdirSync(plan.path);
  command(repository, ["branch", plan.branch]);
  await assert.rejects(createWorktree(plan), /分支已存在/);
  assert.equal(fs.existsSync(plan.path), false);
});

test("Windows preflight rejects the old deep layout before mutations while compact paths checkout successfully", { skip: process.platform !== "win32" }, async (t) => {
  const { repository, root } = fixture(t);
  const relative = `packages/${"shared-component-".repeat(4)}/src/组件 with spaces.vue`;
  const file = path.join(repository, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "fixture\n");
  command(repository, ["add", "."]);
  command(repository, ["-c", "core.hooksPath=/dev/null", "commit", "-m", "nested fixture"]);
  const compact = worktreePlan(repository, {}, "main", { root, workspaceId, source, slug: "add-long-component-name" });
  const old = {
    ...compact,
    path: path.join(root, "a".repeat(16), workspaceId, `manual-${"long-title-".repeat(5)}-${"b".repeat(12)}`),
  };
  assert.ok(path.join(old.path, relative).length > 259);
  await assert.rejects(createWorktree(old), (error) => {
    assert.match(error.message, /超过 Windows/);
    assert.match(error.message, /最多允许 \d+ 个字符/);
    assert.ok(error.message.includes(relative));
    return true;
  });
  assert.equal(fs.existsSync(root), false);
  assert.throws(() => command(repository, ["rev-parse", "--verify", compact.branch]));
  await createWorktree(compact);
  assert.equal(fs.readFileSync(path.join(compact.path, ...relative.split("/")), "utf8").trim(), "fixture");
  assert.equal(command(compact.path, ["rev-parse", "HEAD"]), compact.base_commit);
});

test("Windows preflight checks the recorded base commit and handles tree listings larger than maxBuffer", { skip: process.platform !== "win32" }, async (t) => {
  const { repository, root } = fixture(t);
  const plan = worktreePlan(repository, {}, "main", { root, workspaceId, source });
  const blob = command(repository, ["rev-parse", "HEAD:file.txt"]);
  const names = Array.from({ length: 10000 }, (_, index) => `${String(index).padStart(5, "0")}-${"x".repeat(105)}.txt`);
  assert.ok(names.join("\0").length > 1024 * 1024);
  const tree = command(repository, ["mktree"], names.map((name) => `100644 blob ${blob}\t${name}\n`).join(""));
  const commit = command(repository, ["commit-tree", tree, "-m", "large committed tree"]);
  const longPlan = { ...plan, base_commit: commit, path: path.join(root, "x".repeat(110)) };
  await assert.rejects(createWorktree(longPlan), /无法创建 Worktree.*超过 Windows/);
  assert.equal(fs.existsSync(root), false);
  assert.throws(() => command(repository, ["rev-parse", "--verify", plan.branch]));
  // A huge untracked file is irrelevant when the recorded commit is shallow.
  const untracked = path.join(repository, `${"untracked-".repeat(17)}.txt`);
  fs.writeFileSync(untracked, "not in HEAD\n");
  await createWorktree(plan);
  assert.equal(fs.existsSync(path.join(plan.path, path.basename(untracked))), false);
});

test("Windows preflight rejects a 248-character gitlink directory before creating its branch or target", { skip: process.platform !== "win32" }, async (t) => {
  const { repository, root } = fixture(t);
  const plan = worktreePlan(repository, {}, "main", { root, workspaceId, source });
  const gitlink = "s".repeat(248 - plan.path.length - 1);
  const tree = command(repository, ["mktree", "-z"], `160000 commit ${plan.base_commit}\t${gitlink}\0`);
  const commit = command(repository, ["commit-tree", tree, "-m", "long submodule directory"]);
  assert.equal(path.join(plan.path, gitlink).length, 248);
  await assert.rejects(createWorktree({ ...plan, base_commit: commit }), (error) => {
    assert.ok(error.message.includes(`目录「${gitlink}」`));
    assert.match(error.message, /248 个字符.*247 个字符限制/);
    return true;
  });
  assert.equal(fs.existsSync(root), false);
  assert.throws(() => command(repository, ["rev-parse", "--verify", plan.branch]));
  const shortTree = command(repository, ["mktree", "-z"], `160000 commit ${plan.base_commit}\t${gitlink.slice(1)}\0`);
  const shortCommit = command(repository, ["commit-tree", shortTree, "-m", "submodule at directory limit"]);
  await createWorktree({ ...plan, base_commit: shortCommit });
  assert.equal(fs.statSync(path.join(plan.path, gitlink.slice(1))).isDirectory(), true);
});

test("Windows preflight preserves tabs, newlines and a UTF-8 character split across NUL-list chunks", { skip: process.platform !== "win32" }, async (t) => {
  const { repository, root } = fixture(t);
  const plan = worktreePlan(repository, {}, "main", { root, workspaceId, source });
  const blob = command(repository, ["rev-parse", "HEAD:file.txt"]);
  const prefix = `100644 blob ${blob}\t`;
  const fillerLength = Buffer.byteLength(`${prefix}a00000-${"x".repeat(80)}\0`);
  const count = Math.floor((65535 - prefix.length - 1) / fillerLength);
  const fillers = Array.from({ length: count }, (_, index) => `a${String(index).padStart(5, "0")}-${"x".repeat(80)}`);
  const leading = `z${"x".repeat(65535 - count * fillerLength - prefix.length - 1)}`;
  const nameStart = `${leading}界\tline\n`;
  const name = nameStart + "y".repeat(260 - plan.path.length - 1 - nameStart.length);
  const records = [...fillers, name].map((entry) => `${prefix}${entry}\0`).join("");
  assert.equal(Buffer.from(records).indexOf(Buffer.from("界")), 65535);
  const tree = command(repository, ["mktree", "-z"], records);
  const commit = command(repository, ["commit-tree", tree, "-m", "unusual filename fixture"]);
  await assert.rejects(createWorktree({ ...plan, base_commit: commit }), (error) => {
    assert.ok(error.message.includes(`文件「${name}」`));
    assert.ok(!error.message.includes("\uFFFD"));
    assert.match(error.message, /260 个字符/);
    return true;
  });
  assert.equal(fs.existsSync(root), false);
  assert.throws(() => command(repository, ["rev-parse", "--verify", plan.branch]));
});

test("Windows preflight ignores empty Git trees because checkout does not materialize them", { skip: process.platform !== "win32" }, async (t) => {
  const { repository, root } = fixture(t);
  const plan = worktreePlan(repository, {}, "main", { root, workspaceId, source });
  const name = "e".repeat(248 - plan.path.length - 1);
  const emptyTree = command(repository, ["mktree"], "");
  const tree = command(repository, ["mktree", "-z"], `040000 tree ${emptyTree}\t${name}\0`);
  const commit = command(repository, ["commit-tree", tree, "-m", "empty tree fixture"]);
  await createWorktree({ ...plan, base_commit: commit });
  assert.equal(command(plan.path, ["rev-parse", "HEAD"]), commit);
  assert.equal(fs.existsSync(path.join(plan.path, name)), false);
});

test("checkout leaves HTTP responsive while retaining the repository lock and fixed baseline", { timeout: 40000 }, async (t) => {
  const context = fixture(t);
  const { repository, root } = context;
  const { ready, release } = checkoutHook(context);
  const plan = worktreePlan(repository, {}, "main", { root, workspaceId, source });
  fs.writeFileSync(path.join(repository, "file.txt"), "uncommitted root changes");
  const common = path.join(repository, ".git");
  const server = createServer((_request, response) => response.end("responsive"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let settled = false;
  const pending = withRepositoryOperation(common, () => createWorktree(plan));
  pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await hookPid(ready);
    assert.equal(settled, false, "checkout must still be waiting on its hook");
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(await response.text(), "responsive");
    assert.equal(settled, false);
    await assert.rejects(withRepositoryOperation(common, () => assert.fail("lock bypass")), /已有 Git 操作/);
    fs.writeFileSync(release, "continue");
    assert.deepEqual(await pending, plan);
    assert.equal(command(plan.path, ["rev-parse", "HEAD"]), plan.base_commit);
    assert.equal(fs.readFileSync(path.join(plan.path, "file.txt"), "utf8"), "fixture\n");
    assert.equal(fs.readFileSync(path.join(repository, "file.txt"), "utf8"), "uncommitted root changes");
    assert.equal(fs.existsSync(path.join(common, "web-coding-operation.lock")), false);
  } finally {
    fs.writeFileSync(release, "cleanup");
    await pending.catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
});

for (const mode of ["cancel", "timeout", "failure"]) {
  test(`checkout ${mode} closes Git before unlocking and preserves the existing worktree`, { timeout: 40000 }, async (t) => {
    const context = fixture(t);
    const { repository, root } = context;
    const { ready, release } = checkoutHook(context, mode === "failure" ? 12 : 0);
    const plan = worktreePlan(repository, {}, "main", { root, workspaceId, source });
    const common = path.join(repository, ".git");
    const controller = new AbortController();
    const pending = withRepositoryOperation(common, () => createWorktree(plan, {
      signal: controller.signal, timeout: mode === "timeout" ? 3000 : 60000,
    }));
    const rejected = assert.rejects(pending, mode === "cancel" ? /已停止/ : mode === "timeout" ? /超时/ : /Git 操作失败/);
    try {
      const pid = await hookPid(ready);
      assert.equal(fs.existsSync(path.join(common, "web-coding-operation.lock")), true);
      if (mode === "cancel") controller.abort();
      if (mode === "failure") fs.writeFileSync(release, "fail");
      await rejected;
      // On POSIX a terminated descendant may briefly remain a zombie; Windows
      // taskkill has finished before the promise settles.
      if (process.platform === "win32") assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.equal(fs.existsSync(path.join(common, "web-coding-operation.lock")), false);
      assert.equal(command(repository, ["rev-parse", plan.branch]), plan.base_commit);
      assert.equal(fs.readFileSync(path.join(plan.path, "file.txt"), "utf8"), "fixture\n");
      await assert.rejects(createWorktree(plan), /already exists/);
    } finally {
      fs.writeFileSync(release, "cleanup");
      controller.abort();
      await pending.catch(() => {});
      await rejected;
    }
  });
}

test("cancelled or unauthorized preparation cannot create a branch or directory", async (t) => {
  const { repository, root } = fixture(t);
  const plan = worktreePlan(repository, {}, "main", { root, workspaceId, source });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createWorktree(plan, { signal: controller.signal }), /已停止/);
  await assert.rejects(createWorktree(plan, { authorize: async () => { throw new Error("revoked"); } }), /revoked/);
  assert.equal(fs.existsSync(root), false);
  assert.throws(() => command(repository, ["rev-parse", "--verify", plan.branch]));
});
