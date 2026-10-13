const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { verifyGitHostLogin } = require("../../src/git/host-login.cjs");

const http = { authType: "http", host: "https://github.com", username: "developer", password: "fixture-secret" };

test("HTTP host login authenticates the current user without a project, redirects or credentials in URLs", async () => {
  for (const [host, provider, endpoint, field] of [
    ["https://github.com", "auto", "https://api.github.com/user", "login"],
    ["https://gitee.com", "auto", "https://gitee.com/api/v5/user", "login"],
    ["https://gitlab.com", "auto", "https://gitlab.com/api/v4/user", "username"],
    ["https://company.example", "gitlab", "https://company.example/api/v4/user", "username"],
    ["https://company.example", "github", "https://company.example/api/v3/user", "login"],
  ]) {
    await verifyGitHostLogin({ ...http, host }, provider, { request: async (url, options) => {
      assert.equal(url, endpoint);
      assert.doesNotMatch(url, /fixture-secret|developer/);
      assert.equal(options.redirect, "manual");
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(Object.values(options.headers).some(value => value.includes(http.password)));
      return { ok: true, json: async () => ({ id: 1, [field]: "Developer" }) };
    } });
  }
  await assert.rejects(verifyGitHostLogin({ ...http, host: "https://unknown.example" }, "auto", {
    request: () => assert.fail("unsupported hosts must not receive credentials"),
  }), /选择 Git 服务/);
});

test("HTTP login rejects anonymous pages, wrong identities, denied tokens, redirects and network diagnostics", async () => {
  for (const response of [
    { status: 401, ok: false }, { status: 403, ok: false }, { status: 302, ok: false }, { status: 500, ok: false },
    { ok: true, json: async () => ({ id: 1, login: "someone-else" }) },
    { ok: true, json: async () => ({ login: http.username }) },
    { ok: true, json: async () => { throw new Error("fixture-secret HTML login form"); } },
  ]) await assert.rejects(verifyGitHostLogin(http, "auto", { request: async () => response }), error => {
    assert.doesNotMatch(error.message, /fixture-secret|someone-else|HTML/);
    return true;
  });
  await assert.rejects(verifyGitHostLogin(http, "auto", { request: async () => { throw new Error("Git fixture-secret transport detail"); } }), error => {
    assert.doesNotMatch(error.message, /fixture-secret|transport detail/);
    return true;
  });
});

test("SSH login uses isolated keys and genuine OpenSSH authentication events, including shell-disabled hosts", async () => {
  for (const log of ['Authenticated to git.example ([127.0.0.1]:2222) using "publickey".\n', "debug1: Authentication succeeded (publickey).\n"]) {
    let key, config, diagnostic;
    await verifyGitHostLogin({ authType: "ssh", host: "git.example:2222", sshPrivateKey: "fixture-private" }, "auto", {
      execute: async (args, options) => {
        key = args[args.indexOf("-i") + 1]; config = args[args.indexOf("-F") + 1]; diagnostic = args[args.indexOf("-E") + 1];
        assert.equal(fs.readFileSync(key, "utf8"), "fixture-private");
        assert.equal(fs.readFileSync(config, "utf8"), "");
        assert.deepEqual(args.slice(-6), ["-p", "2222", "-l", "git", "--", "git.example"]);
        assert.ok(args.includes("IdentityAgent=none"));
        assert.ok(args.includes("PreferredAuthentications=publickey"));
        assert.equal(options.timeout, 30000);
        assert.equal(options.windowsHide, true);
        fs.writeFileSync(diagnostic, log);
        return { error: { code: 1 } };
      },
    });
    assert.equal(fs.existsSync(path.dirname(key)), false);
    assert.equal(fs.existsSync(config), false);
    assert.equal(fs.existsSync(diagnostic), false);
  }
});

test("SSH login never trusts successful exit codes or server banners, and cleans failed keys", async () => {
  for (const timedOut of [false, true]) {
    let key;
    await assert.rejects(verifyGitHostLogin({ authType: "ssh", host: "git.example", sshPrivateKey: "fixture-private" }, "auto", {
      execute: async args => {
        key = args[args.indexOf("-i") + 1];
        if (timedOut) fs.writeFileSync(args[args.indexOf("-E") + 1], 'Authenticated to git.example using "publickey".\n');
        return { error: timedOut ? { killed: true } : null, stderr: 'Authenticated to git.example using "publickey".\n', stdout: "Welcome developer" };
      },
    }), timedOut ? /超时/ : /SSH 登录验证失败/);
    assert.equal(fs.existsSync(path.dirname(key)), false);
  }
});
