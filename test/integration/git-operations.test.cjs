const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { temporary } = require("../support/helpers.cjs");
const { readRepositoryStatus, fetchRepository, updateBaseBranch } = require("../../src/git/repository-operations.cjs");
const { readTaskGit, deleteTaskWorktree } = require("../../src/git/task-operations.cjs");

function command(directory, ...args) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).replace(/\r?\n$/, "");
}

function commit(directory, message = "fixture") {
  command(directory, "add", ".");
  command(directory, "-c", "user.name=Fixture", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", message);
}

function fixture(t, remote = true, options = {}) {
  const directory = temporary(t);
  const repository = path.join(directory, "repo");
  fs.mkdirSync(repository);
  command(repository, "init", "-b", "main");
  fs.writeFileSync(path.join(repository, "file.txt"), "initial\n");
  fs.writeFileSync(path.join(repository, ".gitignore"), "ignored/\n");
  commit(repository);
  if (remote) {
    const bare = path.join(directory, "remote.git");
    fs.mkdirSync(bare);
    command(bare, "init", "--bare", "-b", "main");
    command(repository, "remote", "add", "origin", bare);
    command(repository, "push", "-u", "origin", "main");
  }
  const state = { worktree: {
    repository,
    branch: options.branch || "codex/task-fixture",
    path: path.join(directory, ...(options.treeSegments || ["task tree"])),
  } };
  fs.mkdirSync(path.dirname(state.worktree.path), { recursive: true });
  command(repository, "worktree", "add", "-b", state.worktree.branch, state.worktree.path, "HEAD");
  return { directory, repository, state };
}

function confirmation(state, snapshot = readTaskGit(state)) {
  return { expectedHead: snapshot.head, statusToken: snapshot.statusToken, confirmBranch: snapshot.branch, discardChanges: true };
}

test("fetch refreshes local refs and ff-only update changes only the current clean base branch", async (t) => {
  const { directory, repository, state } = fixture(t);
  const upstream = path.join(directory, "peer");
  command(directory, "clone", path.join(directory, "remote.git"), upstream);
  fs.writeFileSync(path.join(upstream, "remote.txt"), "new\n");
  commit(upstream, "upstream");
  command(upstream, "push", "origin", "main");
  const previousHead = command(repository, "rev-parse", "HEAD");
  const status = readRepositoryStatus(repository, "main");
  assert.equal(status.canUpdate, true);
  assert.equal(status.upstream, "origin/main");
  assert.deepEqual(status.remotes, [{ name: "origin" }]);
  await fetchRepository(repository, "origin");
  assert.equal(command(repository, "rev-parse", "HEAD"), previousHead);
  const updated = await updateBaseBranch(repository, "refs/heads/main", "origin");
  assert.notEqual(updated.head, previousHead);
  assert.equal(command(state.worktree.path, "rev-parse", "HEAD"), previousHead);
  assert.equal(command(repository, "branch", "--show-current"), "main");
  assert.equal(fs.readFileSync(path.join(repository, "remote.txt"), "utf8").trim(), "new");
});

test("repository update refuses dirty, detached, noncurrent, untracked-upstream and diverged branches", async (t) => {
  const { directory, repository, state } = fixture(t);
  assert.equal(readRepositoryStatus(repository, "origin/main").canUpdate, false);
  assert.equal(readRepositoryStatus(repository, state.worktree.branch).canUpdate, false);
  fs.writeFileSync(path.join(repository, "file.txt"), "dirty\n");
  await assert.rejects(updateBaseBranch(repository, "main"), /未提交/);
  command(repository, "checkout", "--", "file.txt");
  command(repository, "branch", "--unset-upstream");
  assert.equal(readRepositoryStatus(repository, "main").canUpdate, false);
  command(repository, "branch", "--set-upstream-to=origin/main");
  const upstream = path.join(directory, "peer");
  command(directory, "clone", path.join(directory, "remote.git"), upstream);
  fs.writeFileSync(path.join(upstream, "upstream.txt"), "remote\n");
  commit(upstream);
  command(upstream, "push");
  fs.writeFileSync(path.join(repository, "local.txt"), "local\n");
  commit(repository);
  const head = command(repository, "rev-parse", "HEAD");
  await assert.rejects(updateBaseBranch(repository, "main"), /无法快进/);
  assert.equal(command(repository, "rev-parse", "HEAD"), head);
  assert.equal(fs.existsSync(path.join(repository, ".git", "MERGE_HEAD")), false);
  command(repository, "checkout", "--detach");
  assert.equal(readRepositoryStatus(repository, "HEAD").canUpdate, false);
});

test("fetch accepts only configured remote names and never exposes their credential URL", async (t) => {
  const { repository } = fixture(t, false);
  await assert.rejects(fetchRepository(repository, "https://arbitrary.invalid/repo"), /已配置/);
  await assert.rejects(fetchRepository(repository, "--upload-pack=bad"), /已配置/);
  command(repository, "remote", "add", "broken", path.join(repository, "absent-secret"));
  await assert.rejects(fetchRepository(repository, "broken"), (error) => /获取远端更新失败/.test(error.message) && !/absent-secret/.test(error.message));
});

test("task Git distinguishes unpublished branches, upstream ahead/behind and tracked/untracked/ignored entries", async (t) => {
  const { repository, state } = fixture(t);
  const tree = state.worktree.path;
  const unpublished = readTaskGit(state);
  assert.equal(unpublished.unpublished, true);
  assert.equal(unpublished.ahead, null);
  assert.equal(unpublished.behind, null);
  command(tree, "push", "-u", "origin", state.worktree.branch);
  fs.writeFileSync(path.join(tree, "commit.txt"), "committed\n");
  commit(tree);
  fs.writeFileSync(path.join(tree, "file.txt"), "changed\n");
  fs.writeFileSync(path.join(tree, "untracked.txt"), "untracked\n");
  fs.mkdirSync(path.join(tree, "ignored"));
  fs.writeFileSync(path.join(tree, "ignored", "cache.txt"), "cache\n");
  fs.writeFileSync(path.join(repository, "upstream-only.txt"), "upstream\n");
  commit(repository);
  command(repository, "update-ref", `refs/remotes/origin/${state.worktree.branch}`, "HEAD");
  const snapshot = readTaskGit(state);
  assert.equal(snapshot.unpublished, false);
  assert.equal(snapshot.ahead, 1);
  assert.equal(snapshot.behind, 1);
  assert.equal(snapshot.changedFiles, 1);
  assert.equal(snapshot.untrackedFiles, 1);
  assert.equal(snapshot.ignoredFiles, 1);
  assert.equal(snapshot.clean, false);
  assert.equal(snapshot.canDelete, true);
  await assert.rejects(deleteTaskWorktree(state, { ...confirmation(state, snapshot), discardChanges: false }), /确认丢弃/);
  fs.writeFileSync(path.join(tree, "untracked.txt"), "newer untracked content\n");
  await assert.rejects(deleteTaskWorktree(state, confirmation(state, snapshot)), /状态已变化/);
  assert.equal(fs.existsSync(tree), true);
  command(repository, "update-ref", "-d", `refs/remotes/origin/${state.worktree.branch}`);
  const unknown = readTaskGit(state);
  assert.equal(unknown.ahead, null);
  assert.equal(unknown.upstreamMissing, true);
  assert.equal(unknown.canDelete, true);
});

test("a removed remote upstream allows cleanup only after confirming unknown push risk", async (t) => {
  const { repository, state } = fixture(t);
  command(state.worktree.path, "push", "-u", "origin", state.worktree.branch);
  command(repository, "push", "origin", "--delete", state.worktree.branch);
  const status = readTaskGit(state);
  assert.equal(status.upstream, `origin/${state.worktree.branch}`);
  assert.equal(status.unpublished, false);
  assert.equal(status.upstreamMissing, true);
  assert.equal(status.ahead, null);
  assert.equal(status.behind, null);
  assert.equal(status.clean, true);
  assert.equal(status.canDelete, true);
  assert.match(status.warning, /远端上游已不存在/);
  await assert.rejects(deleteTaskWorktree(state, {
    ...confirmation(state, status), discardChanges: false,
  }), /确认丢弃/);
  assert.equal(fs.existsSync(state.worktree.path), true);
  const result = await deleteTaskWorktree(state, confirmation(state, status));
  assert.equal(result.deleted, true);
  assert.equal(fs.existsSync(state.worktree.path), false);
  assert.throws(() => command(repository, "show-ref", "--verify", `refs/heads/${state.worktree.branch}`));
});

test("a locally tracked branch is unpublished and never reports remote push counts", async (t) => {
  const { state } = fixture(t);
  command(state.worktree.path, "branch", "--set-upstream-to=main");
  fs.writeFileSync(path.join(state.worktree.path, "local-commit.txt"), "local only\n");
  commit(state.worktree.path);
  const status = readTaskGit(state);
  assert.equal(status.upstream, null);
  assert.equal(status.unpublished, true);
  assert.equal(status.ahead, null);
  assert.equal(status.behind, null);
  assert.equal(status.canDelete, true);
  await assert.rejects(deleteTaskWorktree(state, {
    ...confirmation(state, status), discardChanges: false,
  }), /确认丢弃/);
});

test("deep worktree paths with long task upstream refs do not become filesystem path arguments", (t) => {
  const workspace = "231513d3-d551-413f-80ce-baddb1f147e7";
  const name = "manual-ke-shan-chu-de-git-ce-shi-ren-wu-c852ef01d465";
  const { state } = fixture(t, true, {
    branch: `codex/${workspace}/${name}`,
    treeSegments: ["trees", "git-browser", "24837281f9277305", workspace, name],
  });
  command(state.worktree.path, "push", "-u", "origin", state.worktree.branch);
  fs.writeFileSync(path.join(state.worktree.path, "task-change.txt"), "unpushed task commit\n");
  commit(state.worktree.path);
  const status = readTaskGit(state);
  assert.equal(status.ahead, 1, JSON.stringify(status));
  assert.equal(status.behind, 0);
  assert.equal(status.canDelete, true);
});

test("confirmed task deletion removes only its registered directory and local branch, keeping the remote branch", async (t) => {
  const { repository, state } = fixture(t);
  const tree = state.worktree.path;
  fs.writeFileSync(path.join(tree, "commit.txt"), "unique\n");
  commit(tree);
  command(tree, "push", "-u", "origin", state.worktree.branch);
  fs.writeFileSync(path.join(tree, "local-only.txt"), "discard\n");
  const progress = [];
  const result = await deleteTaskWorktree(state, confirmation(state), {}, async (value) => progress.push(value));
  assert.equal(result.deleted, true);
  assert.equal(fs.existsSync(tree), false);
  assert.equal(progress.length, 2);
  assert.equal(progress[0].worktreeRemoved, true);
  assert.equal(progress[0].branchDeleted, false);
  assert.throws(() => command(repository, "show-ref", "--verify", `refs/heads/${state.worktree.branch}`));
  assert.ok(command(repository, "show-ref", "--verify", `refs/remotes/origin/${state.worktree.branch}`));
  assert.equal(fs.readFileSync(path.join(repository, "file.txt"), "utf8"), "initial\n");
});

test("deletion refuses locks, operation markers, incorrect branch confirmations and replaced directory identity", async (t) => {
  const { repository, state } = fixture(t);
  await assert.rejects(deleteTaskWorktree(state, { ...confirmation(state), confirmBranch: "main" }), /完整/);
  command(repository, "worktree", "lock", state.worktree.path);
  assert.equal(readTaskGit(state).canDelete, false);
  assert.match(readTaskGit(state).deleteReason, /锁定/);
  command(repository, "worktree", "unlock", state.worktree.path);
  const gitDirectory = command(state.worktree.path, "rev-parse", "--path-format=absolute", "--git-dir");
  fs.writeFileSync(path.join(gitDirectory, "MERGE_HEAD"), command(repository, "rev-parse", "HEAD"));
  assert.match(readTaskGit(state).deleteReason, /正在合并/);
  fs.unlinkSync(path.join(gitDirectory, "MERGE_HEAD"));
  assert.equal(readTaskGit({ worktree: { ...state.worktree, path: repository } }).canDelete, false);
  const marker = path.join(state.worktree.path, ".git");
  const original = fs.readFileSync(marker, "utf8");
  fs.unlinkSync(marker);
  fs.writeFileSync(marker, `gitdir: ${path.join(repository, ".git")}\n`);
  assert.equal(readTaskGit(state).canDelete, false);
  assert.equal(readTaskGit(state).ahead, null);
  fs.writeFileSync(marker, original);
  assert.equal(readTaskGit(state).canDelete, true);
});

test("partial removal can retry branch cleanup but refuses reused paths and changed branch tips", async (t) => {
  const { repository, state } = fixture(t);
  let progress;
  await assert.rejects(deleteTaskWorktree(state, confirmation(state), {}, async (value) => {
    progress = value;
    throw new Error("simulate persistence failure after worktree remove");
  }), (error) => error.partial?.worktreeRemoved === true);
  assert.equal(fs.existsSync(state.worktree.path), false);
  let snapshot = readTaskGit(state, progress);
  assert.equal(snapshot.canDelete, true);
  assert.equal(readTaskGit(state, { ...progress, status: "deleting", worktreeRemoved: false }).canDelete, true);
  assert.equal(readTaskGit(state).canDelete, false);
  fs.mkdirSync(state.worktree.path);
  assert.equal(readTaskGit(state, progress).canDelete, false);
  fs.rmdirSync(state.worktree.path);
  fs.writeFileSync(path.join(repository, "new.txt"), "different tip\n");
  commit(repository);
  command(repository, "branch", "-f", state.worktree.branch, "HEAD");
  assert.match(readTaskGit(state, progress).deleteReason, /新的提交/);
  command(repository, "branch", "-f", state.worktree.branch, progress.head);
  snapshot = readTaskGit(state, progress);
  const result = await deleteTaskWorktree(state, confirmation(state, snapshot), progress);
  assert.equal(result.deleted, true);
  assert.equal(readTaskGit(state, result).deleted, true);
  assert.equal((await deleteTaskWorktree(state, {}, result)).deleted, true);
});
