const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { departmentInput, projectInput, memberInput, prepareSpaceInput } = require("../../src/domain/project-input.cjs");
const { validateGitAccount, remoteHost } = require("../../src/domain/git-account.cjs");

test("project input excludes hierarchy, filesystem paths, identity injection and stale writes", () => {
  assert.throws(() => departmentInput({ name: "team", permissions: [], parentId: randomUUID() }), /未知/);
  assert.throws(() => projectInput({ name: "project", remoteUrl: "https://git.example/project.git", path: "C:/elsewhere" }), /未知/);
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


test("project owns its validated remote URL and rejects the former catalog reference", () => {
  const input = { name: "project", remoteUrl: " https://git.example/team/project.git " };
  assert.equal(projectInput(input).remoteUrl, "https://git.example/team/project.git");
  assert.equal(projectInput({ remoteUrl: "git@git.example:team/project.git", revision: 1 }, true).remoteUrl, "git@git.example:team/project.git");
  assert.throws(() => projectInput({ ...input, remoteUrl: undefined }), /远程地址/);
  assert.throws(() => projectInput({ ...input, remoteUrl: "https://user:secret@git.example/project.git" }), /凭据/);
  assert.throws(() => projectInput({ ...input, repositoryId: randomUUID() }), /未知/);
  assert.throws(() => projectInput({ ...input, departmentId: randomUUID() }), /未知/);
  assert.throws(() => projectInput({ departmentId: randomUUID(), revision: 1 }, true), /未知/);
});

test("project presenter exposes its remote URL and locks it when a space is assigned", () => {
  const { presentProject } = require("../../src/application/project-presenter.cjs");
  const project = { id: randomUUID(), remoteUrl: "https://git.example/project.git", _count: { spaces: 0 } };
  const editable = presentProject(project);
  assert.equal(editable.remoteUrl, project.remoteUrl);
  assert.equal(Object.hasOwn(editable, "departmentId"), false);
  assert.equal(Object.hasOwn(editable, "department"), false);
  assert.equal(editable.repositoryEditable, true);
  assert.equal(Object.hasOwn(editable, "repository"), false);
  assert.equal(Object.hasOwn(editable, "repositoryId"), false);
  assert.equal(presentProject({ ...project, _count: { spaces: 1 } }).repositoryEditable, false);
});
