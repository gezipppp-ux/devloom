/* global document, window, localStorage, getComputedStyle */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { projectVisual } = require("../fixtures/project-visual.cjs");
const { selectOption, selectValue, selectPreference } = require("../support/select.cjs");

async function verifyProjectSpaceProgress({ browser, output }) {
  output = path.join(output, "space-preparation"); fs.mkdirSync(output, { recursive: true });
  const fixture = projectVisual("space-fixture"), projectPath = `/projects/${fixture.projectId}`;
  const origin = "http://127.0.0.1:49029", dist = path.resolve(__dirname, "../../web/dist");
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [], posts = [], unexpected = [];
  let space = { id: "personal-space", projectId: fixture.projectId, userId: "visual-admin", status: "awaiting_credentials", revision: 1 };
  let postMode = "normal", getMode = "normal", releasePost, releaseRetryPost, reachPost, reachRetryPost, projectSnapshot, longRemote = false;
  const started = new Promise(resolve => { reachPost = resolve; });
  const retryStarted = new Promise(resolve => { reachRetryPost = resolve; });
  const gate = new Promise(resolve => { releasePost = resolve; });
  const accounts = [{ id: "personal-git", name: "我的开发账号", host: "https://git.example.test", authType: "http" }];
  const setProgress = (stage, percent, age = 0) => {
    space = { ...space, progress: { stage, percent, startedAt: new Date(Date.now() - 138000).toISOString(), updatedAt: new Date(Date.now() - age).toISOString() } };
  };
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.EventSource = class { addEventListener() {} close() {} };
    localStorage.setItem("web-coding.locale", "zh-CN");
  });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (endpoint.startsWith("/api/")) {
      if (endpoint === "/api/auth/session") return send({ user: { id: "visual-admin", username: "visual-admin", displayName: "林晓", role: "admin", status: "active", mustChangePassword: false }, token: "fixture", settings: {} });
      if (endpoint === "/api/bootstrap") return send({ token: "fixture", workspaces: [] });
      if (endpoint.endsWith("/events")) return route.fulfill({ status: 204, body: "" });
      if (endpoint.endsWith("/account/preferences")) return send({ preferences: { unreadRunKeys: [] } });
      if (endpoint === "/api/account/git-accounts") return send({ accounts });
      if (endpoint === `/api${projectPath}/space/prepare`) {
        const input = request.postDataJSON(); posts.push(input);
        if (postMode === "hold") { reachPost(); await gate; }
        if (postMode === "retry-hold") await new Promise(resolve => { releaseRetryPost = resolve; reachRetryPost(); });
        if (postMode === "lost-unaccepted") return route.abort("connectionfailed");
        if (space.requestId !== input.requestId) {
          space = { ...space, status: "preparing", revision: space.revision + 1, requestId: input.requestId, gitAccountId: input.gitAccountId, error: null };
          setProgress("validating", null);
        }
        if (postMode === "lost-accepted") return route.abort("connectionfailed");
        return send({ space }, 202);
      }
      if (endpoint === `/api${projectPath}/space`) {
        if (getMode === "offline") return route.abort("connectionfailed");
        if (getMode === "denied") return send({ error: "当前账号没有此项目操作权限。" }, 403);
        return send({ space });
      }
      if (endpoint === `/api${projectPath}`) {
        const result = fixture.response(url);
        return send({ ...result, project: { ...result.project, ...(longRemote ? { remoteUrl: "https://git.example.test/platform/enterprise-development-collaboration-and-customer-services.git" } : {}) }, space: projectSnapshot || space });
      }
      const result = fixture.response(url);
      if (result) return send(result);
      unexpected.push(endpoint); return send({ error: "Unimplemented fixture" }, 404);
    }
    if (endpoint.startsWith("/assets/")) {
      const file = path.resolve(dist, "." + endpoint); assert.ok(file.startsWith(dist + path.sep));
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith(".js") ? "text/javascript" : "text/css" });
    }
    return route.fulfill({ body: fs.readFileSync(path.join(dist, "index.html")), contentType: "text/html" });
  });
  try {
    await page.goto(origin + projectPath + "?tab=development");
    const create = page.getByRole("button", { name: "创建工作空间", exact: true });
    await create.waitFor(); assert.equal(await create.isDisabled(), true);
    await selectOption(page.getByRole("combobox", { name: "个人 Git 账号", exact: true }), "personal-git");
    postMode = "hold"; await create.click(); await started;
    await page.getByRole("heading", { name: "正在提交创建请求", exact: true }).waitFor();
    assert.equal(await page.locator(".space-progress-title").evaluate(node => node === document.activeElement), true, "submission keeps keyboard focus at the progress feedback");
    assert.equal(await create.count(), 0, "submission immediately replaces the form");
    await page.screenshot({ path: path.join(output, "submitting.png"), fullPage: true });
    releasePost(); postMode = "normal";
    await page.getByRole("heading", { name: "正在验证仓库访问", exact: true }).waitFor();
    const validating = structuredClone(space);
    assert.equal(await page.locator(".space-indeterminate[aria-valuenow]").count(), 0, "unknown duration has no fake percentage");
    setProgress("receiving", 64);
    await page.getByRole("heading", { name: "正在下载项目代码", exact: true }).waitFor();
    assert.equal(await page.locator(".space-progress progress").getAttribute("value"), "64");
    projectSnapshot = validating;
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === `/api${projectPath}`), page.getByRole("button", { name: "刷新项目", exact: true }).click()]);
    assert.equal(await page.locator(".space-progress progress").getAttribute("value"), "64", "an older project snapshot cannot replace fresher progress");
    projectSnapshot = undefined;
    for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `space preparation fits ${width}`);
      await page.screenshot({ path: path.join(output, `preparing-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "先浏览项目", exact: true }).click();
    await page.waitForURL(url => url.searchParams.get("tab") === "overview");
    await page.goto(origin + projectPath + "?tab=development");
    await page.getByRole("heading", { name: "正在下载项目代码", exact: true }).waitFor();
    assert.equal(posts.length, 1, "refresh and returning only query the accepted request");
    getMode = "offline";
    await page.getByRole("heading", { name: "暂时无法获取进度", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "offline.png"), fullPage: true });
    getMode = "normal";
    await page.getByRole("button", { name: "重新连接并确认", exact: true }).click();
    await page.getByRole("heading", { name: "正在下载项目代码", exact: true }).waitFor();
    assert.equal(posts.length, 1);
    setProgress("receiving", 64, 65000); await page.reload();
    await page.getByRole("heading", { name: "暂未收到新的进度", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "slow.png"), fullPage: true });
    setProgress("checkout", 18);
    await page.getByRole("heading", { name: "正在整理项目文件", exact: true }).waitFor();
    assert.equal(await page.locator(".space-progress progress").getAttribute("value"), "18");
    space = { ...space, status: "failed", revision: 3, error: "仓库连接失败，请检查网络后重试。", updatedAt: new Date().toISOString() };
    await page.getByRole("heading", { name: "工作空间准备失败", exact: true }).waitFor();
    assert.equal(await selectValue(page.getByRole("combobox", { name: "个人 Git 账号", exact: true })), "personal-git");
    await page.screenshot({ path: path.join(output, "failed.png"), fullPage: true });
    postMode = "retry-hold";
    await page.getByRole("button", { name: "重新尝试", exact: true }).click();
    await retryStarted;
    await page.getByRole("heading", { name: "正在提交创建请求", exact: true }).waitFor();
    assert.equal(await page.locator(".space-alert").count(), 0, "a new retry must not present the previous attempt as failed");
    assert.equal(await page.locator(".space-indeterminate").count(), 1);
    await page.screenshot({ path: path.join(output, "retry-submitting.png"), fullPage: true });
    postMode = "lost-accepted"; releaseRetryPost();
    await page.getByRole("heading", { name: "暂时无法获取进度", exact: true }).waitFor();
    assert.equal(await page.locator(".space-alert").count(), 0, "an unknown retry result cannot inherit the previous failure");
    await page.getByRole("heading", { name: "正在验证仓库访问", exact: true }).waitFor();
    assert.equal(posts.length, 2, "a lost accepted response is recovered with GET");
    assert.notEqual(posts[0].requestId, posts[1].requestId, "explicit retry gets a new identity");
    space = { ...space, status: "awaiting_credentials", revision: 5, requestId: null, progress: null };
    await page.reload(); postMode = "lost-unaccepted";
    await page.getByRole("button", { name: "创建工作空间", exact: true }).click();
    await page.getByRole("heading", { name: "暂时无法获取进度", exact: true }).waitFor();
    postMode = "normal";
    await page.getByRole("button", { name: "重新连接并确认", exact: true }).click();
    await page.getByRole("heading", { name: "正在验证仓库访问", exact: true }).waitFor();
    assert.deepEqual(posts[2], posts[3], "explicit confirmation reuses exactly the original request");
    space = { ...space, status: "ready", revision: 7, workspaceId: "space-fixture", updatedAt: new Date().toISOString() };
    await page.getByRole("heading", { name: "工作空间准备好了", exact: true }).waitFor();
    await page.getByRole("button", { name: "打开开发工作台", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "ready.png"), fullPage: true });
    space = { ...space, status: "preparing", revision: 8 }; setProgress("receiving", 64);
    await page.reload();
    await page.getByRole("heading", { name: "正在下载项目代码", exact: true }).waitFor();
    await page.getByText("查看准备详情", { exact: true }).click();
    await page.screenshot({ path: path.join(output, "details.png"), fullPage: true });
    longRemote = true; await page.reload();
    await page.getByRole("heading", { name: "正在下载项目代码", exact: true }).waitFor();
    await selectPreference(page, "locale", "en");
    await page.getByRole("heading", { name: "Downloading project code", exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 740 });
    await page.screenshot({ path: path.join(output, "english-320.png"), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator(".space-spinner").evaluate(node => getComputedStyle(node).animationName), "none");
    await selectPreference(page, "locale", "zh-CN");
    await selectPreference(page, "theme", "dark");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(output, "dark.png"), fullPage: true });
    await selectPreference(page, "theme", "light");
    getMode = "denied";
    await page.getByText("当前账号没有此项目操作权限。", { exact: true }).waitFor();
    assert.equal(await page.locator(".space-progress").count(), 0, "permission loss clears progress and actions");
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  } finally { releasePost(); releaseRetryPost?.(); await context.close(); }
}

module.exports = { verifyProjectSpaceProgress };
