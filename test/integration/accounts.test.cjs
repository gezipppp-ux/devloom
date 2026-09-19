const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const {
  initializeDatabase,
} = require("../../src/storage/database-lifecycle.cjs");
const {
  AccountServices,
} = require("../../src/application/account-services.cjs");
const {
  WorkspaceManager,
} = require("../../src/application/workspace-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");

const password = "fixture-password-123";

async function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "web-coding-accounts-"),
  );
  let database, accounts, app;
  t.after(async () => {
    await app?.close();
    await accounts?.close();
    database?.close();
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("web-coding-accounts-"));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  database = await initializeDatabase(directory);
  accounts = new AccountServices(database);
  const admin = await accounts.create(
    { username: "admin", password },
    null,
    true,
  );
  const member = await accounts.create({ username: "member", password }, admin);
  accounts.store.update(member.id, { must_change_password: 0 });
  const workspaces = new WorkspaceManager({
    database,
    directory: path.join(directory, "workspaces"),
    createManager: () => {
      const manager = new EventEmitter();
      manager.channels = { list: () => [] };
      manager.close = async () => {};
      manager.list = () => [];
      return manager;
    },
  });
  app = createWebServer({ database, dataDirectory: directory, workspaces });
  const origin = await app.listen(0);
  function client() {
    let cookie = "",
      token = "";
    return {
      get headers() {
        return { cookie, "x-tapd-token": token };
      },
      async request(url, input, extra = {}) {
        const response = await fetch(origin + url, {
          ...extra,
          method: input === undefined ? "GET" : "POST",
          headers: {
            cookie,
            "x-tapd-token": token,
            ...(input === undefined
              ? {}
              : { "content-type": "application/json" }),
            ...extra.headers,
          },
          ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        });
        const saved = response.headers.get("set-cookie");
        if (saved) cookie = saved.split(";", 1)[0];
        const data = await response.json();
        if (data.token) token = data.token;
        return { status: response.status, data, headers: response.headers };
      },
      async login(username) {
        await this.request("/api/auth/session");
        const result = await this.request("/api/auth/login", {
          username,
          password,
        });
        assert.equal(result.status, 200, JSON.stringify(result.data));
        return result;
      },
    };
  }
  return { app, origin, accounts, database, admin, member, workspaces, client };
}

test("SQLite accounts require login and session CSRF, isolate workspaces including administrators", async (t) => {
  const { client, database } = await fixture(t);
  const anonymous = client();
  for (const url of [
    "/api/bootstrap",
    "/api/workspaces",
    "/api/system/settings",
    "/api/workspaces/unknown/events",
    "/api/workspaces/unknown/runs/x/images/0",
  ])
    assert.equal((await anonymous.request(url)).status, 401, url);
  const preauth = await anonymous.request("/api/auth/session");
  assert.equal(preauth.data.user, null);
  assert.match(preauth.headers.get("set-cookie"), /HttpOnly/i);
  assert.equal(
    (
      await anonymous.request(
        "/api/auth/login",
        { username: "admin", password },
        { headers: { "x-tapd-token": "bad" } },
      )
    ).status,
    403,
  );
  const admin = client(),
    member = client();
  await admin.login("admin");
  await member.login("member");
  const own = await member.request("/api/workspaces", { name: "私有工作区" });
  assert.equal(own.status, 201, JSON.stringify(own.data));
  assert.equal(
    (await admin.request(`/api/workspaces/${own.data.id}/bootstrap`)).status,
    404,
  );
  assert.deepEqual(
    (await admin.request("/api/workspaces")).data.workspaces,
    [],
  );
  assert.equal((await member.request("/api/system/settings")).status, 403);
  assert.equal((await member.request("/api/admin/accounts")).status, 403);
  const settings = {
    model: "fixture-model",
    reasoningEffort: "high",
    permissionMode: "ask",
    notificationsEnabled: false,
    grouping: "none",
  };
  assert.deepEqual(
    (await member.request("/api/account/settings", settings)).data.settings,
    settings,
  );
  assert.equal(
    (await admin.request("/api/account/settings")).data.settings.model,
    null,
  );
  const rows = database.handle.prepare("SELECT * FROM auth_sessions").all();
  assert.ok(rows.length >= 2);
  assert.ok(
    rows.every(
      (row) =>
        /^[a-f0-9]{64}$/.test(row.sid) &&
        !row.session_json.includes("encryptedSessionId"),
    ),
  );
});

