const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { temporary } = require("../support/helpers.cjs");
const { readTaskFile, listTaskFiles } = require("../../src/git/task-files.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");

function command(directory, ...args) {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function commit(tree) {
  command(tree, "add", ".");
  command(tree, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
}
function fixture(t) {
  const directory = temporary(t), repository = path.join(directory, "repo"), tree = path.join(directory, "task");
  fs.mkdirSync(repository);
  command(repository, "init", "-b", "main");
  command(repository, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repository, "seed.ts"), "const value = 1;\n");
  fs.writeFileSync(path.join(repository, "removed.sql"), "SELECT 1;\n");
  fs.writeFileSync(path.join(repository, ".gitignore"), "ignored/\n");
  commit(repository);
  const base = command(repository, "rev-parse", "HEAD");
  command(repository, "worktree", "add", "-b", "codex/fixture", tree, base);
  const state = { worktree: { repository, path: tree, branch: "codex/fixture", base_commit: base } };
  return { directory, repository, tree, state };
}

test("file comparison keeps exact text and compares committed plus dirty content against the recorded base", async (t) => {
  const { state, tree } = fixture(t);
  fs.writeFileSync(path.join(tree, "seed.ts"), "const value = 2;\n\n");
  commit(tree);
  fs.appendFileSync(path.join(tree, "seed.ts"), "export { value };\n");
  const task = await readTaskFile(state, "seed.ts");
  assert.equal(task.before.text, "const value = 1;\n");
  assert.equal(task.current.text, "const value = 2;\n\nexport { value };\n");
  assert.ok(task.hunks.flatMap(h => h.lines).includes("-const value = 1;"));
  const head = await readTaskFile(state, path.join(tree, "seed.ts"), "head");
  assert.equal(head.before.text, "const value = 2;\n\n");
  assert.ok(head.hunks.flatMap(h => h.lines).includes("+export { value };"));
  assert.notEqual(task.base, head.base);
  assert.equal(command(tree, "branch", "--show-current"), "codex/fixture");
  assert.equal(command(state.worktree.repository, "branch", "--show-current"), "main");
});

test("file catalog handles new, deleted, renamed, duplicate, unicode and literal pathspec names", async (t) => {
  const { state, tree } = fixture(t);
  command(tree, "mv", "seed.ts", "renamed.ts");
  fs.unlinkSync(path.join(tree, "removed.sql"));
  fs.mkdirSync(path.join(tree, "one")); fs.mkdirSync(path.join(tree, "two"));
  fs.writeFileSync(path.join(tree, "one", "test.ts"), "one\n");
  fs.writeFileSync(path.join(tree, "two", "test.ts"), "two\n");
  fs.writeFileSync(path.join(tree, "中文 空格 [x].ts"), "new\n");
  const { files } = await listTaskFiles(state);
  assert.deepEqual(files.find(f => f.path === "renamed.ts"), { path: "renamed.ts", previousPath: "seed.ts", status: "R" });
  const renamed = await readTaskFile(state, "renamed.ts");
  assert.equal(renamed.before.text, renamed.current.text);
  assert.equal(renamed.previousPath, "seed.ts");
  const removed = await readTaskFile(state, "removed.sql");
  assert.equal(removed.current.exists, false);
  assert.equal(removed.before.text, "SELECT 1;\n");
  assert.deepEqual((await readTaskFile(state, "test.ts")).candidates, ["one/test.ts", "two/test.ts"]);
  assert.equal((await readTaskFile(state, "one/test.ts")).current.text, "one\n");
  assert.equal((await readTaskFile(state, "中文 空格 [x].ts")).before.exists, false);
  fs.writeFileSync(path.join(tree, "test.ts"), "root\n");
  assert.equal((await readTaskFile(state, "test.ts")).candidates.length, 3);
  assert.equal((await readTaskFile(state, "./test.ts")).current.text, "root\n");
});

test("file preview blocks traversal, ignored files, symlinks and unregistered worktrees", async (t) => {
  const { state, tree, directory, repository } = fixture(t);
  fs.writeFileSync(path.join(directory, "outside.ts"), "secret\n");
  fs.mkdirSync(path.join(tree, "ignored")); fs.writeFileSync(path.join(tree, "ignored", "secret.ts"), "secret\n");
  for (const file of ["../outside.ts", path.join(directory, "outside.ts"), ".git", ".git/config", "ignored/secret.ts", "--help", ":(glob)*", "seed.ts\0"])
    await assert.rejects(readTaskFile(state, file));
  const target = path.join(tree, "linked");
  fs.symlinkSync(directory, target, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(readTaskFile(state, "linked/outside.ts"));
  // Git can track symlinks without OS symlink creation privileges on Windows.
  const oid = command(tree, "hash-object", "-w", "seed.ts");
  command(tree, "update-index", "--add", "--cacheinfo", `100644,${oid},linked/outside.ts`);
  await assert.rejects(readTaskFile(state, "linked/outside.ts"), /链接/);
  command(tree, "update-index", "--force-remove", "linked/outside.ts");
  command(tree, "update-index", "--add", "--cacheinfo", `120000,${oid},link.ts`);
  command(tree, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "link");
  assert.match((await readTaskFile(state, "link.ts", "head")).reason, /普通文本/);
  await assert.rejects(readTaskFile({ worktree: { ...state.worktree, path: repository } }, "seed.ts"));
  command(repository, "worktree", "remove", "--force", tree);
  await assert.rejects(listTaskFiles(state), /移除|验证/);
});

test("CRLF checkout content stays exact while line comparison avoids checkout-only changes", async (t) => {
  const { state, tree } = fixture(t);
  fs.writeFileSync(path.join(tree, "seed.ts"), "const value = 1;\r\n");
  const result = await readTaskFile(state, "seed.ts");
  assert.equal(result.current.text, "const value = 1;\r\n");
  assert.deepEqual(result.hunks, []);
  fs.writeFileSync(path.join(tree, "seed.ts"), "\uFEFFconst value = 1;");
  assert.equal((await readTaskFile(state, "seed.ts")).current.text, "\uFEFFconst value = 1;");
});

test("large, binary and non-UTF8 files show explicit limits; missing baseline never falls back silently", async (t) => {
  const { state, tree } = fixture(t);
  fs.writeFileSync(path.join(tree, "binary.ts"), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(tree, "encoding.ts"), Buffer.from([255, 254, 128]));
  fs.writeFileSync(path.join(tree, "large.ts"), "x".repeat(512 * 1024 + 1));
  fs.writeFileSync(path.join(tree, "lines.ts"), "x\n".repeat(10001));
  for (const [file, reason] of [["binary.ts", /二进制/], ["encoding.ts", /UTF-8/], ["large.ts", /512 KiB/], ["lines.ts", /10000/]]) {
    const result = await readTaskFile(state, file);
    assert.equal(result.current.text, null);
    assert.match(result.reason, reason);
  }
  delete state.worktree.base_commit;
  assert.match((await readTaskFile(state, "seed.ts")).reason, /起始提交/);
  assert.equal((await readTaskFile(state, "seed.ts")).current.text, "const value = 1;\n");
  assert.equal((await readTaskFile(state, "seed.ts", "head")).reason, null);
  await assert.rejects(listTaskFiles(state), /起始提交/);
  await assert.rejects(listTaskFiles(state, "main"), /范围/);
});

test("file HTTP routes expose only presenter fields and never start a Codex turn", async (t) => {
  const { state, directory } = fixture(t);
  const store = new RunStore(path.join(directory, "runs"));
  fs.mkdirSync(store.dir("1-2"), { recursive: true });
  fs.writeFileSync(path.join(store.dir("1-2"), "run.json"), JSON.stringify(state));
  const client = new FakeClient();
  const manager = new SessionManager({ store, client });
  const application = createWebServer({ manager, testIdentity: true });
  const origin = await application.listen(0);
  t.after(() => application.close());
  const response = await fetch(`${origin}/api/runs/1-2/file?path=seed.ts`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.path, "seed.ts");
  assert.equal(result.tree, undefined);
  assert.equal(result.current.text, "const value = 1;\n");
  store.writeWorktreeDeletion("1-2", { status: "deleted", worktreeRemoved: true });
  assert.equal((await fetch(`${origin}/api/runs/1-2/files`)).status, 400);
  assert.equal((await fetch(`${origin}/api/runs/1-3/files`)).status, 404);
  assert.equal(client.calls.length, 0);
});
