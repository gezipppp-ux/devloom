/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { Workspaces } = require("../src/workspaces.cjs");
const { WebSessions } = require("../src/web_sessions.cjs");
const { createWebServer } = require("../src/web_server.cjs");
const { readOptional } = require("../src/settings.cjs");
const { FakeClient } = require("./fixtures/web_client.cjs");
const { temporary, png, json } = require("./helpers.cjs");

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
  const workspaces = new Workspaces({
    directory: path.join(directory, "workspaces"),
    createManager: (options) =>
      new WebSessions({ ...options, client: new FakeClient() }),
  });
  const application = createWebServer({ workspaces });
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
    await page.goto(origin);
    await page.getByLabel("工作区名称", { exact: true }).fill("项目 A");
    await page.getByRole("button", { name: "创建工作区", exact: true }).click();
    await page.getByRole("heading", { name: "项目 A · 工作区设置" }).waitFor();
    const a = workspaces.list()[0];
    const output = path.resolve("state", "browser");
    fs.mkdirSync(output, { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      const bottom = await page
        .getByRole("combobox", { name: "新任务基准引用", exact: true })
        .evaluate(
          (el) => el.closest(".ant-select").getBoundingClientRect().bottom,
        );
      const hint = await page.locator(".base-ref-hint").boundingBox();
      assert.ok(
        hint.y >= bottom + 7,
        "base ref hint must sit below the selector",
      );
    }
    await page
      .locator(".ant-form-item")
      .filter({ has: page.locator(".base-ref-hint") })
      .screenshot({ path: path.join(output, "base-ref-spacing.png") });
    const selectedWorkspace = page.getByRole("button", {
      name: "切换工作区：项目 A",
      exact: true,
    });
    assert.equal(await selectedWorkspace.getAttribute("aria-current"), "true");
    await page
      .getByRole("button", { name: "＋ 新建工作区", exact: true })
      .click();
    await page.getByLabel("工作区名称", { exact: true }).fill("不会保存的草稿");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(workspaces.list().length, 1);
    await page.getByLabel("项目代码仓库", { exact: true }).fill(repository);
    await page
      .getByLabel("Worktree 根目录", { exact: true })
      .fill(path.join(directory, "trees"));
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
    assert.equal(readOptional(workspaces.configFile(a.id)).tapd, undefined);
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
      readOptional(workspaces.configFile(a.id)).tapd.session.cookie_header,
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
    await page
      .getByRole("button", { name: "＋ 新建工作区", exact: true })
      .click();
    await page.getByLabel("工作区名称", { exact: true }).fill("项目 B");
    await page.getByRole("button", { name: "图标：实验", exact: true }).click();
    await page.getByRole("button", { name: "创建工作区", exact: true }).click();
    await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
    assert.equal(
      workspaces.list().find((entry) => entry.name === "项目 B").icon,
      "experiment",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "切换工作区：项目 B", exact: true })
        .locator("svg")
        .count(),
      1,
    );
    assert.equal(
      await page.getByLabel("项目代码仓库", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page.getByLabel("Codex 模型", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByLabel("TAPD 项目 ID", { exact: true }).inputValue(),
      "",
    );

    await page
      .getByRole("button", { name: "切换工作区：项目 A", exact: true })
      .click();
    await page.getByRole("heading", { name: "项目 A · 工作区设置" }).waitFor();
    assert.equal(
      await page.getByLabel("Codex 模型", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByLabel("TAPD Cookie", { exact: true }).inputValue(),
      "",
    );
    await page.getByRole("button", { name: "编辑工作区", exact: true }).click();
    assert.equal(
      await page.getByLabel("工作区名称", { exact: true }).inputValue(),
      "项目 A",
    );
    await page.getByLabel("工作区名称", { exact: true }).fill("项目 A 改名");
    await page
      .getByRole("searchbox", { name: "搜索图标" })
      .fill("没有这种图标");
    await page
      .getByText("没有匹配的图标，试试其他关键词。", { exact: true })
      .waitFor();
    await page.getByRole("searchbox", { name: "搜索图标" }).fill("火箭");
    await page
      .getByRole("button", { name: "图标：火箭", exact: true })
      .waitFor();
    await page.getByRole("searchbox", { name: "搜索图标" }).fill("rocket");
    await page.getByRole("button", { name: "图标：火箭", exact: true }).click();
    await page.getByRole("searchbox", { name: "搜索图标" }).fill("");
    assert.equal(
      await page.getByRole("button", { name: /^图标：/ }).count(),
      40,
    );
    await page
      .getByRole("dialog")
      .screenshot({ path: path.join(output, "workspace-icon-picker.png") });
    await page.getByRole("button", { name: "保存工作区", exact: true }).click();
    await page
      .getByRole("heading", { name: "项目 A 改名 · 工作区设置" })
      .waitFor();
    assert.equal(workspaces.read(a.id).icon, "rocket");
    const iconButton = page.getByRole("button", {
      name: "切换工作区：项目 A 改名",
      exact: true,
    });
    assert.equal(await iconButton.locator("svg").count(), 1);
    assert.equal(await iconButton.locator("small").count(), 0);
    await page.reload();
    await iconButton.waitFor();
    assert.equal(await iconButton.locator("svg").count(), 1);
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
    await page.getByText(/模型列表加载失败：模拟模型列表离线/).waitFor();
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
    await page.locator(".session-context > summary").click();
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
    const aContext = workspaces.get(a.id);
    const key = aContext.sessions.list()[0].key;
    assert.equal(
      aContext.sessions.client.calls.find(
        (entry) => entry.method === "turn/start",
      ).params.effort,
      "high",
    );
    assert.deepEqual(aContext.sessions.store.readTaskMetadata(key), {
      type: "bug",
      progress: "in_progress",
    });
    await page.getByLabel("任务进度", { exact: true }).selectOption("review");
    await page.waitForFunction(
      () =>
        document.querySelector('select[aria-label="任务进度"]').value ===
        "review",
    );
    await page.getByLabel("任务分组方式").selectOption("progress");
    assert.ok(aContext.sessions.sessions.get(key).turnId);
    await page
      .getByRole("button", { name: "切换工作区：项目 B", exact: true })
      .click();
    await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
    assert.equal(await page.locator(".session-link").count(), 0);
    assert.equal(await page.getByLabel("任务分组方式").inputValue(), "type");
    assert.ok(
      aContext.sessions.sessions.get(key).turnId,
      "switching workspace must not stop background execution",
    );
    await page.reload();
    await page.getByRole("heading", { name: "项目 B · 工作区设置" }).waitFor();
    await page
      .getByRole("button", { name: "切换工作区：项目 A 改名", exact: true })
      .click();
    await page.getByText("历史回复", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("任务分组方式").inputValue(),
      "progress",
    );
    assert.equal(
      await page.getByLabel("任务进度", { exact: true }).inputValue(),
      "review",
    );
    await page.getByRole("button", { name: "■ 停止", exact: true }).click();
    await page.locator(".session-context > summary").click();
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
    await page.getByRole("button", { name: "编辑工作区", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "恢复默认", exact: true }).click();
    await page.screenshot({
      path: path.join(output, "workspace-rename-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    assert.equal(
      workspaces.read(a.id).icon,
      "rocket",
      "cancel must preserve saved icon",
    );
    await page.getByRole("button", { name: "编辑工作区", exact: true }).click();
    await page.getByRole("button", { name: "恢复默认", exact: true }).click();
    await page.getByRole("button", { name: "保存工作区", exact: true }).click();
    await page.getByText("历史回复", { exact: true }).waitFor();
    assert.equal(workspaces.read(a.id).icon, null);
    assert.equal(await iconButton.locator("svg").count(), 0);
    // Long names and many workspaces must remain usable in both rail orientations.
    const longName = "客户管理系统与运营后台的超长项目名称".repeat(3);
    workspaces.save({ name: longName }, a.id);
    for (let index = 0; index < 16; index++)
      workspaces.save({ name: `额外项目 ${index}` });
    await page.reload();
    await page
      .getByRole("button", { name: `切换工作区：${longName}`, exact: true })
      .waitFor();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
      await page
        .getByRole("button", { name: "切换工作区：额外项目 15", exact: true })
        .scrollIntoViewIfNeeded();
      await page
        .getByRole("button", { name: "＋ 新建工作区", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
    }
    await page
      .getByRole("button", { name: "切换工作区：额外项目 15", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "额外项目 15 · 工作区设置" })
      .waitFor();
    assert.equal(checks, 3);
    assert.deepEqual(errors, []);
    process.stdout.write(
      "Workspace browser passed: create, switch, rename, reload, scoped settings, Cookie draft/check/failure, manual run, attachments, background execution and mobile.\n",
    );
  } finally {
    await browser?.close();
    await application.close();
    global.fetch = originalFetch;
    for (const callback of cleanup.reverse()) callback();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
