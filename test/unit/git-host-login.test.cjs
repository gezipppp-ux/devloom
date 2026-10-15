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
    ["http://git.example:3000", "gitea", "http://git.example:3000/api/v1/user", "login"],
  ]) {
    await verifyGitHostLogin({ ...http, host }, provider, { request: async (url, options) => {
      assert.equal(url, endpoint);
      assert.doesNotMatch(url, /fixture-secret|developer/);
      assert.equal(options.redirect, "manual");
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(Object.values(options.headers).some(value => value.includes(http.password)));
      if (provider === "gitea") assert.equal(options.headers.Authorization, `token ${http.password}`);
      return { ok: true, json: async () => ({ id: 1, [field]: "Developer" }) };
    } });
  }
});

test("auto detects self-hosted Gitea before sending credentials to its current-user API", async () => {
  for (const meta of [
    '<meta name="author" content="Gitea - Git with a cup of tea">',
    "<meta content='Gitea 1.22.0' name='generator'>",
  ]) {
    const calls = [];
    await verifyGitHostLogin({ ...http, host: "http://git.example:3000" }, "auto", { request: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.redirect, "manual");
      if (calls.length === 1) {
        assert.equal(url, "http://git.example:3000/");
        assert.deepEqual(options.headers, { Accept: "text/html", "User-Agent": "Web-Coding" });
        return new Response(`<html><head>${meta}</head><body>Custom company name</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      assert.equal(url, "http://git.example:3000/api/v1/user");
      assert.equal(options.headers.Authorization, `token ${http.password}`);
      assert.equal(options.signal, calls[0].options.signal, "probe and authentication share one deadline");
      return Response.json({ id: 1, login: "Developer" });
    } });
    assert.equal(calls.length, 2);
  }
});

test("Gitea verifies passwords with a username or email after rejecting token authentication", async () => {
  for (const username of ["Developer", "Developer@example.test"]) {
    const account = { ...http, host: "http://git.example:3000", username };
    const calls = [];
    await verifyGitHostLogin(account, "gitea", { request: async (url, options) => {
      calls.push(options);
      assert.equal(url, "http://git.example:3000/api/v1/user");
      assert.equal(options.redirect, "manual");
      if (calls.length === 1) {
        assert.equal(options.headers.Authorization, `token ${http.password}`);
        return new Response("unauthorized", { status: 401 });
      }
      assert.equal(calls.length, 2);
      assert.equal(options.signal, calls[0].signal);
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`${username}:${http.password}`).toString("base64")}`);
      return Response.json({ id: 1, login: "developer", email: "developer@example.test" });
    } });
    assert.equal(calls.length, 2);
  }
});

test("Gitea only retries rejected authentication, never permissions, redirects or transport errors", async () => {
  for (const status of [403, 302, 404, 500]) {
    let calls = 0;
    await assert.rejects(verifyGitHostLogin(http, "gitea", { request: async () => {
      assert.equal(++calls, 1);
      return new Response("fixture-secret", { status });
    } }), error => !error.message.includes("fixture-secret"));
  }
  let calls = 0;
  await assert.rejects(verifyGitHostLogin(http, "gitea", { request: async () => {
    calls++;
    return new Response("fixture-secret", { status: 401 });
  } }), /Gitea 登录验证失败.*双重验证/);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(verifyGitHostLogin(http, "gitea", { request: async () => {
    assert.equal(++calls, 1);
    throw new Error("fixture-secret");
  } }), error => !error.message.includes("fixture-secret"));
});

test("email identity matching is limited to the authenticated Gitea user's own email", async () => {
  for (const [provider, email, id] of [["gitea", "someone@example.test", 1], ["gitea", "developer@example.test", null], ["github", "developer@example.test", 1]]) {
    await assert.rejects(verifyGitHostLogin({ ...http, username: "developer@example.test" }, provider, {
      request: async () => Response.json({ id, login: "developer", email }),
    }), /账号与填写的用户名不一致/);
  }
});

test("auto never authenticates unknown hosts or follows redirects and bounds public probe size", async () => {
  for (const response of [
    new Response('<title>Gitea documentation</title><a href="https://gitea.com">Gitea</a>', { headers: { "content-type": "text/html" } }),
    new Response("", { status: 302, headers: { location: "https://other.example/" } }),
    new Response("", { status: 404 }),
    Response.json({ version: "1.22.0" }),
    new Response("x".repeat(129 * 1024) + '<meta name="author" content="Gitea">', { headers: { "content-type": "text/html" } }),
  ]) {
    let requests = 0;
    await assert.rejects(verifyGitHostLogin({ ...http, host: "http://unknown.example:3000" }, "auto", {
      request: async (url, options) => {
        assert.equal(++requests, 1);
        assert.equal(url, "http://unknown.example:3000/");
        assert.equal(options.redirect, "manual");
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers["PRIVATE-TOKEN"], undefined);
        return response;
      },
    }), /选择 Git 服务/);
  }
  await assert.rejects(verifyGitHostLogin({ ...http, host: "https://unknown.example" }, "auto", {
    request: async () => { throw new Error("fixture-secret network detail"); },
  }), error => {
    assert.match(error.message, /自动识别失败或超时/);
    assert.doesNotMatch(error.message, /fixture-secret|network detail/);
    return true;
  });
  await assert.rejects(verifyGitHostLogin(http, "invalid", { request: () => assert.fail("invalid provider") }), /服务类型无效/);
});

test("HTTP login distinguishes a mismatched service endpoint from denied credentials and redirects", async () => {
  for (const [status, message] of [[404, /接口不存在（404）.*Gitea 与 GitLab/], [401, /个人访问令牌/], [403, /个人访问令牌/], [302, /重定向/]]) {
    await assert.rejects(verifyGitHostLogin({ ...http, host: "http://git.example:3000" }, "gitlab", {
      request: async () => new Response("fixture-secret server detail", { status }),
    }), error => {
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /fixture-secret|server detail/);
      return true;
    });
  }
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
