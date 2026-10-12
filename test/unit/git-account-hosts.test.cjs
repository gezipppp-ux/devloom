const assert = require("node:assert/strict");
const { test } = require("node:test");
const { gitHost, remoteHost, validateGitAccount } = require("../../src/domain/git-account.cjs");

test("Git accounts target normalized hosts while repository addresses stay separate", () => {
  assert.equal(gitHost("HTTPS://GIT.EXAMPLE.TEST:8443/", "http"), "https://git.example.test:8443");
  assert.equal(gitHost("git.example.test:22", "ssh"), "git.example.test");
  assert.equal(remoteHost("ssh://git@git.example.test:2222/team/repo.git"), "git.example.test:2222");
  assert.equal(remoteHost("git@git.example.test:team/repo.git"), "git.example.test");
  for (const host of ["https://user:secret@git.test", "https://git.test/team/repo", "https://git.test?token=x", "https://git.test#x"])
    assert.throws(() => gitHost(host, "http"), /主机/);
  for (const host of ["git@git.test", "ssh://git.test", "git.test/team", "git.test:abc"])
    assert.throws(() => gitHost(host, "ssh"), /主机/);
});

test("commit authors require a complete independent identity and updates accept only positive revisions", () => {
  const input = { name: "personal", authType: "http", host: "https://git.example.test", username: "login-name", password: "fixture-token" };
  const without = validateGitAccount(input);
  assert.equal(without.authorName, "");
  assert.equal(without.authorEmail, "");
  const authored = validateGitAccount({ ...input, authorName: "Commit Author", authorEmail: "author@example.test", revision: 2 });
  assert.equal(authored.authorName, "Commit Author");
  assert.equal(authored.username, "login-name");
  assert.equal(authored.revision, 2);
  for (const patch of [{ authorName: "Author" }, { authorEmail: "author@example.test" }, { authorName: "Author", authorEmail: "bad" }])
    assert.throws(() => validateGitAccount({ ...input, ...patch }), /作者/);
  for (const revision of [0, -1, 1.5, "2"])
    assert.throws(() => validateGitAccount({ ...input, revision }), /修订号/);
  assert.throws(() => validateGitAccount({ ...input, remoteUrl: "https://git.example.test/repo.git" }), /未知字段/);
});
