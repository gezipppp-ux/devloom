const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { testGitConnection, cloneGitRepository } = require("../../src/git/account-credentials.cjs");

test("real Git repository checks and clone failures retain safe HTTP error categories", async t => {
  let status = 401;
  const server = http.createServer((request, response) => {
    response.writeHead(status, { "Content-Type": "text/plain", "WWW-Authenticate": "Basic realm=fixture" });
    response.end("private diagnostic fixture-secret");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "web-coding-git-failure-"));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const remote = `http://127.0.0.1:${server.address().port}/private-repo.git`;
  const account = { authType: "http", username: "fixture", password: "fixture-secret" };
  for (const [code, expected] of [[401, /认证被拒绝/], [403, /仓库拒绝访问/], [404, /不存在或当前账号无权访问/]]) {
    status = code;
    for (const operation of [() => testGitConnection(account, remote), () => cloneGitRepository(account, remote, path.join(directory, `repository-${code}`))]) {
      await assert.rejects(operation, error => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /fixture-secret|private-repo|127\.0\.0\.1|private diagnostic/);
        return true;
      });
    }
  }
});
