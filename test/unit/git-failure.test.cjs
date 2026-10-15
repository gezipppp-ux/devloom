const assert = require("node:assert/strict");
const { test } = require("node:test");
const { gitFailureMessage } = require("../../src/git/git-failure.cjs");

test("Git failures distinguish transport, repository authorization and authentication without exposing diagnostics", () => {
  const cases = [
    ["fatal: Could not resolve proxy: private-proxy", /无法解析/],
    ["fatal: Failed to connect to private-host port 443", /无法连接/],
    ["fatal: SSL certificate problem: self-signed certificate", /证书/],
    ["remote: The organization has enabled SAML SSO", /单点登录/],
    ["fatal: Authentication failed for https://user:secret@private-host/repo", /认证被拒绝/],
    ["git@private-host: Permission denied (publickey).", /认证被拒绝/],
    ["fatal: unable to get password from user", /认证被拒绝/],
    ["remote: Repository not found.", /不存在或当前账号无权访问/],
    ["fatal: The requested URL returned error: 403", /仓库拒绝访问/],
    ["fatal: The requested URL returned error: 404", /不存在或当前账号无权访问/],
    ["fatal: unable to update url base from redirection", /重定向/],
    ["remote: unexpected secret token=fixture-secret", /请检查远程仓库地址/, /请检查网络/],
  ];
  for (const [diagnostic, expected, cloneExpected = expected] of cases) {
    for (const operation of ["connection", "clone"]) {
      const message = gitFailureMessage({}, diagnostic, operation);
      assert.match(message, operation === "clone" ? /^Git 克隆失败/ : /^Git 连接失败/);
      assert.match(message, operation === "clone" ? cloneExpected : expected);
      assert.doesNotMatch(message, /private-host|private-proxy|secret|token=|https:\/\//);
    }
  }
  assert.match(gitFailureMessage({ killed: true }, "secret"), /超时/);
  assert.match(gitFailureMessage({ code: "ENOENT" }, "secret"), /无法启动 Git/);
});
