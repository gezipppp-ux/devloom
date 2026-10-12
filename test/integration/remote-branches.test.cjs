const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { temporary } = require("../support/helpers.cjs");
const { git } = require("../../src/git/command.cjs");
const { listRemoteBranches, parseRemoteBranches } = require("../../src/git/remote-branches.cjs");

function fixture(t) {
  const root = temporary(t), remote = path.join(root, "remote.git"), repository = path.join(root, "clone");
  git(root, ["init", "--bare", remote]);
  git(root, ["init", "-b", "main", repository]);
  git(repository, ["remote", "add", "origin", remote]);
  return { root, remote, repository };
}

test("remote branch choices reflect additions and deletions without relying on cached refs", async t => {
  const { repository, remote } = fixture(t);
  assert.deepEqual((await listRemoteBranches(repository)).branches, []);
  git(repository, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "fixture"]);
  const commit = git(repository, ["rev-parse", "HEAD"]);
  git(repository, ["push", "origin", "main:main", "main:release/1.0"]);
  const first = await listRemoteBranches(repository);
  assert.deepEqual(first.branches, [{ name: "main", commit }, { name: "release/1.0", commit }]);
  assert.ok(Number.isFinite(Date.parse(first.fetchedAt)));
  git(remote, ["update-ref", "refs/heads/new-feature", commit]);
  git(remote, ["update-ref", "-d", "refs/heads/release/1.0"]);
  assert.deepEqual((await listRemoteBranches(repository)).branches.map(branch => branch.name), ["main", "new-feature"]);
  assert.equal(git(repository, ["rev-parse", "refs/remotes/origin/release/1.0"]), commit, "stale tracking ref remains but is excluded");
});

test("unreachable or changed remotes fail without returning cached branch choices", async t => {
  const { root, repository } = fixture(t);
  await assert.rejects(listRemoteBranches(repository, { remoteUrl: "https://example.test/private.git", account: {} }), /远端地址已变更/);
  git(repository, ["remote", "set-url", "origin", path.join(root, "missing.git")]);
  await assert.rejects(listRemoteBranches(repository), /读取远端分支失败/);
  git(repository, ["remote", "remove", "origin"]);
  await assert.rejects(listRemoteBranches(repository), /未配置 origin/);
});

test("remote branch parsing rejects malformed Git results", () => {
  for (const value of ["invalid", "a".repeat(40) + "\trefs/tags/v1", "a".repeat(40) + "\trefs/heads/"])
    assert.throws(() => parseRemoteBranches(value), /无效/);
});
