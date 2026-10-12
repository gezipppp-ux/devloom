/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { readOptional } = require("../../src/storage/json-files.cjs");
const { seedWorkspaceProject } = require("../support/workspace-project.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary, png, json } = require("../support/helpers.cjs");
const { verifyLateImageUpload } = require("./session-images.test.cjs");
const { verifyPromptSettings } = require("./prompt-settings.test.cjs");
const { verifyWorkspaceNavigation } = require("./workspace-navigation.test.cjs");
const { verifySystemSettings } = require("./system-settings.test.cjs");
const { verifyGit } = require("./git.test.cjs");
const { fixtureWorkspaceClones } = require("../support/workspace-clones.cjs");
const { navigateWorkspace } = require("../support/browser-navigation.cjs");

async function main() {
  const cleanup = [];
  const directory = temporary({ after: (callback) => cleanup.push(callback) });
  const repository = path.join(directory, "repo");
  fs.mkdirSync(repository);
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], {
      windowsHide: true,
      stdio: "ignore",
    });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "README.md"), "fixture");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "fixture",
  );
  require("../support/baseline-origin.cjs").attachOrigin(repository);
  const workspaces = new WorkspaceManager({
    directory: path.join(directory, "workspaces"),
    createManager: (options) =>
      new SessionManager({ ...options, client: new FakeClient() }),
  });
  const saveWorkspace = workspaces.save.bind(workspaces);
  workspaces.save = async (input, id) => {
    const workspace = await saveWorkspace(input, id);
    if (!id) {
      await seedWorkspaceProject(workspaces.configFile(workspace.id), repository);
      await require("../../src/config/execution-settings.cjs").saveSettings({ baseBranch: "main" }, workspaces.configFile(workspace.id));
    }
    return workspace;
  };
  const application = createWebServer({ workspaces, workspaceClones: fixtureWorkspaceClones(workspaces), testIdentity: true });
  const origin = await application.listen(0);
  const originalFetch = global.fetch;
  let checks = 0;
  global.fetch = async (url, options) => {
    if (new URL(url).origin !== "https://www.tapd.cn")
      return originalFetch(url, options);
    checks++;
    assert.match(String(url), /get_my_worktable_by_page/);
    return options.headers.cookie.includes("expired")
      ? new Response("<html>Login</html>")
      : json({ workitem_list: [] });
  };
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.BROWSER_CHANNEL
        ? { channel: process.env.BROWSER_CHANNEL }
        : process.platform === "win32"
          ? { channel: "msedge" }
          : {}),
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/account/git-accounts", route => route.fulfill({ json: { accounts: [{ id: "fixture-account", name: "临时 Git", authType: "http", remoteUrl: "http://git.example.test/team/project.git" }] } }));
    const a = await workspaces.save({ name: "项目 A" });
    const b = await workspaces.save({ name: "项目 B", icon: "experiment" });
    await page.goto(`${origin}/?workspace=${a.id}`);
    const bootstrap = await (await page.request.get(`${origin}/api/bootstrap`)).json();
    const systemSettings = await page.request.post(`${origin}/api/system/settings`, {
      headers: { origin, "x-tapd-token": bootstrap.token },
      data: { memberStorageRoot: path.join(directory, "trees") },
    });
    assert.equal(systemSettings.status(), 200);
    await page.getByRole("heading", { name: "项目 A · 工作区设置" }).waitFor();
    const output = path.resolve("state", "browser");
    fs.mkdirSync(output, { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      const bottom = await page
        .getByRole("combobox", { name: "新任务开发分支", exact: true })
        .evaluate(
          (el) => el.closest(".ant-select").getBoundingClientRect().bottom,
        );
      const hint = await page.getByText(/可搜索已获取的 origin 分支/).boundingBox();
      assert.ok(
        hint.y >= bottom + 7,
        "base ref hint must sit below the selector",
      );
    }
    await page
      .locator(".ant-form-item")
      .filter({ has: page.getByRole("combobox", { name: "新任务开发分支", exact: true }) })
      .screenshot({ path: path.join(output, "base-ref-spacing.png") });
    assert.equal(await page.getByRole("button", { name: "＋ 新建工作区", exact: true }).count(), 0);
    assert.equal(await page.getByLabel("项目代码仓库路径", { exact: true }).innerText(), repository);
    assert.equal(await page.getByRole("textbox", { name: "工作区 Worktree 目录", exact: true }).count(), 0);
    await page.getByLabel("Worktree 初始化命令", { exact: true }).fill('node -e "process.exit(0)"');
    assert.equal(
      await page.getByLabel("Codex 模型", { exact: true }).count(),
      0,
    );
    assert.equal(await page.getByLabel("思考强度", { exact: true }).count(), 0);
    await page
      .getByRole("button", { name: "保存执行设置", exact: true })
      .click();
    await page
      .getByText("设置已保存，新任务将使用此配置。", { exact: true })
      .waitFor();
    await page.getByLabel("TAPD 项目 ID", { exact: true }).fill("42");
    await page
      .getByLabel("TAPD Cookie", { exact: true })
      .fill("dsc-token=valid-fixture; auth=private");
    await page.getByRole("button", { name: "检测连接", exact: true }).click();
    await page
      .getByText("Cookie 可用，TAPD 待办接口访问成功。检测不会保存配置。", {
        exact: true,
      })
      .waitFor();
    assert.equal((await readOptional(workspaces.configFile(a.id))).tapd, undefined);
    await page
      .getByRole("button", { name: "保存 TAPD 配置", exact: true })
      .click();
    await page.getByText("TAPD 配置已保存。", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("TAPD Cookie", { exact: true }).inputValue(),
      "",
    );
    await page
      .getByLabel("TAPD Cookie", { exact: true })
      .fill("dsc-token=expired");
    await page.getByRole("button", { name: "检测连接", exact: true }).click();
    await page
      .getByText(
        "检测失败：Cookie 已失效、项目不可访问或网络异常，请检查后重试。",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      (await readOptional(workspaces.configFile(a.id))).tapd.session.cookie_header,
      "dsc-token=valid-fixture; auth=private",
    );
    await page.getByLabel("TAPD Cookie", { exact: true }).fill("");
    await page.getByRole("button", { name: "检测连接", exact: true }).click();
    await page
      .getByText("Cookie 可用，TAPD 待办接口访问成功。检测不会保存配置。", {
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: path.join(output, "workspace-settings.png"),
      fullPage: true,
    });
    await navigateWorkspace(page, b);
    await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
    const defaultPage = await browser.newPage();
    defaultPage.on("pageerror", (error) => errors.push(error.message));
    let documentRequests = 0;
    defaultPage.on("request", (request) => {
      if (request.resourceType() === "document") documentRequests++;
    });
    await defaultPage.addInitScript(() => {
      window.history.replaceState({ fixture: "keep-state" }, "", window.location.href);
    });

    try {
      await defaultPage.goto(`${origin}/?workspace=${a.id}&fixture=keep-query#keep-fragment`);
      await defaultPage.getByRole("heading", { name: "项目 A · 工作区设置" }).waitFor();
      const defaultUrl = new URL(defaultPage.url());
      assert.equal(defaultUrl.searchParams.get("workspace"), a.id);
      assert.equal(defaultUrl.searchParams.get("fixture"), "keep-query");
      assert.equal(defaultUrl.hash, "#keep-fragment");
      assert.equal(await defaultPage.evaluate(() => window.history.state.fixture), "keep-state");
      assert.equal(documentRequests, 1, "canonical workspace URL must not navigate again");
      await verifyWorkspaceNavigation(defaultPage, {
        workspaceA: a, workspaceB: b, repository, output,
      });
      (await workspaces.save({ name: "0 排序在前的工作区" }, b.id));
      assert.equal((await workspaces.list())[0].id, b.id);
      await defaultPage.reload();
      await defaultPage.getByRole("heading", { name: "项目 A · 工作区设置" }).waitFor();
      assert.equal(new URL(defaultPage.url()).searchParams.get("workspace"), a.id);
      assert.equal(new URL(page.url()).searchParams.get("workspace"), b.id);
    } finally {
      (await workspaces.save({ name: "项目 B" }, b.id));
      await defaultPage.close();
    }

    await navigateWorkspace(page, a);
    await page.getByRole("heading", { name: "项目 A · 工作区设置" }).waitFor();
    assert.equal(
      await page.getByLabel("Codex 模型", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByLabel("TAPD Cookie", { exact: true }).inputValue(),
      "",
    );
    await page
      .getByRole("button", { name: "＋ 从需求启动", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("TAPD 项目 ID", { exact: true }).inputValue(),
      "42",
    );
    assert.equal(
      await page
        .getByLabel("TAPD 项目 ID", { exact: true })
        .getAttribute("readonly"),
      "",
    );
    assert.equal(
      await page.getByLabel("Codex 模型", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page.getByLabel("思考强度", { exact: true }).inputValue(),
      "",
    );
    await page
      .getByLabel("Codex 模型", { exact: true })
      .selectOption("fixture-model-a");
    await page.getByLabel("思考强度", { exact: true }).selectOption("high");
    await page.getByRole("combobox", { name: "权限模式", exact: true }).click();
    await page.locator('.permission-option[data-value="auto"]').click();
    await page
      .getByLabel("Codex 模型", { exact: true })
      .selectOption("fixture-model-b");
    assert.equal(
      await page.getByLabel("思考强度", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page
        .getByLabel("思考强度", { exact: true })
        .locator('option[value="high"]')
        .count(),
      0,
    );
    await page
      .getByLabel("Codex 模型", { exact: true })
      .selectOption("fixture-model-a");
    await page.getByLabel("思考强度", { exact: true }).selectOption("high");
    await page.route("**/models", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "模拟模型列表离线" }),
      }),
    );
    await page
      .getByRole("button", { name: "刷新模型列表", exact: true })
      .click();
    await page.locator('.operation-message[data-type="error"]').filter({ hasText: '模型列表加载失败：模拟模型列表离线' }).waitFor();
    assert.equal(
      await page.getByLabel("Codex 模型", { exact: true }).inputValue(),
      "fixture-model-a",
    );
    assert.equal(
      await page.getByLabel("思考强度", { exact: true }).inputValue(),
      "high",
    );
    await page.unroute("**/models");
    await page
      .getByRole("button", { name: "刷新模型列表", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('select[aria-label="思考强度"]')?.disabled ===
        false,
    );
    await page.getByLabel("需求渠道", { exact: true }).selectOption("manual");
    await page.getByLabel("任务类型", { exact: true }).selectOption("bug");
    await page
      .getByLabel("需求标题", { exact: true })
      .fill("工作区 A 的独立任务");
    await page
      .getByLabel("需求内容", { exact: true })
      .fill("验证工作区图片和会话隔离");
    await page.getByLabel("需求图片", { exact: true }).setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page
      .getByRole("button", { name: "移除图片 1", exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(output, "codex-model-settings.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "创建 session 并开始开发 →", exact: true })
      .click();
    await page.getByRole("textbox", { name: "发送给 Codex 的指令" }).waitFor();
    await page.getByText("历史回复", { exact: true }).waitFor();
    await page.getByRole("button", { name: "需求资料", exact: true }).click();
    const image = page
      .locator(".requirement-images img, .requirement-details img")
      .first();
    // Every run attachment URL must carry the application workspace ID.
    await page.waitForFunction(
      (id) =>
        [...document.querySelectorAll("img")].some(
          (img) =>
            img.src.includes(`/api/workspaces/${id}/runs/`) &&
            img.complete &&
            img.naturalWidth > 0,
        ),
      a.id,
    );
    if (await image.count())
      assert.match(await image.getAttribute("src"), new RegExp(a.id));
    const aContext = (await workspaces.get(a.id));
    const key = (await aContext.sessions.list())[0].key;
    assert.equal(
      aContext.sessions.client.calls.find(
        (entry) => entry.method === "turn/start",
      ).params.effort,
      "high",
    );
    assert.equal(aContext.sessions.client.calls.find(
      (entry) => entry.method === "turn/start",
    ).params.approvalsReviewer, "auto_review");
    assert.deepEqual((await aContext.sessions.store.readTaskMetadata(key)), {
      type: "bug",
      progress: "in_progress",
    });
    await page.getByRole("button", { name: "会话信息", exact: true }).click();
    await page.getByLabel("任务进度", { exact: true }).selectOption("review");
    await page.waitForFunction(
      () =>
        document.querySelector('select[aria-label="任务进度"]').value ===
        "review",
    );
    await page.getByLabel("任务分组方式").selectOption("progress");
    assert.ok(aContext.sessions.sessions.get(key).turnId);
    await navigateWorkspace(page, b);
    await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
    assert.equal(await page.locator(".session-link").count(), 0);
    assert.equal(await page.getByLabel("任务分组方式").inputValue(), "progress", "grouping belongs to the account and follows it across workspaces");
    assert.ok(
      aContext.sessions.sessions.get(key).turnId,
      "switching workspace must not stop background execution",
    );
    await page.reload();
    await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
    await navigateWorkspace(page, a);
    await page.getByText("历史回复", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("任务分组方式").inputValue(),
      "progress",
    );
    assert.equal(
      await page.getByLabel("任务进度", { exact: true }).inputValue(),
      "review",
    );
    assert.equal(
      await page
        .getByRole("combobox", { name: "Codex 模型", exact: true })
        .getAttribute("data-model"),
      "fixture-model-a",
    );
    await page.getByRole("combobox", { name: "权限模式", exact: true }).click();
    assert.equal(await page.locator('.permission-option[data-value="auto"]').getAttribute('aria-selected'), 'true');
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "■ 停止", exact: true }).click();
    await page.getByRole("button", { name: "会话信息", exact: true }).click();
    await page
      .locator(".session-context")
      .getByText("fixture-model-a", { exact: true })
      .waitFor();
    await page
      .locator(".session-context")
      .getByText("high", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "＋ 从需求启动", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("Codex 模型", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page.getByLabel("思考强度", { exact: true }).inputValue(),
      "",
    );
    await page.getByRole("combobox", { name: "权限模式", exact: true }).click();
    assert.equal(await page.locator('.permission-option[data-value="ask"]').getAttribute('aria-selected'), 'true');
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: path.join(output, "workspace-rail-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(output, "workspaces-mobile.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.locator(".session-link").filter({ hasText: "工作区 A 的独立任务" }).click();
    await page.getByText("历史回复", { exact: true }).waitFor();
    await verifyLateImageUpload(page, {
      pattern: `**/api/workspaces/${a.id}/runs/${key}/message-images`,
      leave: async () => {
        await navigateWorkspace(page, b);
        await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
      },
      reopen: async () => {
        await navigateWorkspace(page, a);
        await page.getByText("历史回复", { exact: true }).waitFor();
      },
    });
    assert.equal(checks, 3);
    const promptWorkspaceA = (await workspaces.save({ name: "提示词配置 A" }));
    const promptWorkspaceB = (await workspaces.save({ name: "提示词配置 B" }));
    await verifyPromptSettings(browser, {
      origin, output, errors, workspaceA: promptWorkspaceA, workspaceB: promptWorkspaceB,
    });
    const systemWorkspace = (await workspaces.save({ name: "Worktree 目录配置" }));
    await verifySystemSettings(browser, {
      origin, output, errors, directory, repository, workspace: systemWorkspace,
    });
    await verifyGit(browser, { origin, output, errors, directory, workspaces });

    assert.deepEqual(errors, []);
    process.stdout.write(
      "Workspace browser passed: project space routing, scoped settings, manual runs, attachments, Git fetch/fast-forward/divergence, unpublished/ahead/dirty status, confirmed worktree deletion, read-only history and mobile.\n",
    );
  } finally {
    await browser?.close();
    await application.close();
    global.fetch = originalFetch;
    for (const callback of cleanup.reverse()) await callback();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
