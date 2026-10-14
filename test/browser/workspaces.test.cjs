const { selectOption, selectValue, selectOptions } = require("../support/select.cjs");
const { openSessionList, openSessionContext } = require("../support/browser-navigation.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { seedWorkspaceProject } = require("../support/workspace-project.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary, png } = require("../support/helpers.cjs");
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
      headers: { origin, "x-csrf-token": bootstrap.token },
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
    assert.equal(await page.getByText(/TAPD/).count(), 0);
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
    await page
      .getByRole("button", { name: "独立开发", exact: true })
      .click();
    assert.deepEqual((await selectOptions(page.getByLabel("需求渠道", { exact: true }))).map(option => option.value), ["manual"]);
    assert.equal(
      await selectValue(page.getByLabel("Codex 模型", { exact: true })),
      "",
    );
    assert.equal(
      await selectValue(page.getByLabel("思考强度", { exact: true })),
      "",
    );
    await selectOption(page
      .getByLabel("Codex 模型", { exact: true }), "fixture-model-a");
    await selectOption(page.getByLabel("思考强度", { exact: true }), "high");
    await page.getByRole("combobox", { name: "权限模式", exact: true }).click();
    await page.locator('.ant-select-item-option:has(.app-select-option[data-value="auto"])').click();
    await selectOption(page
      .getByLabel("Codex 模型", { exact: true }), "fixture-model-b");
    assert.equal(
      await selectValue(page.getByLabel("思考强度", { exact: true })),
      "",
    );
    assert.equal(
      (await selectOptions(page.getByLabel("思考强度", { exact: true }))).filter(option => option.value === "high").length,
      0,
    );
    await selectOption(page
      .getByLabel("Codex 模型", { exact: true }), "fixture-model-a");
    await selectOption(page.getByLabel("思考强度", { exact: true }), "high");
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
      await selectValue(page.getByLabel("Codex 模型", { exact: true })),
      "fixture-model-a",
    );
    assert.equal(
      await selectValue(page.getByLabel("思考强度", { exact: true })),
      "high",
    );
    await page.unroute("**/models");
    await page
      .getByRole("button", { name: "刷新模型列表", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('input[role="combobox"][aria-label="思考强度"]')?.disabled ===
        false,
    );
    await selectOption(page.getByLabel("需求渠道", { exact: true }), "manual");
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
    await openSessionContext(page, '需求资料');
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
    assert.ok(aContext.sessions.sessions.get(key).turnId);
    await navigateWorkspace(page, b);
    await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
    assert.equal(await page.locator(".session-link").count(), 0);
    assert.ok(
      aContext.sessions.sessions.get(key).turnId,
      "switching workspace must not stop background execution",
    );
    await page.reload();
    await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
    await navigateWorkspace(page, a);
    await page.getByText("历史回复", { exact: true }).waitFor();
    assert.equal(
      await selectValue(page.getByRole("combobox", { name: "Codex 模型", exact: true })),
      "fixture-model-a",
    );
    await page.getByRole("combobox", { name: "权限模式", exact: true }).click();
    assert.equal(await page.locator('.ant-select-item-option:has(.app-select-option[data-value="auto"])').getAttribute('aria-selected'), 'true');
    await page.getByRole("combobox", { name: "权限模式", exact: true }).press("Escape");
    await page.locator(".app-select-popup:visible").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "■ 停止", exact: true }).click();
    await openSessionContext(page, '会话信息');
    await page.locator(".session-context details summary").click();
    await page
      .locator(".session-context")
      .getByText("fixture-model-a", { exact: true })
      .waitFor();
    await page
      .locator(".session-context")
      .getByText("high", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "独立开发", exact: true })
      .click();
    assert.equal(
      await selectValue(page.getByLabel("Codex 模型", { exact: true })),
      "",
    );
    assert.equal(
      await selectValue(page.getByLabel("思考强度", { exact: true })),
      "",
    );
    await page.getByRole("combobox", { name: "权限模式", exact: true }).click();
    assert.equal(await page.locator('.ant-select-item-option:has(.app-select-option[data-value="ask"])').getAttribute('aria-selected'), 'true');
    await page.getByRole("combobox", { name: "权限模式", exact: true }).press("Escape");
    await page.locator(".app-select-popup:visible").waitFor({ state: "hidden" });
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
    await openSessionList(page);
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
    for (const callback of cleanup.reverse()) await callback();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
