/* global window */
const assert = require("node:assert/strict");

async function verifyAccountPreferenceRaces(browser, origin) {
  const context = await browser.newContext();
  const users = ["alice", "bob"].map((id) => ({ id, username: id, role: "member", status: "active", mustChangePassword: false }));
  const settings = new Map(users.map((user) => [user.id, { model: null, reasoningEffort: null, permissionMode: "ask", grouping: "type", notificationsEnabled: false }]));
  const workspaces = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].map((id, index) => ({ id, name: `项目 ${index ? "B" : "A"}` }));
  const preferences = new Map();
  const gates = new Map(), requests = [], errors = [];
  let actor = users[0], nextMarker = 0;
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const hold = (method, endpoint) => new Promise((resolve) => gates.set(`${method} ${endpoint}`, resolve));
  const preferenceKey = (user, workspaceId) => `${user.id}:${workspaceId}`;
  const readPreferences = () => preferences.get(preferenceKey(users[0], workspaces[0].id));
  const selectWorkspace = (index) => page.getByRole("button", { name: `切换工作区：${workspaces[index].name}`, exact: true }).click();
  const openTask = (name) => page.locator(".session-link").filter({ hasText: `任务 ${name}` }).click();
  const login = async (name) => {
    await page.getByLabel("账号", { exact: true }).fill(name);
    await page.getByLabel("密码", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByText("回复 a", { exact: true }).waitFor();
  };
  await page.addInitScript(() => {
    const fixture = window.preferenceFixture = { events: [], responses: [], requests: [], permissionRequested: false };
    window.EventSource = class {
      constructor() { fixture.events.push(this); window.queueMicrotask(() => { if (!this.closed) this.onopen?.(); }); }
      addEventListener() {}
      close() { this.closed = true; }
    };
    window.Notification = class {
      static permission = "default";
      static requestPermission() {
        fixture.permissionRequested = true;
        return new Promise((resolve) => { fixture.grant = () => { window.Notification.permission = "granted"; resolve("granted"); }; });
      }
    };
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      fixture.requests.push({ url: args[0], body: args[1]?.body });
      const response = await fetch(...args);
      const json = response.json.bind(response);
      response.json = async () => {
        const result = await json();
        const marker = response.headers.get("x-preference-fixture");
        if (marker) window.setTimeout(() => fixture.responses.push(marker), 0);
        return result;
      };
      return response;
    };
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request(), endpoint = new URL(request.url()).pathname;
    const user = actor, body = request.method() === "POST" ? request.postDataJSON() : undefined;
    requests.push({ user: user?.id, endpoint, body });
    const reply = (value) => {
      const complete = (marker) => route.fulfill({ contentType: "application/json", headers: marker ? { "x-preference-fixture": marker } : {}, body: JSON.stringify(typeof value === "function" ? value() : value) });
      const key = `${request.method()} ${endpoint}`, capture = gates.get(key);
      if (!capture) return complete();
      gates.delete(key);
      const marker = String(++nextMarker);
      capture({ body, user, release: async () => { await complete(marker); await page.waitForFunction((value) => window.preferenceFixture.responses.includes(value), marker); } });
    };
    const describe = () => ({ user: actor, token: "fixture-token", settings: actor ? settings.get(actor.id) : undefined });
    if (endpoint === "/api/auth/session") return reply(describe());
    if (endpoint === "/api/auth/logout") { actor = null; return reply({ ok: true }); }
    if (endpoint === "/api/auth/login") { actor = users.find((entry) => entry.id === body.username); return reply(describe()); }
    if (endpoint === "/api/account/settings") return reply(() => {
      if (body) settings.set(user.id, { ...settings.get(user.id), ...body });
      return { settings: settings.get(user.id) };
    });
    if (endpoint === "/api/account/preferences") return reply(() => {
      const workspaceId = body?.workspaceId || new URL(request.url()).searchParams.get("workspaceId");
      const key = preferenceKey(user, workspaceId);
      if (body) preferences.set(key, [...body.unreadRunKeys]);
      return { preferences: { unreadRunKeys: preferences.get(key) || [] } };
    });
    if (endpoint === "/api/bootstrap") return reply({ token: "fixture-token", workspaces });
    if (endpoint.endsWith("/bootstrap")) return reply({ token: "fixture-token", channels: [{ id: "manual", label: "手动输入", capabilities: { manualInput: true } }] });
    if (endpoint.endsWith("/models")) return reply({ models: [] });
    if (endpoint.endsWith("/execution-options")) return reply({ permissionModes: ["ask", "auto", "full"].map((id) => ({ id, available: true })) });
    const runs = ["a", "b"].map((name) => ({ key: `manual-${name}`, title: `任务 ${name}`, status: "completed", metadata: { type: "requirement", progress: "in_progress" } }));
    if (endpoint.endsWith("/runs")) return reply({ runs });
    const run = runs.find((entry) => endpoint.endsWith(`/runs/${entry.key}`));
    if (run) return reply({ ...run, sessionId: run.key, items: [{ id: "reply", type: "agentMessage", text: `回复 ${run.key.at(-1)}` }], requests: [], executionSettings: { model: "", reasoningEffort: "", permissionMode: "ask" } });
    throw new Error(`Unconfigured preference fixture endpoint: ${endpoint}`);
  });
  try {
    await page.goto(origin);
    await page.getByText("回复 a", { exact: true }).waitFor();
    const heldSave = hold("POST", "/api/account/settings");
    await page.getByLabel("任务分组方式").selectOption("none");
    const save = await heldSave;
    const heldSession = hold("GET", "/api/auth/session");
    await page.evaluate(() => window.preferenceFixture.events.at(-1).onerror());
    const session = await heldSession;
    await save.release();
    await page.locator(".task-group.ungrouped").waitFor();
    await session.release();
    assert.equal(await page.getByLabel("任务分组方式").inputValue(), "none", "SSE revalidation must preserve a save completed after its settings snapshot");

    await selectWorkspace(1);
    await page.getByText("回复 a", { exact: true }).waitFor();
    preferences.set(preferenceKey(users[0], workspaces[0].id), ["manual-a", "manual-b"]);
    const heldInitialRead = hold("GET", "/api/account/preferences");
    await selectWorkspace(0);
    const initialRead = await heldInitialRead;
    await page.getByText("回复 a", { exact: true }).waitFor();
    await openTask("b");
    await page.getByText("回复 b", { exact: true }).waitFor();
    await selectWorkspace(1);
    const heldPreloadSave = hold("POST", "/api/account/preferences");
    await initialRead.release();
    const preloadSave = await heldPreloadSave;
    assert.deepEqual(preloadSave.body.unreadRunKeys, [], "reads made before initial preferences arrive must survive unmount");
    await preloadSave.release();

    const queueTwoReads = async () => {
      await selectWorkspace(1);
      await page.getByText("回复 a", { exact: true }).waitFor();
      preferences.set(preferenceKey(users[0], workspaces[0].id), ["manual-a", "manual-b"]);
      const held = hold("POST", "/api/account/preferences");
      await selectWorkspace(0);
      const first = await held;
      assert.deepEqual(first.body.unreadRunKeys, ["manual-b"]);
      await openTask("b");
      await page.getByText("回复 b", { exact: true }).waitFor();
      await page.locator(".unread-result").waitFor({ state: "hidden" });
      return first;
    };
    const firstRead = await queueTwoReads();
    const heldFinalRead = hold("POST", "/api/account/preferences");
    await selectWorkspace(1);
    await page.getByText("回复 a", { exact: true }).waitFor();
    await firstRead.release();
    const finalRead = await heldFinalRead;
    assert.equal(finalRead.body.workspaceId, workspaces[0].id);
    assert.deepEqual(finalRead.body.unreadRunKeys, []);
    const preferenceReadsBefore = requests.filter((entry) => entry.endpoint === "/api/account/preferences" && !entry.body).length;
    await selectWorkspace(0);
    await page.getByText("回复 a", { exact: true }).waitFor();
    assert.equal(requests.filter((entry) => entry.endpoint === "/api/account/preferences" && !entry.body).length, preferenceReadsBefore,
      "remounting must wait for the previous page's final preference save before reading");
    await finalRead.release();
    assert.deepEqual(readPreferences(), [], "unmounting a workspace must drain its queued unread changes");
    assert.equal(await page.locator(".unread-result").count(), 0);

    const oldRead = await queueTwoReads();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await login("bob");
    const writesBefore = requests.filter((entry) => entry.endpoint === "/api/account/preferences" && entry.body).length;
    await oldRead.release();
    assert.equal(requests.filter((entry) => entry.endpoint === "/api/account/preferences" && entry.body).length, writesBefore, "an old account's queued preference write must not be sent after login changes");

    await page.getByRole("button", { name: "个人设置", exact: true }).click();
    await page.getByRole("button", { name: "开启桌面通知", exact: true }).click();
    await page.waitForFunction(() => window.preferenceFixture.permissionRequested);
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await login("alice");
    const settingWritesBefore = requests.filter((entry) => entry.endpoint === "/api/account/settings" && entry.body).length;
    const browserWritesBefore = await page.evaluate(() => window.preferenceFixture.requests.filter((entry) => entry.url === "/api/account/settings" && entry.body).length);
    await page.evaluate(async () => { window.preferenceFixture.grant(); await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    assert.equal(await page.evaluate(() => window.preferenceFixture.requests.filter((entry) => entry.url === "/api/account/settings" && entry.body).length), browserWritesBefore);
    assert.equal(settings.get("alice").notificationsEnabled, false);
    assert.equal(requests.filter((entry) => entry.endpoint === "/api/account/settings" && entry.body).length, settingWritesBefore, "permission granted for an unmounted account must not save another account's notification setting");
    assert.deepEqual(errors, []);
    process.stdout.write("Account preference races passed: revalidation, queued and pre-load unread saves, remount ordering and account isolation.\n");
  } finally { await context.close(); }
}

module.exports = { verifyAccountPreferenceRaces };
