/* global document, window */
// All account/workspace APIs are fixtures; this suite never invokes Codex or TAPD.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("node:http");
const { chromium } = require("playwright");
const { verifyAccountPreferenceRaces } = require("./account-preferences.cjs");

async function main() {
  const staticRoot = path.resolve("web/dist");
  const output = path.resolve("state/browser/accounts"); fs.mkdirSync(output, { recursive: true });
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    const file = url.pathname.startsWith("/assets/") ? path.join(staticRoot, url.pathname) : path.join(staticRoot, "index.html");
    if (!file.startsWith(staticRoot + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const settings = () => ({ model: null, reasoningEffort: null, permissionMode: "ask", notificationsEnabled: true, grouping: "type" });
  const users = [{ id: "admin", username: "admin", role: "admin", status: "active", mustChangePassword: false }, { id: "member", username: "member", role: "member", status: "active", mustChangePassword: true }];
  const savedSettings = new Map(users.map((user) => [user.id, settings()]));
  const workspaceFor = (user) => ({ id: user.id === "admin" ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222", name: `${user.username} 的私有项目` });
  let activeUser = null, heldDetail, holdDetail = false, heldDetailReady;
  const requests = [], errors = [];
  const writesTo = (endpoint) => requests.filter((request) => request.endpoint === endpoint && request.method === "POST");
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/api/**", async (route) => {
      const request = route.request(), url = new URL(request.url());
      const endpoint = url.pathname;
      const body = request.method() === "POST" ? request.postDataJSON() : {};
      requests.push({ endpoint, method: request.method(), body });
      const send = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      const describe = () => ({ user: activeUser, token: "fixture-csrf-token", ...(activeUser ? { settings: savedSettings.get(activeUser.id) } : {}) });
      if (endpoint === "/api/auth/session") return send(describe());
      if (endpoint === "/api/auth/login") {
        if (body.password !== "fixture-password-123") return send({ error: "账号或密码错误。" }, 401);
        activeUser = users.find((user) => user.username === body.username && user.status === "active");
        return activeUser ? send(describe()) : send({ error: "账号或密码错误。" }, 401);
      }
      if (!activeUser) return send({ error: "请先登录。" }, 401);
      if (endpoint === "/api/auth/logout") { activeUser = null; return send({ ok: true }); }
      if (endpoint === "/api/auth/password") { activeUser.mustChangePassword = false; return send(describe()); }
      if (activeUser.mustChangePassword) return send({ error: "请先修改初始密码。", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
      if (endpoint === "/api/account/settings") {
        if (request.method() === "POST") savedSettings.set(activeUser.id, { ...savedSettings.get(activeUser.id), ...body });
        return send({ settings: savedSettings.get(activeUser.id) });
      }
      if (endpoint === "/api/account/preferences") return send({ preferences: { unreadRunKeys: [] } });
      if (endpoint.endsWith("/models")) return send({ models: [{ model: "fixture-model", label: "测试模型", reasoningEfforts: ["low", "high"] }] });
      if (endpoint.endsWith("/execution-options")) return send({ permissionModes: ["ask", "auto", "full"].map((id) => ({ id, available: true })) });
      if (endpoint === "/api/admin/accounts") {
        if (activeUser.role !== "admin") return send({ error: "仅管理员可操作。" }, 403);
        if (request.method() === "POST") { const user = { ...body, id: "created", status: "active", mustChangePassword: true }; delete user.password; users.push(user); return send({ user }, 201); }
        return send({ users });
      }
      if (endpoint.startsWith("/api/admin/accounts/")) { const user = users.find((entry) => entry.id === endpoint.split("/").at(-1)); Object.assign(user, body); return send({ user }); }
      if (endpoint === "/api/bootstrap") return send({ token: "fixture-csrf-token", workspaces: [workspaceFor(activeUser)] });
      const workspace = workspaceFor(activeUser);
      if (!endpoint.startsWith(`/api/workspaces/${workspace.id}/`)) return send({ error: "工作区不存在。" }, 404);
      if (endpoint.endsWith("/bootstrap")) return send({ token: "fixture-csrf-token", channels: [{ id: "manual", label: "手动输入", capabilities: { manualInput: true } }] });
      if (endpoint.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" });
      const run = { key: "manual-fixture", title: `${activeUser.username} 的私有任务`, status: "completed", metadata: { type: "requirement", progress: "in_progress" } };
      if (endpoint.endsWith("/runs")) return send({ runs: [run] });
      if (endpoint.endsWith("/runs/manual-fixture")) {
        const detail = { ...run, sessionId: `session-${activeUser.id}`, items: [{ id: "item-1", type: "agentMessage", text: `${activeUser.username} 的私有回复` }], requests: [], images: [], executionSettings: { model: "", reasoningEffort: "", permissionMode: "ask" } };
        if (holdDetail) {
          holdDetail = false;
          heldDetail = () => route.fulfill({ contentType: "application/json", headers: { "x-fixture-account": "late" }, body: JSON.stringify({ ...detail, items: [{ id: "late", type: "agentMessage", text: "不应展示的旧账号响应" }] }) });
          heldDetailReady(); return;
        }
        return send(detail);
      }
      return send({ error: `未配置的模拟接口 ${endpoint}` }, 404);
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole("heading", { name: "登录工作台" }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: path.join(output, `login-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(requests.some(({ endpoint }) => endpoint === "/api/bootstrap"), false, "unauthenticated pages must not load workspace data");
    await page.getByLabel("账号", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("incorrect");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "账号或密码错误" }).waitFor();
    await page.getByLabel("密码", { exact: true }).fill("fixture-password-123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByText("admin 的私有回复", { exact: true }).waitFor();
    await page.getByRole("button", { name: "个人设置", exact: true }).click();
    await page.getByRole("heading", { name: "个人设置", exact: true }).waitFor();
    await page.getByLabel("Codex 模型", { exact: true }).selectOption("fixture-model");
    await page.getByLabel("思考强度", { exact: true }).selectOption("high");
    await page.getByLabel("默认任务分组").selectOption("none");
    await page.getByRole("button", { name: "保存个人设置" }).click();
    await page.getByText("个人设置已保存。", { exact: true }).waitFor();
    assert.equal(savedSettings.get("admin").model, "fixture-model");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: path.join(output, `personal-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "账号管理", exact: true }).click();
    await page.getByRole("heading", { name: "账号管理", exact: true }).waitFor();
    await page.getByLabel("新账号", { exact: true }).fill("created-user");
    const temporaryPassword = page.getByLabel("临时密码", { exact: true });
    await temporaryPassword.fill("short");
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    assert.equal(await temporaryPassword.evaluate((input) => input.validity.tooShort), true);
    assert.equal(writesTo("/api/admin/accounts").length, 0, "five-character creation passwords must not be submitted");
    await temporaryPassword.fill("new123");
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    await page.getByText("账号已创建，首次登录需要修改密码。", { exact: true }).waitFor();
    assert.equal(writesTo("/api/admin/accounts").at(-1).body.password, "new123");
    await page.getByRole("button", { name: "created-user：重置密码" }).click();
    const resetPassword = page.getByLabel("created-user 的新临时密码", { exact: true });
    await resetPassword.fill("short");
    await page.getByRole("button", { name: "确认重置密码", exact: true }).click();
    assert.equal(await resetPassword.evaluate((input) => input.validity.tooShort), true);
    assert.equal(writesTo("/api/admin/accounts/created").length, 0, "five-character reset passwords must not be submitted");
    await resetPassword.fill("rst123");
    await page.getByRole("button", { name: "确认重置密码", exact: true }).click();
    await page.getByRole("button", { name: "确认重置密码", exact: true }).waitFor({ state: "hidden" });
    assert.equal(writesTo("/api/admin/accounts/created").at(-1).body.password, "rst123");
    await page.getByRole("button", { name: "created-user：停用账号" }).click();
    await page.getByText("账号已更新。", { exact: true }).waitFor();
    assert.equal(users.find((entry) => entry.id === "created").status, "disabled");
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `account page overflow at ${width}`);
      await page.screenshot({ path: path.join(output, `accounts-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "切换工作区：admin 的私有项目", exact: true }).click();
    await page.getByText("admin 的私有回复", { exact: true }).waitFor();
    await page.getByRole("button", { name: "＋ 从需求启动", exact: true }).click();
    assert.equal(await page.getByLabel("Codex 模型", { exact: true }).inputValue(), "fixture-model");
    assert.equal(await page.getByLabel("思考强度", { exact: true }).inputValue(), "high");
    await page.locator(".session-link").click();
    await page.getByText("admin 的私有回复", { exact: true }).waitFor();
    await page.evaluate(() => {
      const original = window.fetch;
      window.accountResponseMarkers = [];
      window.fetch = async (...args) => {
        const response = await original(...args);
        const json = response.json.bind(response);
        response.json = async () => {
          const result = await json();
          if (response.headers.get("x-fixture-account")) window.setTimeout(() => window.accountResponseMarkers.push("late"), 0);
          return result;
        };
        return response;
      };
    });
    holdDetail = true;
    const capturedDetail = new Promise((resolve) => { heldDetailReady = resolve; });
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await capturedDetail;
    assert.equal(typeof heldDetail, "function");
    const peer = await context.newPage();
    await peer.goto(origin);
    await peer.getByText("admin 的私有回复", { exact: true }).waitFor();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await peer.getByRole("heading", { name: "登录工作台" }).waitFor();
    await page.getByLabel("账号", { exact: true }).fill("member");
    await page.getByLabel("密码", { exact: true }).fill("fixture-password-123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("heading", { name: "设置你的新密码" }).waitFor();
    await page.screenshot({ path: path.join(output, "password-1440.png"), fullPage: true });
    await page.getByLabel("当前密码", { exact: true }).fill("fixture-password-123");
    const newPassword = page.getByLabel("新密码", { exact: true });
    const passwordConfirmation = page.getByLabel("确认新密码", { exact: true });
    await newPassword.fill("short");
    await passwordConfirmation.fill("short");
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    assert.equal(await newPassword.evaluate((input) => input.validity.tooShort), true);
    assert.equal(await passwordConfirmation.evaluate((input) => input.validity.tooShort), true);
    assert.equal(writesTo("/api/auth/password").length, 0, "five-character new passwords must not be submitted");
    await newPassword.fill("next12");
    await passwordConfirmation.fill("next12");
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await page.getByText("member 的私有回复", { exact: true }).waitFor();
    assert.equal(writesTo("/api/auth/password").at(-1).body.password, "next12");
    await heldDetail();
    await page.waitForFunction(() => window.accountResponseMarkers.includes("late"));
    assert.equal(await page.getByText("不应展示的旧账号响应", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "系统设置", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "账号管理", exact: true }).count(), 0);
    await page.goto(`${origin}/accounts`);
    await page.getByRole("heading", { name: "个人设置", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Codex 模型", { exact: true }).inputValue(), "");
    assert.equal(await page.getByLabel("默认任务分组").inputValue(), "type");
    await verifyAccountPreferenceRaces(browser, origin);
    assert.deepEqual(errors, []);
    process.stdout.write("Account browser checks passed: login, password, settings, administration, private state, late responses and cross-tab logout.\n");
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