test("initial admin is unique, password resets invalidate sessions, last active admin is protected", async (t) => {
  const { accounts, client, admin, member } = await fixture(t);
  await assert.rejects(
    accounts.create({ username: "another", password }, null, true),
    /已初始化/,
  );
  const browser = client();
  await browser.login("admin");
  assert.equal(
    (
      await browser.request(`/api/admin/accounts/${admin.id}`, {
        status: "disabled",
      })
    ).status,
    409,
  );
  const peer = client();
  await peer.login("member");
  assert.equal(
    (
      await browser.request(`/api/admin/accounts/${member.id}`, {
        password: "new-password-1234",
      })
    ).status,
    200,
  );
  assert.equal((await peer.request("/api/bootstrap")).status, 401);
  await peer.request("/api/auth/session");
  const logged = await peer.request("/api/auth/login", {
    username: "member",
    password: "new-password-1234",
  });
  assert.equal(logged.data.user.mustChangePassword, true);
  assert.equal(
    (await peer.request("/api/bootstrap")).data.code,
    "PASSWORD_CHANGE_REQUIRED",
  );
  assert.equal(
    (
      await peer.request("/api/auth/password", {
        currentPassword: "new-password-1234",
        password: "changed-password-1234",
      })
    ).status,
    200,
  );
  assert.equal((await peer.request("/api/bootstrap")).status, 200);
});

test("logout closes existing SSE and its cookie cannot reconnect", async (t) => {
  const { client, origin } = await fixture(t);
  const browser = client();
  await browser.login("admin");
  const created = await browser.request("/api/workspaces", { name: "事件" });
  const url = `/api/workspaces/${created.data.id}/events`;
  const headers = browser.headers;
  const stream = await fetch(origin + url, { headers });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  await reader.read();
  assert.equal((await browser.request("/api/auth/logout", {})).status, 200);
  let text = "";
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    text += Buffer.from(item.value).toString();
  }
  assert.match(text, /auth-expired/);
  assert.equal((await fetch(origin + url, { headers })).status, 401);
});

test("disabled accounts and expired sessions close streams before a private event is delivered", async (t) => {
  const { client, origin, database, workspaces, member } = await fixture(t);
  const admin = client(),
    browser = client();
  await admin.login("admin");
  await browser.login("member");
  const created = await browser.request("/api/workspaces", { name: "撤权" });
  const url = `/api/workspaces/${created.data.id}/events`;
  async function stream() {
    const response = await fetch(origin + url, { headers: browser.headers });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    await reader.read();
    return reader;
  }
  async function ended(reader) {
    let value = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      value += Buffer.from(part.value).toString();
    }
    assert.match(value, /auth-expired/);
    assert.doesNotMatch(value, /private-marker/);
  }
  const expired = await stream();
  database.handle
    .prepare("UPDATE auth_sessions SET expires_at=0 WHERE user_id=?")
    .run(member.id);
  workspaces
    .get(created.data.id, member)
    .sessions.emit("event", { marker: "private-marker" });
  await ended(expired);
  await browser.login("member");
  const disabled = await stream();
  assert.equal(
    (
      await admin.request(`/api/admin/accounts/${member.id}`, {
        status: "disabled",
      })
    ).status,
    200,
  );
  await ended(disabled);
  assert.equal((await browser.request("/api/bootstrap")).status, 401);
});

test("login attempts are rate limited and successful mutations record actor without secrets", async (t) => {
  const { client, database } = await fixture(t);
  const browser = client();
  await browser.login("admin");
  const workspace = await browser.request("/api/workspaces", { name: "审计" });
  const audit = database.handle
    .prepare("SELECT * FROM audit_events WHERE workspace_id=?")
    .all(workspace.data.id);
  assert.equal(audit.length, 1);
  assert.match(audit[0].event, /workspaces/);
  assert.ok(audit[0].actor_user_id);
  assert.doesNotMatch(
    JSON.stringify(audit),
    /fixture-password|csrf|password_hash/,
  );
  const attacker = client();
  await attacker.request("/api/auth/session");
  let last;
  for (let i = 0; i < 11; i++)
    last = await attacker.request("/api/auth/login", {
      username: "admin",
      password: "incorrect-password",
    });
  assert.equal(last.status, 429);
});
