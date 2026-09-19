/* global document, window */
// Visual fixtures only: intercepted APIs cannot run Codex or contact TAPD.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary, png } = require("../support/helpers.cjs");
const { promptTemplateCatalog, MAX_PROMPT_TEMPLATE_LENGTH } = require("../../src/domain/prompt-templates.cjs");

async function main() {
  const cleanup = [];
  const directory = temporary({ after: (fn) => cleanup.push(fn) });
  const client = new FakeClient();
  const workspaces = new WorkspaceManager({
    directory: path.join(directory, "workspaces"),
    createManager: (options) => new SessionManager({ ...options, client }),
  });
  const workspace = workspaces.save({ name: "客户管理系统", icon: "folder" });
  workspaces.save({ name: "运营后台", icon: "appstore" });
  const application = createWebServer({ workspaces, testIdentity: true });
  const origin = await application.listen(0);
  const output = path.resolve("state/browser/unified");
  fs.mkdirSync(output, { recursive: true });
  const captures = [];
  const errors = [];
  let browser,
    scenario = "session";
  const runs = [
    {
      key: "1-1",
      title: "优化客户搜索体验",
      metadata: { type: "requirement", progress: "review" },
    },
    {
      key: "1-2",
      title: "修复导出异常",
      metadata: { type: "bug", progress: "in_progress" },
    },
    {
      key: "1-3",
      title: "整理项目文档",
      metadata: { type: "other", progress: "merge" },
    },
  ].map((run) => ({
    ...run,
    status: "completed",
    execution: { status: "completed" },
  }));
  const channels = [
    {
      id: "tapd",
      label: "TAPD",
      workspace: "123456",
      scopeLabel: "TAPD 项目 ID",
      scopeLocked: true,
      capabilities: { search: true, assignees: true },
    },
    { id: "manual", label: "手动输入", capabilities: { manualInput: true } },
  ];
  const detail = (key) => ({
    ...runs.find((run) => run.key === key),
    sessionId: "session-preview-customer-search",
    status: scenario === "readonly" ? "disconnected" : scenario === "pending" ? "running" : "completed",
    turnId: scenario === "pending" ? "fixture-active-turn" : null,
    items: [
      {
        id: "user",
        type: "userMessage",
        text: "支持按姓名和手机号搜索客户，输入后实时筛选。请补充空结果提示，并保持现有表格交互。",
      },
      {
        id: "reply",
        type: "agentMessage",
        text: "已完成搜索交互与结果展示，接下来检查边界情况。",
      },
      {
        id: "command",
        type: "commandExecution",
        command: "npm run test",
        output: "搜索、清空和空结果提示均验证通过。",
        exitCode: 0,
        status: "completed",
      },
      {
        id: "complete",
        type: "agentMessage",
        text: "已完成客户搜索体验优化。\n\n• 支持姓名和手机号筛选。\n• 无匹配结果时显示明确提示。\n• 清空关键词后恢复完整列表。\n\n可以开始验收。",
        status: "completed",
      },
    ],
    requests:
      scenario === "approval"
        ? [
            {
              id: "approval",
              method: "item/commandExecution/requestApproval",
              params: {
                reason: "构建项目，检查页面修改是否可以正常打包。",
                command: "npm run build",
              },
            },
          ]
        : scenario === "clarification"
          ? [
              {
                id: "input",
                method: "item/tool/requestUserInput",
                params: {
                  questions: [
                    {
                      id: "scope",
                      question: "搜索范围包含哪些字段？",
                      options: [
                        { label: "姓名和手机号", description: "支持两个字段" },
                        { label: "仅姓名", description: "只搜索姓名" },
                      ],
                    },
                  ],
                },
              },
            ]
          : [],
    readOnlyReason:
      scenario === "git-deleted" ? "Worktree 文件与本地分支已删除，当前会话仅供查看。" :
      scenario === "readonly" ? "原 worktree 已不可用，当前会话仅供查看。" : "",
    codex: { model: "", reasoningEffort: "" },
    executionSettings: scenario === "pending" || scenario === "long-model"
      ? { model: "example-model", reasoningEffort: "high", permissionMode: "full" }
      : { model: "", reasoningEffort: "", permissionMode: "ask" },
    activeExecutionSettings: scenario === "pending"
      ? { model: "", reasoningEffort: "", permissionMode: "ask" }
      : null,
    settingsPending: scenario === "pending",
    worktree: {
      path: "/srv/wt/customer-system/customer-search-a1b2c3d4e5f6",
      branch: "codex/a1b2c3d4e5f6",
      deleted: scenario === "git-deleted",
    },
    transition: { status: "skipped" },
    requirement: {
      id: "1024",
      sourceUrl: "https://example.invalid/requirements/1024",
      capturedAt: "2026-09-17T08:00:00Z",
      markdown:
        "## 客户搜索体验\n\n在客户列表中增加搜索框，帮助用户快速定位客户。\n\n### 验收标准\n\n1. 支持姓名与手机号关键词匹配。\n2. 无结果时显示清晰提示。\n3. 清空关键词后恢复完整列表。\n\n| 场景 | 预期行为 |\n| --- | --- |\n| 输入姓名 | 展示匹配客户 |\n| 清空搜索 | 恢复完整列表 |",
      prompt:
        "实现客户搜索需求，保持现有会话、接口与数据行为。完成后验证搜索与空结果。",
      supplementaryInstructions:
        "补充验收：支持姓名和手机号组合筛选。\n指导意见：沿用现有表格交互，并覆盖清空与空结果场景。",
      images: [
        {
          index: 0,
          name: "需求示意.png",
          source: "fixture-image",
          url: "/api/workspaces/" + workspace.id + "/runs/1-1/images/0",
        },
      ],
    },
  });
  try {
    browser = await chromium.launch({
      ...(process.env.BROWSER_CHANNEL
        ? { channel: process.env.BROWSER_CHANNEL }
        : process.platform === "win32" ? { channel: "msedge" } : {}),
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname
        .replace(/^\/api\/workspaces\/[^/]+/, "")
        .replace(/^\/api/, "");
      const send = (data, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      if (endpoint === "/events") return route.continue();
      if (endpoint === "/auth/session")
        return send({ user: { id: "visual-admin", username: "演示管理员", role: "admin", status: "active", mustChangePassword: false }, token: "visual-fixture", settings: { model: null, reasoningEffort: null, permissionMode: "ask", notificationsEnabled: true, grouping: "type" } });
      if (endpoint === "/account/preferences") return send({ preferences: { unreadRunKeys: [] } });
      if (url.pathname === "/api/bootstrap")
        return send({
          token: "visual-fixture",
          workspaces: scenario === "welcome" ? [] : workspaces.list(),
        });
      if (endpoint === "/bootstrap")
        return send({ token: "visual-fixture", channels, workspace: "123456" });
      if (endpoint === "/runs")
        return send({ runs: scenario === "empty" ? [] : runs });
      if (/^\/runs\/[^/]+\/git$/.test(endpoint))
        return send({
          path: "/srv/wt/customer-system/customer-search-a1b2c3d4e5f6",
          branch: "codex/a1b2c3d4e5f6",
          head: "a".repeat(40),
          upstream: scenario === "git-unpublished" ? null : "origin/codex/a1b2c3d4e5f6",
          unpublished: scenario === "git-unpublished",
          ahead: scenario === "git-unpublished" ? null : 2,
          behind: scenario === "git-unpublished" ? null : 1,
          changedFiles: 3, untrackedFiles: 1, ignoredFiles: 2,
          clean: false, statusToken: "visual-fixture",
          canDelete: !["pending", "readonly", "git-deleted"].includes(scenario),
          deleteReason: scenario === "readonly" ? "原 Worktree 已不可用。" : "",
          deleted: scenario === "git-deleted",
        });
      if (endpoint === "/repository/git")
        return send({
          repository: "/srv/repos/customer-management-system",
          baseRef: "main", branch: "main", upstream: "origin/main",
          remote: "origin", remotes: [{ name: "origin" }, { name: "upstream" }],
          canUpdate: true, updateReason: null,
          lastFetchedAt: "2026-09-18T02:35:00Z",
        });
      if (/^\/runs\/[^/]+$/.test(endpoint))
        return send(detail(endpoint.split("/").at(-1)));
      if (endpoint.endsWith("/images/0"))
        return route.fulfill({ contentType: "image/png", body: png });
      if (endpoint === "/system/settings")
        return send({ worktreeBasePath: "/srv/wt", platform: "linux" });
      if (endpoint === "/system/directories") {
        const directory = url.searchParams.get("path") || "/srv/wt";
        return send({
          path: directory,
          parentPath: directory === "/" ? null : path.posix.dirname(directory),
          roots: [{ name: "/", path: "/" }],
          directories: [
            { name: "客户管理系统", path: path.posix.join(directory, "客户管理系统") },
            { name: "运营后台与共享服务的开发工作区目录", path: path.posix.join(directory, "运营后台与共享服务的开发工作区目录") },
          ],
          offset: 0,
          hasMore: false,
        });
      }
      if (endpoint === "/settings")
        return send({
          repository: "/srv/repos/customer",
          worktreeRoot: "/srv/wt/customer-system",
          worktreeBasePath: "/srv/wt",
          worktreeDirectory: "customer-system",
          baseRef: "main",
          platform: "linux",
          initCommands: ["pnpm install", "pnpm build"],
        });
      if (endpoint === "/settings/refs")
        return send({ refs: [{ value: "main", label: "main · 本地分支" }] });
      if (endpoint === "/settings/prompts")
        return send({
          templates: Object.fromEntries(Object.entries(promptTemplateCatalog).map(([name, entry]) => [name, entry.defaultTemplate])),
          catalog: promptTemplateCatalog,
          maxLength: MAX_PROMPT_TEMPLATE_LENGTH,
        });
      if (endpoint === "/settings/tapd")
        return send({
          workspaceId: "123456",
          hasCookie: true,
          targetStatus: "developing",
          imageHosts: [],
        });
      if (endpoint === "/models")
        return scenario === "error"
          ? send({ error: "暂时无法获取模型列表，请稍后重试。" }, 503)
          : send({
              models: [
                {
                  model: "example-model",
                  label: scenario === "long-model"
                    ? "示例模型 · 用于复杂开发任务的超长模型展示名称"
                    : "示例模型",
                  reasoningEfforts: ["low", "medium", "high"],
                },
              ],
            });
      if (endpoint === "/execution-options")
        return send({ permissionModes: [
          { id: "ask", label: "默认权限", description: "在工作区内执行，重要操作请求审批。", available: true },
          { id: "auto", label: "自动审批", description: "由 Codex 自动审核权限请求。", available: scenario !== "permission-unavailable", ...(scenario === "permission-unavailable" ? { reason: "当前 Codex 不支持自动审批，请升级后重试。" } : {}) },
          { id: "full", label: "完全访问", description: "可访问工作区之外的文件和网络，无需审批。", available: true },
        ] });
      if (endpoint.endsWith('/execution-settings'))
        return send({ error: "模拟执行设置保存失败，请重试。" }, 400);
      if (endpoint === "/requirements")
        return send({
          items: [
            { id: "1024", title: "修复客户导出异常", status: "待处理" },
            { id: "1032", title: "优化客户搜索体验", status: "待处理" },
          ],
        });
      if (endpoint === "/users")
        return send({ users: [{ nick: "张明" }, { nick: "李欣" }] });
      return send({ error: "视觉预览禁止执行操作" }, 400);
    });
    async function capture(name) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () => !document.querySelector(".ant-select-loading"),
      );
      const issues = await page.evaluate(() => {
        const issues = [];
        for (const el of document.querySelectorAll(
          "body, main, .sidebar, .form-section, dialog[open]",
        )) {
          if (el.clientWidth && el.scrollWidth > el.clientWidth + 2)
            issues.push(el.className || el.tagName);
        }
        for (const hint of document.querySelectorAll(
          ".field-hint, .base-ref-hint",
        )) {
          if (!hint.getClientRects().length) continue;
          const previous = hint.previousElementSibling;
          if (
            previous &&
            previous.getClientRects().length &&
            hint.getBoundingClientRect().top <
              previous.getBoundingClientRect().bottom - 1
          )
            issues.push("overlapping hint");
        }
        for (const menu of document.querySelectorAll('.permission-menu')) {
          if (!menu.getClientRects().length) continue;
          const bounds = menu.getBoundingClientRect();
          if (bounds.left < -1 || bounds.right > window.innerWidth + 1 ||
              bounds.top < -1 || bounds.bottom > window.innerHeight + 1)
            issues.push('permission popup outside viewport');
        }
        return issues;
      });
      assert.deepEqual(issues, [], name + " layout overflow or overlap");
      await page.screenshot({
        path: path.join(output, name + ".png"),
        fullPage: !(await page.locator("dialog[open]").count()),
      });
      captures.push(name);
    }
    async function load(mode = "session") {
      scenario = mode;
      await page.goto(origin);
      if (mode !== "welcome" && mode !== "empty")
        await page.locator(".session-header").waitFor();
    }
    async function captureSystemSettings(suffix) {
      await page.getByRole("button", { name: "系统设置", exact: true }).click();
      await page.getByRole("textbox", { name: "Worktree 基础目录", exact: true }).waitFor();
      await capture("03-system-settings-" + suffix);
      await page.getByRole("button", { name: "浏览服务器目录", exact: true }).click();
      await page.getByRole("dialog", { name: "选择服务器目录", exact: true }).waitFor();
      await page.getByRole("button", { name: "打开目录：客户管理系统", exact: true }).waitFor();
      await capture("03-system-directory-picker-" + suffix);
      await page.keyboard.press("Escape");
    }
    async function captureGitViews(suffix) {
      await page.getByLabel("Worktree Git 状态", { exact: true }).click();
      await page.getByRole("button", { name: "删除 Worktree…", exact: true }).waitFor();
      await page.locator(".session-git").scrollIntoViewIfNeeded();
      await capture("09-worktree-git-" + suffix);
      await page.getByRole("button", { name: "删除 Worktree…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "删除 Worktree", exact: true });
      await dialog.getByRole("textbox", { name: "确认删除的本地分支", exact: true }).waitFor();
      await dialog.getByRole("button", { name: "删除文件与本地分支", exact: true }).scrollIntoViewIfNeeded();
      await capture("09-delete-worktree-" + suffix);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "代码仓库", exact: true }).click();
      await page.getByRole("button", { name: "获取远端更新", exact: true }).waitFor();
      await capture("09-repository-git-" + suffix);
      await load();
    }
    await load();
    await capture("05-session-desktop");
    await captureGitViews("desktop");
    await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
    await page.getByRole('listbox', { name: '执行权限选项' }).waitFor();
    await capture('05-permission-menu-desktop');
    await page.keyboard.press('Escape');
    await page.locator(".session-context > summary").click();
    await page
      .getByRole("heading", { name: "客户搜索体验", exact: true })
      .waitFor();
    await capture("06-requirement-details");
    await page.locator(".requirement-prompt > summary").click();
    await page.locator(".requirement-prompt").scrollIntoViewIfNeeded();
    await capture("06-requirement-prompt");
    await page
      .getByRole("button", { name: "＋ 从需求启动", exact: true })
      .click();
    await page.getByLabel("需求渠道", { exact: true }).selectOption("manual");
    await page.getByLabel("需求标题", { exact: true }).fill("优化客户搜索体验");
    await page
      .getByLabel("需求内容", { exact: true })
      .fill(
        "支持按姓名和手机号搜索客户。\n清空关键词后恢复完整列表；无结果时提供明确提示。",
      );
    await page.getByRole("button", { name: "刷新模型列表" }).waitFor();
    await capture("01-new-manual");
    await page.getByRole('combobox', { name: '权限模式', exact: true }).scrollIntoViewIfNeeded();
    await capture('01-new-manual-execution-settings');
    await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
    await page.getByRole('listbox', { name: '执行权限选项' }).waitFor();
    await capture('01-new-manual-permission-menu');
    await page.keyboard.press('Escape');
    await page.getByLabel("需求渠道", { exact: true }).selectOption("tapd");
    await page.getByPlaceholder("输入需求标题关键词").fill("客户");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await page.getByRole("button", { name: /修复客户导出异常/ }).click();
    await page.getByLabel("补充说明", { exact: true }).fill(
      "补充验收：导出结果应与当前筛选条件一致。\n指导意见：沿用现有下载流程，并补充空结果提示。",
    );
    await capture("02-new-tapd");
    await page.getByRole("button", { name: "工作区设置", exact: true }).click();
    await page.getByLabel("项目代码仓库", { exact: true }).waitFor();
    await page.locator("main").evaluate((el) => {
      el.scrollTop = 0;
    });
    await capture("03-project-settings");
    await page.getByRole("link", { name: "TAPD 渠道", exact: true }).click();
    await capture("04-tapd-settings");
    await page.getByRole("link", { name: "提示词模板", exact: true }).click();
    await page.getByRole("textbox", { name: "提示词模板内容", exact: true }).waitFor();
    await capture("04-workspace-prompt-settings");
    await page.getByRole("button", { name: "TAPD 需求", exact: true }).click();
    await page.locator(".prompt-preview > summary").click();
    await page.locator(".prompt-preview").scrollIntoViewIfNeeded();
    await capture("04-workspace-prompt-preview");
    await page.getByRole("button", { name: "重命名", exact: true }).click();
    await capture("07-workspace-edit");
    await page.keyboard.press("Escape");
    await captureSystemSettings("desktop");
    await load("approval");
    await page
      .getByRole("button", { name: "允许本次操作", exact: true })
      .scrollIntoViewIfNeeded();
    await capture("08-approval");
    await load("clarification");
    await page
      .getByRole("button", { name: "姓名和手机号", exact: true })
      .click();
    await page
      .getByRole("button", { name: "提交回答", exact: true })
      .scrollIntoViewIfNeeded();
    await capture("08-clarification");
    await load("readonly");
    await capture("08-readonly");
    await load("git-deleted");
    await page.getByLabel("Worktree Git 状态", { exact: true }).click();
    await capture("09-worktree-deleted");
    await load("git-unpublished");
    await page.locator(".session-git").getByText("分支尚未发布", { exact: true }).waitFor();
    await capture("09-worktree-unpublished");
    await load('pending');
    await page.getByText(/下一轮生效/).first().waitFor();
    await capture('08-settings-pending');
    await load('permission-unavailable');
    await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
    assert.equal(await page.locator('.permission-option[data-value="auto"]').isDisabled(), true);
    await capture('08-permission-unavailable');
    await page.keyboard.press('Escape');
    await load('settings-error');
    await page.getByRole('combobox', { name: 'Codex 模型', exact: true }).click();
    await page.locator('.model-option[data-model="example-model"]').click();
    await page.getByText(/模拟执行设置保存失败，请重试。/).waitFor();
    await capture('08-settings-save-error');
    await load("error");
    await page
      .getByRole("button", { name: "＋ 从需求启动", exact: true })
      .click();
    await page.getByLabel("需求渠道", { exact: true }).selectOption("manual");
    await page.getByText(/模型列表加载失败/).waitFor();
    await page
      .getByRole("button", { name: "创建 session 并开始开发 →", exact: true })
      .click();
    await capture("08-form-error");
    await load("empty");
    await page.getByRole("button", { name: "＋ 从需求启动", exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await capture("08-empty");
    await load("welcome");
    await page.getByRole("dialog").waitFor();
    await capture("07-workspace-create");
    await page.keyboard.press("Escape");
    await capture("07-welcome");
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await load();
      await capture("05-session-" + width);
      await captureGitViews(width);
      const composer = page.locator('.composer-toolbar');
      await composer.scrollIntoViewIfNeeded();
      await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
      await page.getByRole('listbox', { name: '执行权限选项' }).waitFor();
      await capture('05-permission-menu-' + width);
      await page.keyboard.press('Escape');
      await load('long-model');
      await capture('05-long-model-' + width);
      await page.getByRole('combobox', { name: 'Codex 模型', exact: true }).click();
      await page.getByRole('listbox', { name: 'Codex 模型选项' }).waitFor();
      await capture('05-model-menu-' + width);
      await page.keyboard.press('Escape');
      await page.getByRole('combobox', { name: '思考强度', exact: true }).click();
      await page.getByRole('listbox', { name: '思考强度选项' }).waitFor();
      await capture('05-effort-menu-' + width);
      await page.keyboard.press('Escape');
      await page
        .getByRole("button", { name: "工作区设置", exact: true })
        .click();
      await page.getByLabel("项目代码仓库", { exact: true }).waitFor();
      await page.locator("main").evaluate((el) => {
        el.scrollTop = 0;
      });
      await capture("03-settings-" + width);
      await captureSystemSettings(width);
      await page.getByRole("button", { name: "切换工作区：客户管理系统", exact: true }).click();
      await page.getByRole("button", { name: "工作区设置", exact: true }).click();
      await page.getByRole("link", { name: "提示词模板", exact: true }).click();
      await page.getByRole("textbox", { name: "提示词模板内容", exact: true }).waitFor();
      await capture("04-workspace-prompt-settings-" + width);
      await page.locator(".prompt-preview > summary").click();
      await page.locator(".prompt-preview").scrollIntoViewIfNeeded();
      await capture("04-workspace-prompt-preview-" + width);
      await page
        .getByRole("button", { name: "＋ 从需求启动", exact: true })
        .click();
      await page.getByLabel("需求渠道", { exact: true }).selectOption("manual");
      await capture("01-manual-" + width);
      await page.getByLabel("需求渠道", { exact: true }).selectOption("tapd");
      await page.getByLabel("需求 ID", { exact: true }).fill("1024");
      await page.getByLabel("补充说明", { exact: true }).fill(
        "补充验收：导出结果应与当前筛选条件一致。\n指导意见：保留现有下载流程，补充移动端和空结果提示。",
      );
      await capture("02-tapd-" + width);
      await page
        .getByRole("button", { name: "工作区设置", exact: true })
        .click();
      await page.getByRole("button", { name: "重命名", exact: true }).click();
      await page
        .getByLabel("工作区名称", { exact: true })
        .fill("这是一个用于验证窄屏布局和名称截断的很长工作区名称");
      await page
        .getByRole("button", { name: "保存工作区", exact: true })
        .scrollIntoViewIfNeeded();
      await capture("07-dialog-" + width);
      const box = await page
        .getByRole("button", { name: "保存工作区", exact: true })
        .boundingBox();
      assert.ok(
        box.y >= 0 && box.y + box.height <= 1000,
        "dialog save remains reachable",
      );
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
    assert.equal(client.calls.length, 0, "visual fixtures must not call Codex");
    fs.writeFileSync(
      path.join(output, "index.html"),
      '<!doctype html><meta charset="utf-8"><title>实现截图 · 统一风格</title><style>body{font:14px system-ui;background:#f7f8f5;color:#203e34;padding:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}figure{margin:0;background:white;border:1px solid #dfe5de;border-radius:12px;padding:16px}img{width:100%;max-height:700px;object-fit:contain;object-position:top}a{color:inherit}</style><h1>统一风格 · 实现截图</h1><p>全部为模拟数据；与 AI 生成原型分开保存。</p><main>' +
        captures
          .map(
            (name) =>
              '<figure><a href="' +
              name +
              '.png"><img src="' +
              name +
              '.png" loading="lazy"><p>' +
              name +
              "</p></a></figure>",
          )
          .join("") +
        "</main>",
    );
    console.log(
      "Visual verification passed: " +
        captures.length +
        " captures, desktop/tablet/mobile, no overflow or hint overlap.",
    );
  } finally {
    await browser?.close();
    await application.close();
    for (const fn of cleanup.reverse()) await fn();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
