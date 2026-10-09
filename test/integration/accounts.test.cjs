const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { waitForClone } = require("../support/workspace-clones.cjs");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
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
const { png } = require("../support/helpers.cjs");
const { gitRemote } = require("../support/git-remote.cjs");
const { GitAccountServices } = require("../../src/application/git-account-services.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");

const password = "fixture-password-123";

test("Git HTTP endpoints test drafts before saving and expose only generated SSH public keys", async t => {
  const { client } = await fixture(t);
  const browser = client();
  await browser.login("admin");
  const list = await browser.request("/api/account/git-accounts");
  const saved = list.data.accounts[0];
  assert.equal(saved.authType, "http");
  assert.equal(saved.password, undefined);
  const input = { name: saved.name, authType: saved.authType, remoteUrl: saved.remoteUrl, username: saved.username };
  const tested = await browser.request(`/api/account/git-accounts/${saved.id}/test`, input);
  assert.equal(tested.status, 200, JSON.stringify(tested.data));
  const updated = await browser.request(`/api/account/git-accounts/${saved.id}`, { ...input, name: "edited" });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.account.name, "edited");
  const failed = await browser.request(`/api/account/git-accounts/${saved.id}`, { ...input, password: "wrong" });
  assert.equal(failed.status, 400);
  assert.equal((await browser.request("/api/account/git-accounts")).data.accounts[0].name, "edited");
  const key = await browser.request("/api/account/git-keys", {});
  assert.equal(key.status, 201, JSON.stringify(key.data));
  assert.deepEqual(Object.keys(key.data).sort(), ["expiresAt", "id", "publicKey"]);
  assert.match(key.data.publicKey, /^ssh-ed25519 /);
  const legacy = await browser.request("/api/account/git-accounts", { name: "obsolete", protocol: "http" });
  assert.equal(legacy.status, 400);
});

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "web-coding-accounts-"),
  );
  let database, accounts, app, remote;
  t.after(async () => {
    await app?.close();
    await remote?.close();
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
  remote = await gitRemote(path.join(directory, "git-server"));
  saveSystemSettings({ memberStorageRoot: path.join(directory, "members") }, directory);
  const gitAccounts = new GitAccountServices(database), gitIds = new Map();
  for (const actor of [admin, member]) {
    const account = await gitAccounts.save(actor, { name: "fixture", authType: "http", remoteUrl: remote.remoteUrl, username: remote.username, password: remote.password });
    gitIds.set(actor.username, account.id);
  }
  const activity = [];
  const workspaces = new WorkspaceManager({
    database,
    directory: path.join(directory, "workspaces"),
    createManager: () => {
      const manager = new EventEmitter();
      manager.channels = {
        list: () => [],
        get: () => ({
          uploadImage(bytes) {
            activity.push({ action: "uploadImage", bytes });
            return { id: "fixture-image" };
          },
        }),
      };
      manager.close = async () => {};
      manager.list = () => [];
      for (const action of [
        "start",
        "deleteWorktree",
        "uploadMessageImage",
        "send",
        "updateTaskMetadata",
        "updateExecutionSettings",
        "interrupt",
        "respond",
      ])
        manager[action] = async (...args) => {
          activity.push({ action, args });
          return { key: "1-2", accepted: true };
        };
      return manager;
    },
  });
  app = createWebServer({
    database,
    dataDirectory: directory,
    workspaces,
    ...options,
  });
  const origin = await app.listen(0);
  function client() {
    let cookie = "",
      token = "", username = "";
    return {
      get headers() {
        return { cookie, "x-tapd-token": token };
      },
      async request(url, input, extra = {}) {
        if (url === "/api/workspaces" && input) input = { requestId: randomUUID(), remoteUrl: remote.remoteUrl, gitAccountId: gitIds.get(username), ...input };
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
        if (url === "/api/workspaces" && input && response.status === 202) {
          const clone = await waitForClone(async () => (await this.request(`/api/workspace-clones/${data.clone.id}`)).data.clone);
          assert.equal(clone.status, "completed", JSON.stringify(clone));
          return { status: response.status, data: clone.workspace, headers: response.headers };
        }
        return { status: response.status, data, headers: response.headers };
      },
      async login(selectedUsername) {
        username = selectedUsername;
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
  return {
    app,
    origin,
    accounts,
    database,
    admin,
    member,
    workspaces,
    client,
    directory,
    activity,
  };
}

function rawRequest(origin, pathname, headers, bytes, partial = false) {
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(
      origin,
      {
        path: pathname,
        method: bytes === undefined ? "GET" : "POST",
        headers: {
          ...headers,
          ...(bytes === undefined
            ? {}
            : { "content-length": String(bytes.length) }),
        },
      },
      (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("error", reject);
        incoming.on("end", () => {
          try {
            resolve({
              status: incoming.statusCode,
              data: JSON.parse(Buffer.concat(chunks).toString()),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(5000, () =>
      request.destroy(new Error("HTTP fixture request timed out")),
    );
    if (partial) request.write(bytes.subarray(0, 1));
    else request.end(bytes);
  });
  response.catch(() => {});
  return { request, response };
}

async function partialRequest(app, origin, pathname, browser, payload) {
  const binary = Buffer.isBuffer(payload);
  const bytes = binary ? payload : Buffer.from(JSON.stringify(payload));
  let accepted;
  const arrived = new Promise((resolve) => {
    accepted = resolve;
  });
  const original = app.accounts.actor;
  app.accounts.actor = function (session) {
    const actor = original.call(this, session);
    if (actor) accepted();
    return actor;
  };
  const pending = rawRequest(
    origin,
    pathname,
    {
      ...browser.headers,
      "content-type": binary ? "image/png" : "application/json",
    },
    bytes,
    true,
  );
  try {
    await Promise.race([
      arrived,
      pending.response.then(() => {
        throw new Error("Request ended before authentication");
      }),
    ]);
  } finally {
    app.accounts.actor = original;
  }
  return {
    finish: () => pending.request.end(bytes.subarray(1)),
    destroy: () => pending.request.destroy(),
    response: pending.response,
  };
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
  assert.equal(own.status, 202, JSON.stringify(own.data));
  assert.equal(
    (await admin.request(`/api/workspaces/${own.data.id}/bootstrap`)).status,
    404,
  );
  assert.equal((await admin.request(`/api/workspaces/${own.data.id}/runs?archived=true`)).status, 404);
  assert.equal((await admin.request(`/api/workspaces/${own.data.id}/runs/1-2/file?path=seed.ts`)).status, 404);
  assert.equal((await admin.request(`/api/workspaces/${own.data.id}/runs/1-2/files`)).status, 404);
  assert.equal((await admin.request(`/api/workspaces/${own.data.id}/runs/1-2/restore`, {})).status, 404);
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
  for (const invalid of ["abc12", "a".repeat(257)]) {
    const rejected = await browser.request("/api/admin/accounts", {
      username: "boundary", password: invalid,
    });
    assert.equal(rejected.status, 400);
    assert.match(rejected.data.error, /6–256/);
    assert.equal((await browser.request(`/api/admin/accounts/${member.id}`, {
      password: invalid,
    })).status, 400);
  }
  assert.equal((await browser.request("/api/admin/accounts", {
    username: "boundary", password: "create",
  })).status, 201);
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
        password: "reset6",
      })
    ).status,
    200,
  );
  assert.equal((await peer.request("/api/bootstrap")).status, 401);
  await peer.request("/api/auth/session");
  const logged = await peer.request("/api/auth/login", {
    username: "member",
    password: "reset6",
  });
  assert.equal(logged.data.user.mustChangePassword, true);
  assert.equal(
    (await peer.request("/api/bootstrap")).data.code,
    "PASSWORD_CHANGE_REQUIRED",
  );
  for (const invalid of ["abc12", "a".repeat(257)]) {
    const rejected = await peer.request("/api/auth/password", {
      currentPassword: "reset6", password: invalid,
    });
    assert.equal(rejected.status, 400);
    assert.match(rejected.data.error, /6–256/);
  }
  assert.equal(
    (
      await peer.request("/api/auth/password", {
        currentPassword: "reset6",
        password: "change",
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
  assert.equal(audit[0].event, "workspace.clone.completed");
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

test("raw API path variants cannot bypass login limits and query strings share the same limit", async (t) => {
  const { app, origin, client } = await fixture(t, {
    pageHandler(_request, response, url) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ pathname: url.pathname }));
    },
  });
  const browser = client();
  await browser.request("/api/auth/session");
  let attempts = 0;
  const login = app.accounts.login.bind(app.accounts);
  app.accounts.login = (...args) => {
    attempts++;
    return login(...args);
  };
  const bytes = Buffer.from(
    JSON.stringify({ username: "admin", password: "incorrect-password" }),
  );
  const headers = { ...browser.headers, "content-type": "application/json" };
  for (const pathname of [
    "/api/auth/./login",
    "/api/auth/ignored/../login",
    "/api/auth/%2e/login",
    "/api/auth/%2e%2e/auth/login",
    "/ignored/../api/auth/login",
    "/api/auth\\login",
    "/api/auth/login#fragment",
  ]) {
    const result = await rawRequest(origin, pathname, headers, bytes).response;
    assert.equal(result.status, 400, pathname);
  }
  assert.equal(attempts, 0);
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await rawRequest(
      origin,
      `/api/auth/login?next=/./&attempt=${attempt}`,
      headers,
      bytes,
    ).response;
    assert.equal(result.status, 401);
  }
  assert.equal(
    (await rawRequest(origin, "/api/auth/login", headers, bytes).response)
      .status,
    429,
  );
  assert.equal(attempts, 10);
  assert.deepEqual(await rawRequest(origin, "/./login", {}).response, {
    status: 200,
    data: { pathname: "/login" },
  });
});

test("logout fences every pending JSON or binary mutation before resolving its workspace context", async (t) => {
  const {
    app,
    origin,
    client,
    accounts,
    admin,
    member,
    workspaces,
    directory,
    activity,
  } = await fixture(t);
  const browser = client();
  await browser.login("admin");
  const created = await browser.request("/api/workspaces", {
    name: "原工作区",
  });
  const workspace = created.data.id;
  const prefix = `/api/workspaces/${workspace}`;
  const systemBefore = (await browser.request("/api/system/settings")).data;
  const settingsBefore = accounts.settings(admin);
  const target = path.join(directory, "revoked-settings");
  const routes = [
    [
      "/api/auth/password",
      { currentPassword: password, password: "changed-password-1234" },
    ],
    ["/api/auth/logout", {}],
    ["/api/account/settings", { notificationsEnabled: false }],
    [
      "/api/account/preferences",
      { workspaceId: workspace, unreadRunKeys: ["1-2"] },
    ],
    ["/api/admin/accounts", { username: "late-user", password }],
    [`/api/admin/accounts/${member.id}`, { status: "disabled" }],
    ["/api/system/settings", { memberStorageRoot: target }],
    ["/api/workspaces", { name: "迟到工作区" }],
    [prefix, { name: "迟到重命名" }],
    ...[
      "/repository/git/fetch",
      "/repository/git/update",
      "/settings",
      "/settings/tapd",
      "/settings/tapd/check",
      "/settings/prompts",
      "/runs",
      "/runs/1-2/worktree/delete",
      "/runs/1-2/messages",
      "/runs/1-2/metadata",
      "/runs/1-2/execution-settings",
      "/runs/1-2/interrupt",
      "/runs/1-2/responses",
    ].map((suffix) => [prefix + suffix, {}]),
    [prefix + "/channels/manual/images", png],
    [prefix + "/runs/1-2/message-images", png],
  ];
  const pending = [];
  try {
    for (const [pathname, payload] of routes)
      pending.push(
        await partialRequest(app, origin, pathname, browser, payload),
      );
    assert.equal(
      workspaces.contexts.size,
      0,
      "no incomplete body may acquire a workspace context",
    );
    assert.deepEqual(activity, []);
    assert.equal((await browser.request("/api/auth/logout", {})).status, 200);
    for (const request of pending) request.finish();
    const results = await Promise.all(
      pending.map((request) => request.response),
    );
    for (let index = 0; index < results.length; index++) {
      assert.equal(results[index].status, 401, routes[index][0]);
      assert.equal(results[index].data.code, "AUTH_REQUIRED", routes[index][0]);
    }
  } finally {
    for (const request of pending) request.destroy();
  }
  assert.deepEqual(activity, []);
  assert.equal(workspaces.contexts.size, 0);
  assert.deepEqual(workspaces.list(admin), [created.data]);
  assert.deepEqual(accounts.settings(admin), settingsBefore);
  assert.deepEqual(accounts.preferences(admin, workspace), {
    unreadRunKeys: [],
  });
  assert.equal(accounts.list(admin).length, 2);
  assert.equal(accounts.store.byId(member.id).status, "active");
  assert.equal(fs.existsSync(target), false);
  await browser.login("admin");
  assert.deepEqual(
    (await browser.request("/api/system/settings")).data,
    systemBefore,
  );
});

test("disabled, downgraded, reset and expired identities cannot finish an authorized settings body", async (t) => {
  for (const reason of ["disabled", "downgraded", "reset", "expired"])
    await t.test(reason, async (t) => {
      const { app, origin, client, accounts, admin, directory, database } =
        await fixture(t);
      const second = await accounts.create(
        { username: "second-admin", password, role: "admin" },
        admin,
      );
      accounts.store.update(second.id, { must_change_password: 0 });
      const browser = client(),
        administrator = client();
      await browser.login("admin");
      await administrator.login("second-admin");
      const before = (await administrator.request("/api/system/settings")).data;
      const target = path.join(directory, "revoked-" + reason);
      const pending = await partialRequest(
        app,
        origin,
        "/api/system/settings",
        browser,
        { memberStorageRoot: target },
      );
      try {
        if (reason === "expired")
          database.handle
            .prepare("UPDATE auth_sessions SET expires_at=0 WHERE user_id=?")
            .run(admin.id);
        else {
          const patch =
            reason === "disabled"
              ? { status: "disabled" }
              : reason === "downgraded"
                ? { role: "member" }
                : { password: "reset-password-1234" };
          assert.equal(
            (
              await administrator.request(
                `/api/admin/accounts/${admin.id}`,
                patch,
              )
            ).status,
            200,
          );
        }
        pending.finish();
        assert.equal((await pending.response).status, 401);
      } finally {
        pending.destroy();
      }
      assert.equal(fs.existsSync(target), false);
      assert.deepEqual(
        (await administrator.request("/api/system/settings")).data,
        before,
      );
    });
});

test("complete bodies retain owner checks and logout leaves accepted background work running", async (t) => {
  const { app, origin, client, accounts, admin, member, workspaces, activity } =
    await fixture(t);
  const browser = client();
  await browser.login("admin");
  const own = workspaces.save({ name: "自己的" }, undefined, admin);
  const foreign = workspaces.save({ name: "他人的" }, undefined, member);
  const unauthorized = await partialRequest(
    app,
    origin,
    `/api/workspaces/${foreign.id}/channels/manual/images`,
    browser,
    png,
  );
  try {
    unauthorized.finish();
    assert.equal((await unauthorized.response).status, 404);
  } finally {
    unauthorized.destroy();
  }
  assert.equal(workspaces.contexts.size, 0);
  const upload = await partialRequest(
    app,
    origin,
    `/api/workspaces/${own.id}/channels/manual/images`,
    browser,
    png,
  );
  try {
    upload.finish();
    assert.equal((await upload.response).status, 201);
  } finally {
    upload.destroy();
  }
  assert.deepEqual(activity, [{ action: "uploadImage", bytes: png }]);
  assert.equal(
    (
      await rawRequest(
        origin,
        `/api/workspaces/${own.id}/runs/1-2/interrupt`,
        browser.headers,
        Buffer.alloc(0),
      ).response
    ).status,
    202,
  );
  let complete;
  const finished = new Promise((resolve) => {
    complete = resolve;
  });
  const manager = workspaces.get(own.id, admin).sessions;
  manager.start = () => {
    finished.then(() => activity.push({ action: "background-finished" }));
    return { key: "1-2", accepted: true };
  };
  let closed = false;
  manager.close = async () => {
    closed = true;
  };
  assert.equal(
    (
      await browser.request(`/api/workspaces/${own.id}/runs`, {
        channel: "manual",
      })
    ).status,
    202,
  );
  assert.equal(
    (
      await rawRequest(
        origin,
        "/api/auth/logout",
        browser.headers,
        Buffer.alloc(0),
      ).response
    ).status,
    200,
  );
  assert.equal(closed, false, "logout must not close the manager");
  complete();
  await finished;
  assert.deepEqual(activity.at(-1), { action: "background-finished" });
  assert.equal(accounts.store.byId(admin.id).status, "active");
});

test("account mutations recheck session revocation after asynchronous password work", async (t) => {
  for (const method of ["create", "update", "changePassword"])
    await t.test(method, async (t) => {
      const { app, database, accounts, admin, member, client } =
        await fixture(t);
      const browser = client();
      await browser.login("admin");
      const before = accounts.store.list();
      const original = app.accounts[method].bind(app.accounts);
      app.accounts[method] = (...args) => {
        const pending = original(...args);
        // The service has passed its first authorization and reached scrypt.
        // Model logout on another connection while password work is pending.
        database.handle
          .prepare("DELETE FROM auth_sessions WHERE user_id=?")
          .run(admin.id);
        return pending;
      };
      const route =
        method === "create"
          ? "/api/admin/accounts"
          : method === "update"
            ? `/api/admin/accounts/${member.id}`
            : "/api/auth/password";
      const input =
        method === "create"
          ? { username: "late-user", password }
          : method === "update"
            ? { password: "reset-password-1234" }
            : { currentPassword: password, password: "changed-password-1234" };
      assert.equal((await browser.request(route, input)).status, 401);
      assert.deepEqual(accounts.store.list(), before);
    });
});
