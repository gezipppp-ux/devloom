/* global window, document, localStorage, Event */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { agentDescriptor } = require("../fixtures/agent-descriptor.cjs");

async function verifyDesktopNotifications(browser) {
  const context = await browser.newContext({ locale: "zh-CN" });
  const page = await context.newPage(), writes = [], errors = [];
  const staticRoot = path.resolve("web/dist"), output = path.resolve("state/browser/desktop-notifications");
  fs.mkdirSync(output, { recursive: true });
  const settings = { notificationsEnabled: false, model: null, reasoningEffort: null, permissionMode: "ask" };
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const nativeSecure = window.isSecureContext;
    const fixture = window.notificationFixture = { secure: null, permission: "default", requests: 0, copies: [] };
    Object.defineProperty(window, "isSecureContext", { get: () => fixture.secure ?? nativeSecure });
    window.Notification = class {
      static get permission() { return fixture.permission; }
      static async requestPermission() { fixture.requests++; fixture.permission = "granted"; return "granted"; }
    };
    const execCommand = document.execCommand.bind(document);
    document.execCommand = command => {
      if (command === "copy") fixture.copies.push({ value: document.activeElement.value, modal: !!document.activeElement.closest("dialog[open]") });
      return execCommand(command);
    };
    window.EventSource = class { addEventListener() {} close() {} };
  });
  // Every origin below is intercepted locally. No requests reach a real server.
  await context.route("**/*", route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname;
    const send = json => route.fulfill({ json });
    if (request.method() === "POST") writes.push({ endpoint, body: request.postDataJSON() });
    if (endpoint === "/api/auth/session") return send({ user: { id: "notification-user", username: "notification-user", displayName: "通知验证用户", role: "member", status: "active", mustChangePassword: false }, token: "fixture", settings });
    if (endpoint === "/api/account/settings") { Object.assign(settings, request.postDataJSON()); return send({ settings }); }
    if (endpoint === "/api/bootstrap") return send({ workspaces: [], token: "fixture" });
    if (endpoint === "/api/projects") return send({ projects: [], canCreateProjects: false });
    if (endpoint === "/api/account/models") return send({ models: [] });
    if (endpoint === "/api/account/execution-options") return send({ agent: agentDescriptor, permissionModes: ["ask", "auto", "full"].map(id => ({ id, available: true })) });
    if (endpoint.startsWith("/api/workbench/")) return send({ items: [], people: [], total: 0, nextOffset: null });
    if (endpoint === "/api/workspace-clones") return send({ clones: [] });
    if (endpoint.startsWith("/api/")) throw new Error(`Unexpected notification fixture request: ${endpoint}`);
    const file = endpoint.startsWith("/assets/") ? path.join(staticRoot, endpoint) : path.join(staticRoot, "index.html");
    assert.ok(file.startsWith(staticRoot + path.sep) && fs.existsSync(file));
    return route.fulfill({ contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html", body: fs.readFileSync(file) });
  });
  const hint = () => page.locator(".notification-connection-hint");
  const toggle = () => page.getByRole("switch", { name: "需要我处理时提醒", exact: true });
  const dialog = () => page.getByRole("dialog", { name: "开启桌面通知", exact: true });
  const navigate = async url => { await page.goto(`${url}/personal`); await toggle().waitFor(); };
  try {
    for (const url of ["http://192.0.2.64:4317", "http://devloom.example.test"]) {
      await navigate(url);
      assert.equal(await page.evaluate(() => window.isSecureContext), false);
      assert.equal(await toggle().isDisabled(), true);
      await hint().waitFor();
      await page.getByRole("button", { name: "如何开启", exact: true }).click();
      await dialog().waitFor();
      assert.equal(await dialog().getByRole("button", { name: /方式一/ }).getAttribute("aria-pressed"), "true");
      assert.equal(await dialog().getByText("选择一种方式即可，无需同时设置。", { exact: true }).isVisible(), true);
      assert.equal(await dialog().getByRole("button", { name: "Chrome", exact: true }).count(), 0, "HTTPS instructions do not include browser flags");
      await dialog().getByRole("button", { name: /方式二/ }).click();
      assert.equal(await dialog().getByText("向管理员获取 HTTPS 地址", { exact: true }).count(), 0);
      assert.equal(await dialog().locator("code").last().textContent(), url, "copy the actual origin, without a path or hard-coded IP");
      await dialog().getByRole("button", { name: "Edge", exact: true }).click();
      assert.match(await dialog().locator("code").first().textContent(), /^edge:\/\/flags/);
      await dialog().getByRole("button", { name: "复制当前站点地址", exact: true }).click();
      await dialog().getByText("已复制。", { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.notificationFixture.copies.at(-1)), { value: url, modal: true }, "HTTP copy fallback must remain inside the native modal");
      await dialog().getByRole("button", { name: "重新检测", exact: true }).click();
      await dialog().getByText("当前连接仍不满足要求，请完成所选方式的设置后重试。", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.notificationFixture.requests), 0, "help and recheck never request permission");
      assert.equal(writes.length, 0, "unavailable notifications must not change account preferences");
      for (let count = 0; count < 15; count++) { await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => !!document.activeElement.closest("dialog[open]")), true); }
      await page.keyboard.press("Escape");
      assert.equal(await dialog().count(), 0);
      assert.equal(await page.getByRole("button", { name: "如何开启", exact: true }).evaluate(element => document.activeElement === element), true);
    }
    // History navigation must close a modal owned by the hidden profile section.
    await page.getByRole("button", { name: "账号安全", exact: true }).click();
    await page.getByRole("button", { name: "资料与偏好", exact: true }).click();
    await page.getByRole("button", { name: "如何开启", exact: true }).click();
    await dialog().waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "账号安全", exact: true }).waitFor();
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.getByRole("button", { name: "资料与偏好", exact: true }).click();
    await toggle().waitFor();
    assert.equal(await dialog().count(), 0, "returning to the profile must not reopen help");

    // The browser's secure-context result takes precedence over an HTTP/IP label.
    await page.evaluate(() => { window.notificationFixture.secure = true; window.dispatchEvent(new Event("focus")); });
    await hint().waitFor({ state: "detached" });
    assert.equal(await toggle().isDisabled(), false, "a browser exception supports permission requests");
    await toggle().click();
    await page.waitForFunction(() => document.querySelector('.notification-switch').getAttribute('aria-checked') === 'true');
    assert.equal(writes.at(-1).body.notificationsEnabled, true);
    for (const url of ["https://devloom.example.test", "https://192.0.2.64:4317", "http://127.0.0.1:4317", "http://[::1]:4317"]) {
      await navigate(url);
      assert.equal(await page.evaluate(() => window.isSecureContext), true);
      assert.equal(await hint().count(), 0);
      assert.equal(await toggle().isDisabled(), false);
    }
    await page.evaluate(() => { window.notificationFixture.permission = "denied"; window.dispatchEvent(new Event("focus")); });
    assert.equal(await toggle().isDisabled(), true);
    await page.getByText("当前连接符合要求。请在地址栏左侧的网站设置中允许通知，然后刷新页面。", { exact: true }).waitFor();
    assert.equal(await hint().count(), 0);
    await page.evaluate(() => { delete window.Notification; window.dispatchEvent(new Event("focus")); });
    await page.getByText("当前浏览器不支持系统桌面通知。", { exact: true }).waitFor();
    assert.equal(await toggle().isDisabled(), true);
    await navigate("http://192.0.2.64:4317");
    await page.evaluate(() => { delete window.Notification; window.dispatchEvent(new Event("focus")); });
    await hint().waitFor();
    assert.equal(await page.getByText("当前浏览器不支持系统桌面通知。", { exact: true }).count(), 0, "an insecure context is explained before API support");

    for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
      await page.setViewportSize({ width, height });
      await navigate("http://192.0.2.64:4317");
      await page.getByRole("button", { name: "如何开启", exact: true }).click();
      await dialog().waitFor();
      for (const method of ["https", "temporary"]) {
        await dialog().getByRole("button", { name: method === "https" ? /方式一/ : /方式二/ }).click();
        assert.equal(await dialog().evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `${width} ${method} dialog overflow`);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: path.join(output, `${width}-${method}.png`), animations: "disabled" });
      }
    }
    for (const [width, height] of [[1280,900],[390,844],[320,740]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { localStorage.setItem("web-coding.locale", "en"); localStorage.setItem("web-coding.theme", "dark"); });
      await page.reload();
      await page.getByRole("button", { name: "How to enable", exact: true }).click();
      const englishDialog = page.getByRole("dialog", { name: "Enable desktop notifications", exact: true });
      await englishDialog.getByRole("button", { name: /Method 2/ }).click();
      assert.equal(await englishDialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `${width}-english-dark.png`), animations: "disabled" });
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

module.exports = { verifyDesktopNotifications };
