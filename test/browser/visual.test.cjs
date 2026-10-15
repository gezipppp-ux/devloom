const { selectOption } = require("../support/select.cjs");
const { openSessionContext } = require("../support/browser-navigation.cjs");
const { openProjectTab } = require("../support/browser-navigation.cjs");
/* global document, window */
// Visual fixtures only: intercepted APIs cannot run real tasks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { agentDescriptor } = require("../fixtures/agent-descriptor.cjs");
const { temporary, png } = require("../support/helpers.cjs");
const { promptTemplateCatalog, MAX_PROMPT_TEMPLATE_LENGTH } = require("../../src/domain/prompt-templates.cjs");
const { messageMarkdown } = require("../fixtures/message-markdown.cjs");
const { projectVisual } = require("../fixtures/project-visual.cjs");
const { verifyReleaseViewStates } = require("./project-releases.test.cjs");
const { verifyIssueCreation, checkIssueCreationLayout } = require("./issue-creation.test.cjs");
const { structuredPatch } = require("diff");

async function main() {
  const cleanup = [];
  const directory = temporary({ after: (fn) => cleanup.push(fn) });
  const client = new FakeClient();
  const workspaces = new WorkspaceManager({
    directory: path.join(directory, "workspaces"),
    createManager: (options) => new SessionManager({ ...options, client }),
  });
  const workspace = (await workspaces.save({ name: "客户管理系统", icon: "folder" }));
  (await workspaces.save({ name: "运营后台", icon: "appstore" }));
  const application = createWebServer({ workspaces, testIdentity: true });
  const origin = await application.listen(0);
  const output = path.resolve("state/browser/unified");
  fs.mkdirSync(output, { recursive: true });
  const captures = [];
  const projects = projectVisual(workspace.id);
  const errors = [];
  const filePath = "web/src/views/marketing/hotspot-creation-workspace.vue";
  const fileBefore = ['<a-button', '  :loading="refreshing"', '  @click="refreshHotspots"', '>', '  <ReloadOutlined />', '  刷新热点', '</a-button>', ''].join('\n');
  const fileCurrent = fileBefore.replace('  :loading', '  v-permission="[\'ai:marketing:hotspot:refresh\']"\n  :loading');
  let browser,
    scenario = "session";
  const runs = [
    {
      key: "1-1",
      title: "优化客户搜索体验",
    },
    {
      key: "1-2",
      title: "修复导出异常",
    },
    {
      key: "1-3",
      title: "整理项目文档",
    },
  ].map((run) => ({
    ...run,
    agent: agentDescriptor,
    status: "completed",
    execution: { status: "completed" },
  }));
  const channels = [
    { id: "manual", label: "手动输入", capabilities: { manualInput: true } },
  ];
  const detail = (key) => ({
    ...runs.find((run) => run.key === key),
    ...(scenario === "long-title" ? {
      title: "【生产】发布中心：补齐刷新热点按钮权限，保持需求列表、会话消息与执行状态的布局，在长标题及窄屏下仍可修改标题和继续对话。".repeat(4).slice(0, 200),
    } : {}),
    sessionId: "session-preview-customer-search",
    agent: { provider: "codex", label: "Codex", capabilities: { history: true, images: true, steer: true, approvals: true, userInput: true, resume: true } },
    status: scenario === "readonly" ? "disconnected" : scenario === "pending" ? "running" : "completed",
    turnId: scenario === "pending" ? "fixture-active-turn" : null,
    items: scenario === "files" ? [{ id: "file-preview-reply", type: "agentMessage", text: '已完成热点刷新按钮的独立菜单权限控制：\n\n- 新增权限 `ai:marketing:hotspot:refresh`，同步种子数据与迁移：[seed.ts](prisma/seed.ts)、[migration.sql](prisma/migrations/menu-v132/migration.sql)。\n- “刷新热点”按钮按权限显示：[hotspot-creation-workspace.vue](' + filePath + ':2)。\n- 增加菜单与迁移回归测试：[menu-v132.test.ts](test/system/menu-v132.test.ts)。\n\n验证通过，可以开始验收。' }] : scenario === "markdown" ? [{
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
        id: "reasoning",
        type: "reasoning",
        text: "检查搜索条件与空结果提示，保持现有表格交互。",
        status: "completed",
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
              kind: "approval", action: "command", blocking: true,
                reason: "构建项目，检查页面修改是否可以正常打包。",
                command: "npm run build",
            },
          ]
        : scenario === "clarification"
          ? [
              {
                id: "input",
                kind: "user-input", blocking: true,
                  questions: [
                    {
                      id: "scope",
                      header: "搜索范围",
                      question: "搜索范围包含哪些字段？",
                      options: [
                        { label: "姓名和手机号", description: "支持两个字段" },
                        { label: "仅姓名", description: "只搜索姓名" },
                      ],
                    },
                    { id: "details", header: "补充说明", question: "是否需要保留已有筛选条件和分页行为？请补充验收细节。", options: null },
                    { id: "timing", header: "实施时间", question: "请说明希望完成的时间，以及需要协调的其他事项。", options: null },
                  ],
              },
            ]
          : [],
    readOnlyReason:
      scenario === "git-deleted" ? "Worktree 文件与本地分支已删除，当前会话仅供查看。" :
      scenario === "readonly" ? "原 worktree 已不可用，当前会话仅供查看。" : "",
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
      // Keep classic scrollbar space visible so short/long page shifts are detectable.
      ignoreDefaultArgs: ["--hide-scrollbars"],
    });
    await require("./not-found.test.cjs").verifyNotFound(browser);
    await require("./skills.test.cjs").verifySkills(browser, origin, output);
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
      const projectResponse = projects.response(url);
      if (projectResponse) return send(projectResponse);
      if (endpoint === "/events") return route.continue();
      if (endpoint === "/auth/session")
        return send({ user: { id: "visual-admin", username: "visual-admin", displayName: "演示管理员", role: "admin", status: "active", mustChangePassword: false }, token: "visual-fixture", settings: { model: null, reasoningEffort: null, permissionMode: "ask", notificationsEnabled: true } });
      if (endpoint === "/account/preferences") return send({ preferences: { unreadRunKeys: [] } });
      if (endpoint === "/workspace-clones") return send({ clones: [] });
      if (url.pathname === "/api/bootstrap")
        return send({
          token: "visual-fixture",
          workspaces: scenario === "welcome" ? [] : (await workspaces.list()).map(entry => ({ ...entry,
            ...(scenario === "project-session" ? { projectId: projects.projectId, permissions: projects.permissions } : {}),
          })),
        });
      if (endpoint === "/bootstrap")
        return send({ token: "visual-fixture", channels, workspace: "123456" });
      if (endpoint === "/runs")
        return send({ runs: scenario === "empty" ? [] : runs });
      if (/^\/runs\/[^/]+\/files$/.test(endpoint))
        return send({ files: [{ path: filePath, status: "M" }, { path: "prisma/seed.ts", status: "M" }, { path: "prisma/migrations/menu-v132/migration.sql", status: "A" }, { path: "test/system/menu-v132.test.ts", status: "A" }] });
      if (/^\/runs\/[^/]+\/file$/.test(endpoint)) {
        const selected = url.searchParams.get("path");
        return send({ path: selected, previousPath: selected, base: "a91c3d2".padEnd(40, "0"), head: "b".repeat(40), scope: "task", status: "M", current: { text: fileCurrent, exists: true, reason: null }, before: { text: fileBefore, exists: true, reason: null }, hunks: structuredPatch(selected, selected, fileBefore, fileCurrent).hunks, comparisonReason: null, readAt: "2026-10-09T06:30:00Z" });
      }
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
          baseBranch: "main", branch: "main", upstream: "origin/main",
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
          repository: "/srv/wt/admin/projects/00000000-0000-4000-8000-000000000001-system",
          projectsRoot: "/srv/wt/admin/projects",
          worktreeRoot: "/srv/wt/admin/worktree/customer-system",
          memberStorageRoot: "/srv/wt",
          projectName: "customer-system",
          baseBranch: "main",
          platform: "linux",
          initCommands: ["pnpm install", "pnpm build"],
        });
      if (endpoint === "/settings/branches")
        return send({ branches: [{ value: "main", label: "origin/main" }] });
      if (endpoint === "/settings/prompts")
        return send({
          templates: Object.fromEntries(Object.entries(promptTemplateCatalog).map(([name, entry]) => [name, entry.defaultTemplate])),
          catalog: promptTemplateCatalog,
          maxLength: MAX_PROMPT_TEMPLATE_LENGTH,
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
        return send({ agent: { provider: "codex", label: "Codex" }, permissionModes: [
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
          const bounds = hint.getBoundingClientRect();
          const previousBounds = previous?.getBoundingClientRect();
          if (
            previous &&
            previous.getClientRects().length &&
            bounds.left < previousBounds.right - 1 &&
            bounds.right > previousBounds.left + 1 &&
            bounds.top < previousBounds.bottom - 1 &&
            bounds.bottom > previousBounds.top + 1
          )
            issues.push("overlapping hint");
        }
        for (const menu of document.querySelectorAll('.app-select-popup')) {
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
        animations: 'disabled',
        ...(!selector ? { fullPage: !(await page.locator("dialog[open]").count()) && !(await page.locator(".session-drawer:visible, .session-file-panel:visible").count()) } : {}),
      });
      captures.push(name);
    }
    async function load(mode = "session") {
      scenario = mode;
      await page.goto(origin + "/?workspace=" + workspace.id);
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
    async function captureLongSessionTitle(suffix) {
      await load("long-title");
      await capture("05-session-long-title-" + suffix);
      await page.getByRole("button", { name: "修改会话标题", exact: true }).click();
      const input = page.getByRole("textbox", { name: "会话标题", exact: true });
      await input.waitFor();
      await capture("05-session-edit-title-" + suffix);
      const bounds = await input.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width,
        "title editing stays inside the available width");
      await input.press("Escape");
      await load();
    }
    async function captureFiles(suffix) {
      await load("files");
      await page.getByRole("button", { name: "hotspot-creation-workspace.vue", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "文件预览与对比" });
      await panel.locator('[data-line="2"]').waitFor();
      await capture("05-file-source-" + suffix);
      await panel.getByRole("button", { name: "变更对比", exact: true }).click();
      await panel.locator(".file-diff-line.added").waitFor();
      await capture("05-file-diff-" + suffix);
      if (page.viewportSize().width > 1100) {
        await selectOption(panel.getByLabel("差异显示方式"), "split");
        await capture("05-file-split-wide-" + suffix);
      }
      await page.keyboard.press("Escape");
      await load();
    }
    async function captureSystemSettings(suffix) {
      if (page.viewportSize().width < 768) await page.getByRole("button", { name: "打开导航", exact: true }).click();
      await page.getByRole("button", { name: "管理中心", exact: true }).click();
      await page.getByRole("navigation", { name: "管理中心", exact: true }).getByRole("button", { name: "目录设置", exact: true }).click();
      await page.getByRole("textbox", { name: "成员目录基础路径", exact: true }).waitFor();
      await capture("03-system-settings-" + suffix);
      await page.getByRole("button", { name: "浏览服务器目录", exact: true }).click();
      await page.getByRole("dialog", { name: "选择服务器目录", exact: true }).waitFor();
      await page.getByRole("button", { name: "打开目录：客户管理系统", exact: true }).waitFor();
      await capture("03-system-directory-picker-" + suffix);
      await page.keyboard.press("Escape");
    }
    async function captureGitViews(suffix) {
      await openSessionContext(page, 'Worktree Git');
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
      const info = page.getByRole("button", { name: "上下文", exact: true });
      const drawer = page.locator(".session-drawer");
      const input = page.getByRole("textbox", { name: "发送给 Codex 的指令", exact: true });
      const inline = await page.locator(".session-body").evaluate(el => el.clientWidth >= 1000);
      await drawer.waitFor({ state: "hidden" });
      assert.equal(await drawer.isVisible(), false, "context starts closed at every viewport");
      await info.click();
      if (inline) {
        const context = await page.locator(".session-details").boundingBox();
        const conversation = await page.locator(".session-conversation").boundingBox();
        assert.ok(context.width >= 319 && context.width <= 321, "desktop context keeps its 320px width");
        assert.ok(context.x >= conversation.x + conversation.width + 20,
          "desktop context sits beside the conversation without covering messages");
        await page.getByRole("button", { name: "收起会话资料", exact: true }).click();
        assert.equal(await drawer.isVisible(), false, "the default context can be collapsed");
      }
      if (!inline) await info.click();
      await input.fill("打开资料时保留这段草稿");
      const before = await page.locator(".session-conversation").boundingBox();
      await page.locator(".timeline").evaluate(el => el.scrollTo({ top: 40, behavior: "instant" }));
      const scrollBefore = await page.locator(".timeline").evaluate(el => el.scrollTop);
      await info.click();
      const bounds = await drawer.boundingBox();
      const after = await page.locator(".session-conversation").boundingBox();
      if (inline) assert.ok(after.width < before.width, "desktop context shares available space with the conversation");
      else assert.equal(after.width, before.width, "compact context overlays instead of shrinking the conversation");
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
      assert.equal(await page.locator(".timeline").evaluate(el => el.scrollTop), scrollBefore);
      await capture("05-session-info-" + suffix);
      await page.keyboard.press("Escape");
      assert.equal(await drawer.isVisible(), false);
      assert.equal(await info.evaluate(el => el === document.activeElement), true, "Escape restores the trigger focus");
      await openSessionContext(page, '需求资料');
      await page.getByRole("heading", { name: "客户搜索体验", exact: true }).waitFor();
      await capture("06-requirement-drawer-" + suffix);
      await openSessionContext(page, 'Worktree Git');
      assert.equal(await page.locator(".session-git").isVisible(), true);
      assert.equal(await page.locator(".requirement-details").isVisible(), false);
      await page.getByRole('button', { name: 'Worktree Git', exact: true }).click();
      assert.equal(await drawer.isVisible(), false, "clicking the active entry collapses the drawer");
      await info.click();
      await page.locator(".ui-topbar").click({ position: { x: 4, y: 4 } });
      assert.equal(await drawer.isVisible(), inline,
        "outside clicks keep the desktop context visible and collapse the compact drawer");
      if (inline) await page.getByRole("button", { name: "收起会话资料", exact: true }).click();
      assert.equal(await input.inputValue(), "打开资料时保留这段草稿");
      await input.fill("");
    }
    async function captureProjects() {
      async function checkIssueCards(width) {
        const content = await page.getByRole('region', { name: /^(需求内容|Bug 信息)$/ }).boundingBox();
        const status = await page.getByRole('region', { name: '状态流转', exact: true }).boundingBox();
        const discussion = await page.getByRole('region', { name: '沟通与记录', exact: true }).boundingBox();
        const files = await page.getByRole('region', { name: '参考资料', exact: true }).boundingBox();
        assert.ok(Math.abs(files.x - content.x) < 1 && files.y >= content.y + content.height + 20,
          'references follow the main document');
        assert.ok(Math.abs(discussion.x - content.x) < 1 && discussion.y >= files.y + files.height + 20,
          'discussion follows attachments in the main document');
        if (width > 768) {
          assert.ok(status.x >= content.x + content.width + 20, `status has a separate sidebar at ${width}`);
        } else {
          assert.ok(status.y >= discussion.y + discussion.height + 16,
            `compact layouts place the auxiliary status below the main document at ${width}`);
          assert.ok(status.x >= 0 && status.x + status.width <= width,
            'compact status controls stay inside the viewport');
        }
      }
      await verifyIssueCreation({ page, origin, projects });
      for (const width of [2560, 1920, 1440, 1280, 1100, 768, 390, 320]) {
        scenario = "session";
        await page.setViewportSize({ width, height: { 2560: 1440, 1920: 1080, 1440: 900, 1280: 720, 1100: 900, 768: 1024, 390: 844, 320: 740 }[width] });
        await page.goto(origin + '/projects');
        await page.locator('.project-card').first().waitFor();
        const directoryHeading = await page.locator('.ui-page-header').boundingBox();
        await capture('10-project-directory-' + width);
        await page.getByRole('button', { name: '新建项目', exact: true }).click();
        await page.getByLabel('项目名称', { exact: true }).fill('客户体验提升计划');
        await capture('10-project-create-' + width);
        await page.goto(origin + '/projects/00000000-0000-4000-8000-000000000001');
        await page.getByRole('heading', { name: '项目概况', exact: true }).waitFor();
        await capture('11-project-overview-' + width);
        const tab = name => openProjectTab(page, name);
        await tab('需求');
        await page.getByRole('button', { name: '优化客户搜索体验', exact: true }).waitFor();
        await capture('12-project-issues-' + width);
        await require('../support/browser-navigation.cjs').openIssueCreate(page);
        await page.getByLabel('标题', { exact: true }).fill('补齐客户详情页面空状态');
        await checkIssueCreationLayout(page, width);
        await capture('12-project-issue-create-' + width);
        await selectOption(page.getByLabel('事项类型', { exact: true }), 'bug');
        await page.getByRole('heading', { name: '新建 Bug', exact: true }).waitFor();
        await checkIssueCreationLayout(page, width);
        await capture('12-project-bug-create-' + width);
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await page.getByRole('button', { name: '优化客户搜索体验', exact: true }).click();
        await page.getByRole('button', { name: '编辑事项', exact: true }).waitFor();
        assert.equal(await page.locator('.project-tab-bar').count(), 0, 'issue details use the standalone prototype layout');
        await page.getByRole('heading', { name: '目标与背景', exact: true }).waitFor();
        await page.getByRole('region', { name: '关联开发', exact: true }).waitFor();
        await checkIssueCards(width);
        await capture('12-project-issue-detail-' + width);
        await page.getByRole('button', { name: '编辑事项', exact: true }).click();
        await capture('12-project-issue-edit-' + width);
        await tab('Bug');
        await page.getByRole('button', { name: '修复导出结果与筛选条件不一致', exact: true }).click();
        await page.getByRole('heading', { name: '复现步骤', exact: true }).waitFor();
        await checkIssueCards(width);
        await capture('13-project-bug-' + width);
        await tab('资产');
        await capture('14-project-assets-list-' + width);
        const assetHeader = page.locator('.project-page > .ui-page-header');
        assert.equal(await assetHeader.getByRole('button', { name: '新建事项', exact: true }).count(), 0);
        await assetHeader.getByRole('button', { name: '新建资产', exact: true }).click();
        await page.getByRole('dialog', { name: '新建资产', exact: true }).waitFor();
        await page.getByRole('button', { name: '保存资产', exact: true }).waitFor();
        await capture('14-project-asset-create-' + width);
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await page.getByRole('button', { name: /测试环境演示账号/ }).click();
        await page.getByRole('button', { name: '显示敏感值', exact: true }).waitFor();
        await capture('14-project-asset-masked-' + width);
        await page.getByRole('button', { name: '编辑资产', exact: true }).click();
        await page.locator('input[type="password"]').waitFor();
        await capture('14-project-asset-edit-' + width);
        await tab('开发任务');
        await page.getByRole('button', { name: '客户搜索与空结果提示', exact: true }).click();
        await page.getByRole('button', { name: '发送资料并继续 Codex', exact: true }).waitFor();
        await capture('15-project-development-' + width);
        await tab('版本');
        await page.getByRole('heading', { name: '版本', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '新建版本', exact: true }).count(), 1);
        assert.equal(await page.locator('.project-page > .ui-page-header').getByRole('button', { name: '新建事项', exact: true }).count(), 0);
        await page.getByRole('heading', { name: 'v0.2', exact: true }).waitFor();
        await capture('15-project-releases-' + width);
        await page.getByRole('article', { name: 'v0.1', exact: true }).getByRole('button', { name: '查看范围', exact: true }).click();
        await page.locator('.release-scope-page h1').filter({ hasText: 'v0.1' }).waitFor();
        await page.getByRole('region', { name: '版本范围', exact: true }).waitFor();
        await capture('15-project-release-scope-' + width);
        await page.reload();
        await page.locator('.release-scope-page h1').filter({ hasText: 'v0.1' }).waitFor();
        await page.getByRole('button', { name: '返回版本', exact: true }).first().click();
        await page.getByLabel('包含已归档版本').check();
        await page.getByRole('article', { name: 'v0.0.9', exact: true }).getByRole('button', { name: '查看范围', exact: true }).click();
        await page.getByText('归档内容只读', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '编辑版本', exact: true }).count(), 0);
        await capture('15-project-releases-archived-' + width);
        await page.getByRole('button', { name: '返回版本', exact: true }).first().click();
        await page.getByLabel('包含已归档版本').uncheck();
        await page.getByRole('heading', { name: 'v0.2', exact: true }).waitFor();
        await page.getByRole('article', { name: 'v0.2', exact: true }).getByRole('button', { name: '查看范围', exact: true }).click();
        await page.getByRole('button', { name: '归档版本', exact: true }).click();
        const archiveDialog = page.getByRole('dialog', { name: '归档版本', exact: true });
        await archiveDialog.waitFor();
        await capture('15-project-releases-confirm-' + width);
        await page.keyboard.press('Escape');
      await page.locator('.app-select-popup:visible').waitFor({ state: 'hidden' });
        assert.equal(await archiveDialog.isVisible(), false);
        if (width === 1440 || width === 320) await verifyReleaseViewStates({ page, origin, projectId: projects.projectId, capture: state => capture(`15-project-releases-${state}-${width}`) });
        await page.goto(origin + '/system?tab=workflows');
        await page.getByRole('heading', { name: '流程编排', exact: true }).waitFor();
        await page.getByRole('group', { name: '事项流程图', exact: true }).waitFor();
        await capture('15-system-workflows-' + width);
        await page.goto(origin + '/projects/00000000-0000-4000-8000-000000000001');
        await tab('成员');
        await capture('16-project-members-list-' + width);
        const addMember = page.getByRole('button', { name: '添加成员', exact: true });
        assert.equal(await addMember.count(), 1);
        assert.equal(await page.locator('.project-page > .ui-page-header').getByRole('button', { name: '新建事项', exact: true }).count(), 0);
        await addMember.click();
        const addDialog = page.getByRole('dialog', { name: '添加成员', exact: true });
        await addDialog.waitFor();
        await capture('16-project-members-add-' + width);
        await page.keyboard.press('Escape');
        await page.locator('.app-select-popup:visible').waitFor({ state: 'hidden' });
        assert.equal(await addDialog.isVisible(), false);
        assert.equal(await addMember.evaluate(element => element === document.activeElement), true);
        await page.getByRole('button', { name: '调整张明（member-1）权限', exact: true }).click();
        await capture('16-project-members-' + width);
        await tab('设置');
        await page.getByRole('heading', { name: '项目配置', exact: true }).waitFor();
        await page.getByRole('button', { name: '保存项目设置', exact: true }).waitFor();
        assert.equal(await page.locator('.project-page > .ui-page-header').getByRole('button', { name: '新建事项', exact: true }).count(), 0);
        await capture('17-project-settings-' + width);
        await tab('提示词');
        await page.getByRole('textbox', { name: 'Bug提示词', exact: true }).waitFor();
        await capture('17-project-prompts-personal-' + width);
        await page.getByRole('group', { name: '提示词作用域' }).getByRole('button', { name: '项目默认', exact: true }).click();
        await page.getByRole('group', { name: '提示词类型' }).getByRole('button', { name: '需求提示词', exact: true }).click();
        await capture('17-project-prompts-default-' + width);
        if (width < 768) await page.getByRole('button', { name: '打开导航', exact: true }).click();
        await page.getByRole('navigation', { name: width < 768 ? '移动主导航' : '账号导航', exact: true }).getByRole('button', { name: '管理中心', exact: true }).click();
        await page.getByRole('navigation', { name: '管理中心', exact: true }).getByRole('button', { name: '部门可用功能', exact: true }).click();
        await page.getByRole('button', { name: '新建部门', exact: true }).click();
        await page.getByLabel('部门名称', { exact: true }).waitFor();
        const departmentHeading = await page.locator('.ui-page-header').boundingBox();
        assert.ok(Math.abs(directoryHeading.x - departmentHeading.x) < 1 &&
          Math.abs(directoryHeading.width - departmentHeading.width) < 1,
        `project directory and scrollable department page keep the same horizontal edges at ${width}px`);
        await capture('18-department-permissions-' + width);
        const permissionCategories = page.getByRole('navigation', { name: '权限分类' });
        await permissionCategories.getByRole('button', { name: 'Agent', exact: true }).click();
        await page.getByRole('checkbox', { name: '认领并启动开发任务', exact: true }).check();
        await capture('18-department-details-' + width, '.permission-details');
        await page.getByRole('searchbox', { name: '搜索权限', exact: true }).fill('不存在的权限');
        await capture('18-department-empty-' + width, '.permission-details');
        await page.getByRole('navigation', { name: width < 768 ? '移动端导航' : '主导航', exact: true }).getByRole('button', { name: '项目', exact: true }).click();
        await page.locator('.project-card').first().waitFor();
        const returnedHeading = await page.locator('.page-heading').boundingBox();
        assert.ok(Math.abs(returnedHeading.x - departmentHeading.x) < 1 &&
          Math.abs(returnedHeading.width - departmentHeading.width) < 1,
        `returning to the short project directory preserves horizontal edges at ${width}px`);
        await load('project-session');
        await page.getByRole('button', { name: '返回项目协作', exact: true }).waitFor();
        await capture('19-project-session-' + width);
        await page.getByRole('button', { name: '独立开发', exact: true }).click();
        await page.getByRole('heading', { name: '独立开发', exact: true }).waitFor();
        await capture('20-manual-development-' + width);
      }
    }
    await require('./workbench.test.cjs').verifyWorkbench(browser);
    await require('./quick-entry.test.cjs').verifyQuickEntry(browser);
    await captureProjects();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await load();
    await selectOption(page.getByRole('combobox', { name: '外观主题', exact: true }), 'dark');
    await capture('21-dark-session');
    await captureMarkdown('dark');
    await captureFiles('dark');
    await captureSystemSettings('dark');
    await selectOption(page.getByRole('combobox', { name: '外观主题', exact: true }), 'light');
    await page.setViewportSize({ width: 1440, height: 1200 });
    await load();
    await capture("05-session-desktop");
    await captureMarkdown("desktop");
    await captureFiles("desktop");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await capture("05-session-1920x1080");
    await capture("05-session-header-1920x1080", ".session-header");
    await page.getByRole("button", { name: "修改会话标题", exact: true }).click();
    await page.getByRole("textbox", { name: "会话标题", exact: true }).waitFor();
    await capture("05-session-edit-header-1920x1080", ".session-header");
    await page.getByRole("textbox", { name: "会话标题", exact: true }).press("Escape");
    const wideLayout = await page.evaluate(() => {
      const timeline = document.querySelector(".timeline");
      const style = window.getComputedStyle(timeline);
      const composer = document.querySelector(".composer").getBoundingClientRect();
      return {
        pageHeight: document.documentElement.scrollHeight,
        timelineHeight: timeline.clientHeight,
        conversationHeight: document.querySelector(".session-conversation").clientHeight,
        conversationWidth: parseFloat(style.getPropertyValue("--conversation-width")),
        messageWidth: timeline.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        composerWidth: composer.width,
        composerBottom: composer.bottom,
      };
    });
    assert.ok(wideLayout.pageHeight <= 1082, "desktop conversation fits the viewport without a second page scrollbar");
    assert.ok(wideLayout.timelineHeight >= wideLayout.conversationHeight * 0.65,
      "history occupies most of the conversation beside the execution context");
    assert.ok(wideLayout.messageWidth <= 902 && wideLayout.messageWidth >= 420,
      "desktop context leaves a readable conversation within the design token's line-width limit");
    assert.ok(Math.abs(wideLayout.messageWidth - wideLayout.composerWidth) <= 82,
      "history and composer keep a centered readable column: " + JSON.stringify(wideLayout));
    assert.ok(wideLayout.composerBottom <= 1080, "the input stays reachable within the full HD viewport");
    await captureSessionDrawer("1920x1080");
    await page.setViewportSize({ width: 2560, height: 1440 });
    await load();
    await capture("05-session-2560x1440");
    await captureSessionDrawer("2560x1440");
    await page.setViewportSize({ width: 1280, height: 720 });
    await load();
    await capture("05-session-1280x720");
    await captureSessionDrawer("1280x720");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await load();
    await captureLongSessionTitle("1920x1080");
    await page.setViewportSize({ width: 1920, height: 855 });
    await capture("05-session-wide");
    await page.setViewportSize({ width: 1440, height: 1200 });
    await captureSessionDrawer("desktop");
    await captureGitViews("desktop");
    await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
    await page.locator('.app-select-popup:visible [role="listbox"]').waitFor();
    await capture('05-permission-menu-desktop');
    await page.keyboard.press('Escape');
    await page.locator('.app-select-popup:visible').waitFor({ state: 'hidden' });
    await openSessionContext(page, '需求资料');
    await page
      .getByRole("heading", { name: "客户搜索体验", exact: true })
      .waitFor();
    await capture("06-requirement-details");
    await page.locator(".requirement-prompt > summary").click();
    await page.locator(".requirement-prompt").scrollIntoViewIfNeeded();
    await capture("06-requirement-prompt");
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
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: '提交回答', exact: true }).scrollIntoViewIfNeeded();
      await capture('08-clarification-' + width);
      const box = await page.getByRole('button', { name: '提交回答', exact: true }).boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 900, 'question submit remains reachable');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await load("readonly");
    await capture("08-readonly");
    await load("git-deleted");
    await openSessionContext(page, 'Worktree Git');
    await capture("09-worktree-deleted");
    await load("git-unpublished");
    await openSessionContext(page, 'Worktree Git');
    await page.locator(".session-git").getByText("分支尚未发布", { exact: true }).waitFor();
    await capture("09-worktree-unpublished");
    await load('pending');
    await page.getByText(/下一轮生效/).first().waitFor();
    await capture('08-settings-pending');
    await load('permission-unavailable');
    await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
    assert.equal(await page.locator('.ant-select-item-option:has(.app-select-option[data-value="auto"])').isDisabled(), true);
    await capture('08-permission-unavailable');
    await page.keyboard.press('Escape');
    await page.locator('.app-select-popup:visible').waitFor({ state: 'hidden' });
    await load('settings-error');
    await page.getByRole('combobox', { name: 'Codex 模型', exact: true }).click();
    await page.locator('.app-select-option[data-value="example-model"]').click();
    await page.getByText(/模拟执行设置保存失败，请重试。/).waitFor();
    await capture('08-settings-save-error');
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await load();
      await capture("05-session-" + width);
      if (width === 320) await captureLongSessionTitle(width);
      await captureMarkdown(width);
      await captureFiles(width);
      await captureSessionDrawer(width);
      await captureGitViews(width);
      const composer = page.locator('.composer-toolbar');
      await composer.scrollIntoViewIfNeeded();
      await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
      await page.locator('.app-select-popup:visible [role="listbox"]').waitFor();
      await capture('05-permission-menu-' + width);
      await page.keyboard.press('Escape');
      await page.locator('.app-select-popup:visible').waitFor({ state: 'hidden' });
      await load('long-model');
      await capture('05-long-model-' + width);
      await page.getByRole('combobox', { name: 'Codex 模型', exact: true }).click();
      await page.locator('.app-select-popup:visible [role="listbox"]').waitFor();
      await capture('05-model-menu-' + width);
      await page.keyboard.press('Escape');
      await page.locator('.app-select-popup:visible').waitFor({ state: 'hidden' });
      await page.getByRole('combobox', { name: '思考强度', exact: true }).click();
      await page.locator('.app-select-popup:visible [role="listbox"]').waitFor();
      await capture('05-effort-menu-' + width);
      await page.keyboard.press('Escape');
      await page.locator('.app-select-popup:visible').waitFor({ state: 'hidden' });
      await captureSystemSettings(width);
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
