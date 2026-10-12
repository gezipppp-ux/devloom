const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveAccountRemote } = require("../../src/domain/git-account.cjs");

const ssh = { authType: "ssh", host: "gitee.com" };
const http = { authType: "http", host: "https://gitee.com" };

test("matching Git transports retain the exact repository address", () => {
  for (const [account, remote] of [
    [ssh, "git@gitee.com:team/repo.git"],
    [http, "https://gitee.com/team/repo.git"],
    [{ authType: "ssh", host: "git.example:2222" }, "ssh://alice@git.example:2222/group/team/repo.git"],
    [{ authType: "http", host: "https://git.example:8443" }, "https://git.example:8443/group/team/repo.git"],
  ]) assert.equal(resolveAccountRemote(account, remote), remote);
});

test("official Gitee HTTPS repositories resolve to the selected SSH account without changing repository identity", () => {
  for (const repository of ["team/repo.git", "team/repo", "another-owner/repo.git", "____gezi/web-coding.git"])
    assert.equal(resolveAccountRemote(ssh, `https://gitee.com/${repository}`), `git@gitee.com:${repository}`);
  assert.equal(resolveAccountRemote(ssh, "https://gitee.com:443/team/repo.git"), "git@gitee.com:team/repo.git");
});

test("official Gitee SSH repositories resolve to the selected HTTPS account", () => {
  for (const remote of ["git@gitee.com:team/repo.git", "ssh://git@gitee.com/team/repo.git", "ssh://git@gitee.com:22/team/repo.git"])
    assert.equal(resolveAccountRemote(http, remote), "https://gitee.com/team/repo.git");
  assert.equal(resolveAccountRemote(http, "git@gitee.com:other/repo"), "https://gitee.com/other/repo");
});

test("transport conversion does not guess hosts, ports, SSH users or repository layouts", () => {
  for (const [account, remote] of [
    [ssh, "https://other.example/team/repo.git"],
    [{ authType: "ssh", host: "other.example" }, "https://gitee.com/team/repo.git"],
    [ssh, "https://gitee.com:8443/team/repo.git"],
    [{ authType: "ssh", host: "gitee.com:2222" }, "https://gitee.com/team/repo.git"],
    [ssh, "http://gitee.com/team/repo.git"],
    [ssh, "https://gitee.com/repo.git"],
    [ssh, "https://gitee.com/group/team/repo.git"],
    [http, "ssh://git@gitee.com:2222/team/repo.git"],
    [http, "ssh://alice@gitee.com/team/repo.git"],
    [http, "alice@gitee.com:team/repo.git"],
    [http, "git@other.example:team/repo.git"],
    [http, "git@gitee.com:group/team/repo.git"],
    [{ authType: "http", host: "http://gitee.com" }, "git@gitee.com:team/repo.git"],
    [{ authType: "http", host: "https://gitee.com:8443" }, "git@gitee.com:team/repo.git"],
    [{ authType: "http", host: "https://other.example" }, "git@gitee.com:team/repo.git"],
  ]) assert.throws(() => resolveAccountRemote(account, remote), { code: "GIT_ACCOUNT_REMOTE_MISMATCH" }, `${account.host}: ${remote}`);
});

test("account transport resolution still rejects secret-bearing and invalid repository URLs", () => {
  for (const remote of ["https://user:secret@gitee.com/team/repo.git", "https://gitee.com/team/repo.git?token=secret", "https://gitee.com/team/repo.git#fragment", "file:///team/repo.git"])
    assert.throws(() => resolveAccountRemote(ssh, remote), /地址/);
});
