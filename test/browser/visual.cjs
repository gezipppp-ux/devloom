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
const { messageMarkdown } = require("../fixtures/message-markdown.cjs");

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
      capabilities: { search: true, assignees: false },
    },
    { id: "manual", label: "手动输入", capabilities: { manualInput: true } },
  ];
  const detail = (key) => ({
    ...runs.find((run) => run.key === key),
    sessionId: "session-preview-customer-search",
    status: scenario === "readonly" ? "disconnected" : scenario === "pending" ? "running" : "completed",
    turnId: scenario === "pending" ? "fixture-active-turn" : null,
    items: scenario === "markdown" ? [{
      id: "markdown-reply", type: "agentMessage", text: messageMarkdown,
    }] : [
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
      if (endpoint === "/workspace-clones") return send({ clones: [] });
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
        return send({ memberStorageRoot: "/srv/wt", platform: "linux", git: { installed: true, version: "git version 2.55.0" } });
      if (endpoint === "/account/git-accounts")
        return send({ accounts: [{ id: "fixture-account", name: "公司 Git", authType: "http", remoteUrl: "http://git.example.test/team/customer.git" }] });
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
          repository: "/srv/wt/admin/projects/customer-system",
          projectsRoot: "/srv/wt/admin/projects",
          worktreeRoot: "/srv/wt/admin/worktree/customer-system",
          memberStorageRoot: "/srv/wt",
          projectName: "customer-system",
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
            { id: "1032", title: "优化客户搜索体验", status: "待处理", localRun: { key: "1-1032", progress: "in_progress" } },
          ],
        });
      if (endpoint === "/users")
        return send({ users: [{ nick: "张明" }, { nick: "李欣" }] });
      return send({ error: "视觉预览禁止执行操作" }, 400);
    });
    async function capture(name, selector) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () => !document.querySelector(".ant-select-loading"),
      );
      const issues = await page.evaluate(() => {
        const issues = [];
        for (const el of document.querySelectorAll(
          "body, main, .sidebar, .form-section, .session-conversation, .session-drawer, .session-drawer-content, dialog[open]",
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
      await (selector ? page.locator(selector) : page).screenshot({
        path: path.join(output, name + ".png"),
        ...(!selector ? { fullPage: !(await page.locator("dialog[open]").count()) && !(await page.locator(".session-drawer:visible").count()) } : {}),
      });
      captures.push(name);
    }
    async function load(mode = "session") {
      scenario = mode;
      await page.goto(origin);
      if (mode !== "welcome" && mode !== "empty")
        await page.locator(".session-header").waitFor();
    }
    async function captureMarkdown(suffix) {
      await load("markdown");
      await page.locator('.message-markdown pre code').waitFor();
      await page.locator('.timeline').evaluate(el => el.scrollTo({ top: 0, behavior: "instant" }));
      await capture("05-markdown-" + suffix);
      await capture("05-markdown-content-" + suffix, ".message-markdown");
      // Long code lines and tables scroll locally, without widening the conversation.
      await page.route('**/api/workspaces/*/runs/1-1', route => route.fulfill({ json: {
        ...detail('1-1'), items: [{ id: 'wide-markdown', type: 'agentMessage', text:
          messageMarkdown + '\n\n```text\n' + 'long_identifier_'.repeat(80) + '\n```\n\n| ' +
          Array.from({ length: 12 }, (_, index) => `Column ${index}`).join(' | ') + ' |\n| ' +
          Array(12).fill('---').join(' | ') + ' |\n| ' + Array(12).fill('cell_value_'.repeat(6)).join(' | ') + ' |',
        }],
      } }));
      await page.reload();
      await page.locator('.message-markdown pre').nth(1).waitFor();
      assert.equal(await page.locator('.message-markdown pre').last().evaluate(el => el.scrollWidth > el.clientWidth), true);
      assert.equal(await page.locator('.message-markdown table').last().evaluate(el => el.scrollWidth > el.clientWidth), true);
      const overflow = await page.locator('.timeline, .message-markdown').evaluateAll(elements =>
        elements.some(el => el.scrollWidth > el.clientWidth + 2));
      assert.equal(overflow, false, 'wide Markdown must stay inside the timeline');
      await capture("05-markdown-long-" + suffix);
      await page.unroute('**/api/workspaces/*/runs/1-1');
      await load();
    }
    async function captureSystemSettings(suffix) {
      await page.getByRole("button", { name: "系统设置", exact: true }).click();
      await page.getByRole("textbox", { name: "成员目录基础路径", exact: true }).waitFor();
      await capture("03-system-settings-" + suffix);
      await page.getByRole("button", { name: "浏览服务器目录", exact: true }).click();
      await page.getByRole("dialog", { name: "选择服务器目录", exact: true }).waitFor();
      await page.getByRole("button", { name: "打开目录：客户管理系统", exact: true }).waitFor();
      await capture("03-system-directory-picker-" + suffix);
      await page.keyboard.press("Escape");
    }
    async function captureEmptyWorkspaceRail(suffix) {
      await page.getByRole("button", { name: "系统设置", exact: true }).click();
      await page.getByRole("textbox", { name: "成员目录基础路径", exact: true }).waitFor();
      const rail = page.locator(".workspace-rail");
      assert.equal(await rail.locator(".workspace-icons").count(), 0,
        "an empty workspace list must not reserve rail space");
      assert.equal(await rail.locator(".rail-brand + .workspace-add").count(), 1);
      const brand = await rail.locator(".rail-brand").boundingBox();
      const add = await rail.locator(".workspace-add").boundingBox();
      if (page.viewportSize().width > 600) {
        assert.equal(add.y - brand.y - brand.height, 28,
          "empty desktop rail keeps only the brand margin and one navigation gap");
      } else {
        assert.equal(add.y, brand.y, "empty mobile rail controls stay on one row");
        assert.ok(add.x >= brand.x + brand.width + 12);
        assert.ok(add.x + add.width <= page.viewportSize().width);
      }
      await capture("07-empty-workspace-rail-" + suffix);
      await rail.getByRole("button", { name: "＋ 新建工作区", exact: true }).click();
      await page.getByRole("dialog", { name: "新建工作区", exact: true }).waitFor();
      await page.keyboard.press("Escape");
    }
    async function captureGitViews(suffix) {
      await page.getByRole("button", { name: "Worktree Git", exact: true }).click();
      await page.getByRole("button", { name: "删除 Worktree…", exact: true }).waitFor();
      await page.locator(".session-git").scrollIntoViewIfNeeded();
      await capture("09-worktree-git-" + suffix);
      await page.getByRole("button", { name: "删除 Worktree…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "删除 Worktree", exact: true });
      await dialog.getByRole("textbox", { name: "确认删除的本地分支", exact: true }).waitFor();
      await dialog.getByRole("button", { name: "删除文件与本地分支", exact: true }).scrollIntoViewIfNeeded();
      await capture("09-delete-worktree-" + suffix);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".session-drawer").isVisible(), true,
        "Escape closes the confirmation dialog before its containing drawer");
      await page.getByRole("button", { name: "收起会话资料", exact: true }).click();
      await page.getByRole("button", { name: "代码仓库", exact: true }).click();
      await page.getByRole("button", { name: "获取远端更新", exact: true }).waitFor();
      await capture("09-repository-git-" + suffix);
      await load();
    }
    async function captureSessionDrawer(suffix) {
      const info = page.getByRole("button", { name: "会话信息", exact: true });
      const drawer = page.locator(".session-drawer");
      const input = page.getByRole("textbox", { name: "发送给 Codex 的指令", exact: true });
      assert.equal(await drawer.isVisible(), false, "session drawers start collapsed");
      await input.fill("打开资料时保留这段草稿");
      const before = await page.locator(".session-conversation").boundingBox();
      await page.locator(".timeline").evaluate(el => el.scrollTo({ top: 40, behavior: "instant" }));
      const scrollBefore = await page.locator(".timeline").evaluate(el => el.scrollTop);
      await info.click();
      const bounds = await drawer.boundingBox();
      const after = await page.locator(".session-conversation").boundingBox();
      assert.equal(after.width, before.width, "the drawer overlays instead of shrinking the conversation");
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
      assert.equal(await page.locator(".timeline").evaluate(el => el.scrollTop), scrollBefore);
      await capture("05-session-info-" + suffix);
      await page.keyboard.press("Escape");
      assert.equal(await drawer.isVisible(), false);
      assert.equal(await info.evaluate(el => el === document.activeElement), true, "Escape restores the trigger focus");
      await page.getByRole("button", { name: "需求资料", exact: true }).click();
      await page.getByRole("heading", { name: "客户搜索体验", exact: true }).waitFor();
      await capture("06-requirement-drawer-" + suffix);
      await page.getByRole("button", { name: "Worktree Git", exact: true }).click();
      assert.equal(await page.locator(".session-git").isVisible(), true);
      assert.equal(await page.locator(".requirement-details").isVisible(), false);
      await page.getByRole("button", { name: "Worktree Git", exact: true }).click();
      assert.equal(await drawer.isVisible(), false, "clicking the active entry collapses the drawer");
      await info.click();
      await page.locator(".account-bar").click({ position: { x: 4, y: 4 } });
      assert.equal(await drawer.isVisible(), false, "clicking outside collapses the drawer");
      assert.equal(await input.inputValue(), "打开资料时保留这段草稿");
      await input.fill("");
    }
    await load();
    assert.equal(await page.locator(".workspace-rail .workspace-icons").count(), 1);
    assert.equal(await page.locator(".workspace-rail .workspace-icon").count(), 2);
    await capture("05-session-desktop");
    await captureMarkdown("desktop");
    await page.setViewportSize({ width: 1920, height: 855 });
    await capture("05-session-wide");
    await page.setViewportSize({ width: 1440, height: 1200 });
    await captureSessionDrawer("desktop");
    await captureGitViews("desktop");
    await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
    await page.getByRole('listbox', { name: '执行权限选项' }).waitFor();
    await capture('05-permission-menu-desktop');
    await page.keyboard.press('Escape');
    await page.getByRole("button", { name: "需求资料", exact: true }).click();
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
    await page.getByText("项目代码仓库", { exact: true }).waitFor();
    await page.locator("main").evaluate((el) => {
      el.scrollTop = 0;
    });
    await capture("03-project-settings");
    await page.getByRole("link", { name: "TAPD 渠道", exact: true }).click();
    await page.locator("#tapd-settings").scrollIntoViewIfNeeded();
    await capture("04-tapd-settings", "#tapd-settings");
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
    await page.getByRole("button", { name: "Worktree Git", exact: true }).click();
    await capture("09-worktree-deleted");
    await load("git-unpublished");
    await page.getByRole("button", { name: "Worktree Git", exact: true }).click();
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
    await page.getByRole("button", { name: "选择图标", exact: true }).click();
    await capture("07-icon-picker-desktop");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { name: "新建工作区", exact: true }).isVisible(), true);
    await page.keyboard.press("Escape");
    await capture("07-welcome");
    await captureEmptyWorkspaceRail("desktop");
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await load("welcome");
      await page.getByRole("dialog", { name: "新建工作区", exact: true }).waitFor();
      await page.getByRole("button", { name: "创建工作区", exact: true }).scrollIntoViewIfNeeded();
      await capture("07-workspace-create-" + width);
      const createBox = await page.getByRole("button", { name: "创建工作区", exact: true }).boundingBox();
      assert.ok(createBox.x >= 0 && createBox.x + createBox.width <= width && createBox.y >= 0 && createBox.y + createBox.height <= 1000);
      await page.getByRole("button", { name: "选择图标", exact: true }).click();
      await capture("07-icon-picker-" + width);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await captureEmptyWorkspaceRail(width);
      await load();
      await capture("05-session-" + width);
      await captureMarkdown(width);
      await captureSessionDrawer(width);
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
      await page.getByText("项目代码仓库", { exact: true }).waitFor();
      await page.locator("main").evaluate((el) => {
        el.scrollTop = 0;
      });
      await capture("03-settings-" + width);
      await page.getByRole("link", { name: "TAPD 渠道", exact: true }).click();
      await page.locator("#tapd-settings").scrollIntoViewIfNeeded();
      assert.equal(await page.getByLabel("开发中状态码", { exact: true }).count(), 0);
      await capture("04-tapd-settings-" + width, "#tapd-settings");
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
      await page.getByRole("button", { name: "检索", exact: true }).click();
      await page.locator(".search-results").getByText("本系统进行中", { exact: true }).waitFor();
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
