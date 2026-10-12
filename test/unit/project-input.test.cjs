const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { departmentInput, projectInput, memberInput, prepareSpaceInput } = require("../../src/domain/project-input.cjs");
const { validateGitAccount, remoteHost } = require("../../src/domain/git-account.cjs");

test("project input excludes hierarchy, filesystem paths, identity injection and stale writes", () => {
  assert.throws(() => departmentInput({ name: "team", permissions: [], parentId: randomUUID() }), /未知/);
  assert.throws(() => projectInput({ name: "project", departmentId: randomUUID(), repositoryId: randomUUID(), path: "C:/elsewhere" }), /未知/);
  assert.throws(() => projectInput({ name: "update" }, true), /修订号/);
  assert.throws(() => memberInput({ userId: randomUUID(), permissions: ["session.start"] }), /需要/);
  assert.throws(() => prepareSpaceInput({ gitAccountId: randomUUID(), requestId: randomUUID(), userId: randomUUID() }), /未知/);
});

test("personal Git host is independent from repositories and commit author is explicit", () => {
  const value = validateGitAccount({ name: "git", authType: "http", host: "https://git.example:8443/", username: "login", password: "token", authorName: "Author", authorEmail: "author@example.com" });
  assert.equal(value.host, "https://git.example:8443");
  assert.equal(value.remoteUrl, "");
  assert.equal(remoteHost("git@git.example:team/repo.git"), "git.example");
  assert.equal(remoteHost("ssh://git@git.example:2222/team/repo.git"), "git.example:2222");
  assert.throws(() => validateGitAccount({ ...value, remoteUrl: "https://git.example/a.git" }), /未知/);
  assert.throws(() => validateGitAccount({ name: "git", authType: "http", host: "https://git.example/repo", username: "login" }), /主机/);
  assert.throws(() => validateGitAccount({ name: "git", authType: "ssh", host: "git.example", authorName: "name" }), /同时/);
});
