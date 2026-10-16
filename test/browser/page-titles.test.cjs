/* global document, window, localStorage, navigator, PopStateEvent, Event */
const assert = require("node:assert/strict");
const { projectVisual } = require("../fixtures/project-visual.cjs");
const { selectOption, selectPreference } = require("../support/select.cjs");

async function titleIs(page, expected) {
  await page.waitForFunction(value => document.title === value, expected, { timeout: 10000 })
    .catch(async () => assert.equal(await page.title(), expected));
}

async function verifyPageTitles(browser, origin) {
  const context = await browser.newContext({ locale: "zh-CN" });
  const fixture = projectVisual("title-workspace");
  const projectPath = `/projects/${fixture.projectId}`;
  const project = fixture.response(new URL(origin + "/api" + projectPath)).project;
  const issue = fixture.response(new URL(origin + "/api" + projectPath + "/issues/search"));
  const errors = [];
  let user = { id: "visual-admin", username: "preview", displayName: "预览", role: "admin", status: "active", mustChangePassword: false };
  let releaseIssue, holdIssue = false;
  await context.route("**/api/**", async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname;
    const send = (json, status = 200) => route.fulfill({ json, status });
    if (endpoint === "/api/auth/session") return send({ user, token: "fixture", settings: {} });
    if (endpoint === "/api/auth/logout") { user = null; return send({ ok: true }); }
    if (endpoint === "/api/bootstrap") return send({ token: "fixture", workspaces: [] });
    if (endpoint === "/api/account/preferences") return send({ preferences: { unreadRunKeys: [] } });
    if (endpoint.endsWith("/issues/search") && holdIssue) {
      holdIssue = false;
      releaseIssue = () => send(issue);
      return;
    }
    if (endpoint.endsWith("/issues/missing")) return send({ error: "事项不存在。" }, 404);
    if (endpoint.endsWith("/deliveries/delivery-1")) return send({
      delivery: { id: "delivery-1", title: "搜索体验交付", status: "pending", checklist: [], checkedItems: [], body: "fixture" },
      people: [], permissions: [], canReview: false,
    });
    if (endpoint === "/api/account/models") return send({ models: [] });
    if (endpoint === "/api/account/execution-options") return send({ permissionModes: [], agent: { label: "Codex" } });
    if (endpoint === "/api/account/git-accounts") return send({ accounts: [] });
    const value = fixture.response(url);
    return value ? send(value) : send({ error: "Fixture endpoint unavailable" }, 404);
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const navigate = async (location, title) => {
    await page.evaluate(path => { window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); }, location);
    await titleIs(page, title + " · DevLoom");
  };
  try {
    await page.goto(origin);
    await titleIs(page, "工作台 · DevLoom");
    for (const [location, title] of [
      ["/projects", "项目"], ["/issues", "事项"], ["/development", "开发"], ["/deliveries", "交付"],
      [projectPath, "客户管理系统"], [projectPath + "?tab=members", "客户管理系统 · 成员"],
      [projectPath + "?tab=issues&issue=search", "优化客户搜索体验 · 事项"],
      [projectPath + "?tab=bugs&issue=export", "修复导出结果与筛选条件不一致 · 事项"],
      [projectPath + "?tab=releases&release=release-1", "v0.2 · 版本"],
      [projectPath + "?tab=assets&asset=guide", "联调与验收说明 · 项目资产"],
      [projectPath + "?tab=tasks&task=search-task", "客户搜索与空结果提示 · 开发任务"],
      [`/deliveries?projectId=${fixture.projectId}&delivery=delivery-1`, "搜索体验交付 · 交付"],
      ["/personal?tab=security", "账号安全 · 个人设置"], ["/accounts", "账号管理 · 管理中心"],
      ["/work?bucket=doing", "处理中 · 工作台"],
    ]) await navigate(location, title);
    await navigate(projectPath + "?tab=issues&issue=search", "优化客户搜索体验 · 事项");
    await selectPreference(page, "locale", "en");
    await titleIs(page, "优化客户搜索体验 · Issues · DevLoom");
    await page.reload();
    await titleIs(page, "优化客户搜索体验 · Issues · DevLoom");
    await selectPreference(page, "locale", "zh-CN");
    await navigate(projectPath + "?tab=issues&issue=missing", "事项");
    await page.getByText("事项不存在。", { exact: true }).waitFor();
    holdIssue = true;
    const requested = page.waitForRequest("**/api" + projectPath + "/issues/search");
    await navigate(projectPath + "?tab=issues&issue=search", "事项");
    await requested;
    await navigate(projectPath, "客户管理系统");
    await releaseIssue();
    releaseIssue = null;
    await titleIs(page, "客户管理系统 · DevLoom");
    project.name = "重命名的项目";
    await page.getByRole("button", { name: "刷新项目", exact: true }).click();
    await titleIs(page, "重命名的项目 · DevLoom");
    await navigate("/does-not-exist", "页面不存在");
    await navigate(projectPath, "重命名的项目");
    // Account expiry is handled by the same API/session invalidation as logout.
    user = null;
    await page.reload();
    await titleIs(page, "登录 · DevLoom");
    assert.deepEqual(errors, []);
  } finally {
    if (releaseIssue) await releaseIssue().catch(() => {});
    await context.close();
  }
}

async function verifyAutomaticLocale(browser, origin) {
  for (const [locale, expected] of [["zh-CN", "zh-CN"], ["zh-TW", "zh-CN"], ["en-US", "en"], ["de-DE", "en"]]) {
    const context = await browser.newContext({ locale });
    await context.route("**/api/auth/session", route => route.fulfill({ json: { user: null, token: "fixture" } }));
    const page = await context.newPage();
    try {
      await page.goto(origin + "/login");
      await page.locator(".authentication-card").waitFor();
      assert.equal(await page.locator("html").getAttribute("lang"), expected);
      assert.equal(await page.evaluate(() => localStorage.getItem("web-coding.locale")), "auto");
      await titleIs(page, (expected === "en" ? "Sign in" : "登录") + " · DevLoom");
      if (locale !== "zh-CN") continue;
      await page.locator('input[autocomplete="username"]').fill("保留草稿");
      await selectOption(page.locator(".ui-locale"), "en");
      assert.equal(await page.locator('input[autocomplete="username"]').inputValue(), "保留草稿");
      assert.equal(await page.evaluate(() => localStorage.getItem("web-coding.locale")), "en");
      await page.reload();
      await titleIs(page, "Sign in · DevLoom");
      const peer = await context.newPage();
      await peer.goto(origin + "/login");
      await titleIs(peer, "Sign in · DevLoom");
      await selectOption(page.locator(".ui-locale"), "auto");
      await titleIs(peer, "登录 · DevLoom");
      await page.evaluate(() => {
        Object.defineProperty(navigator, "languages", { configurable: true, value: ["fr-FR", "zh-CN"] });
        window.dispatchEvent(new Event("languagechange"));
      });
      await titleIs(page, "Sign in · DevLoom");
      await selectOption(page.locator(".ui-locale"), "zh-CN");
      await page.evaluate(() => window.dispatchEvent(new Event("languagechange")));
      await titleIs(page, "登录 · DevLoom");
      await page.evaluate(() => localStorage.clear());
      await titleIs(peer, "登录 · DevLoom");
    } finally { await context.close(); }
  }
}

module.exports = { verifyPageTitles, verifyAutomaticLocale, titleIs };
