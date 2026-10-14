const { selectOption, selectValue } = require("../support/select.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { projectVisual } = require("../fixtures/project-visual.cjs");
const { selectRemoteBranch } = require("../support/remote-branch-select.cjs");

async function verifyDevelopmentTaskDetail({ browser, output }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const fixture = projectVisual("fixture-workspace");
  const origin = "http://127.0.0.1:49021", base = `/projects/${fixture.projectId}`;
  const taskUrl = `${origin}${base}?tab=tasks&task=search-task&taskScope=all&taskOffset=30`;
  const apiTask = `/api${base}/tasks/search-task`;
  const initial = structuredClone(fixture.response(new URL(origin + apiTask)).task);
  let task, spaceReady = false, readonly = false, failBranches = false, failStart = false, rejectStart = false;
  let permissionsAvailable = false;
  const writes = [], errors = [];
  const planned = () => ({ ...structuredClone(initial), revision: 1, status: "planned", execution: null, runKey: null, baseBranch: "", baseCommit: null, fetchedAt: null, additions: [], canStart: true, canEdit: true, canComplete: false, canCancel: true, canOpenSession: false });
  const started = (status = "completed") => ({ ...structuredClone(initial), execution: { status, sessionId: "fixture-session" }, canComplete: status === "completed", canCancel: status === "completed" });
  task = planned();
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (endpoint.startsWith("/api/")) {
      if (endpoint === "/api/auth/session") return send({ user: { id: "visual-admin", username: "visual-admin", displayName: "演示管理员", role: "admin", status: "active", mustChangePassword: false }, token: "fixture", settings: {} });
      if (endpoint === "/api/account/git-accounts") return send({ accounts: [] });
      if (endpoint === "/api/bootstrap") return send({ token: "fixture", workspaces: [] });
      if (endpoint === '/api/workspaces/fixture-workspace/models') return send({ models: [{ model: 'fixture-model', label: '测试模型', reasoningEfforts: ['low', 'high'] }] });
      if (endpoint === '/api/workspaces/fixture-workspace/execution-options') return send({ permissionModes: require('../../shared/agent-permissions.json').map(mode => ({ ...mode, available: permissionsAvailable })) });
      if (endpoint === `/api${base}`) {
        const result = fixture.response(url);
        return send({ ...result, project: { ...result.project, status: readonly ? "archived" : "active" }, space: { ...result.space, status: spaceReady ? "ready" : "awaiting_credentials" } });
      }
      if (endpoint === apiTask && request.method() === "GET") return send({ task });
      if (endpoint === `/api${base}/tasks/other-task`) return send({ task: { ...planned(), id: "other-task", title: "切换后的另一任务" } });
      if (endpoint === `/api${base}/tasks`) return send({ tasks: [task], nextOffset: null });
      if (endpoint === `/api${base}/branches` && failBranches) return send({ error: "远端暂不可用，请刷新重试。" }, 502);
      if (endpoint === `/api${base}/branches`) return send({ branches: [{ name: 'main', commit: 'a'.repeat(40) }, { name: 'feature/' + 'long-branch-name-'.repeat(12), commit: 'b'.repeat(40) }], fetchedAt: '2026-10-12T08:00:00Z' });
      if (endpoint.startsWith(apiTask) && request.method() === "POST") {
        const input = request.postDataJSON();
        writes.push({ endpoint, input });
        if (endpoint === apiTask) {
          if (input.revision !== task.revision) return send({ error: "任务已变更，请刷新后重试。" }, 409);
          task = { ...task, ...input, revision: task.revision + 1 };
        } else if (endpoint.endsWith("/start")) {
          if (rejectStart) return send({ error: "启动前校验失败，请修正后重试。" }, 400);
          if (failStart) { task = { ...task, status: "unknown", canStart: false, canEdit: false, canComplete: false, canCancel: false, error: "启动响应中断，请确认原会话。" }; return send({ error: task.error }, 502); }
          task = { ...started("running"), baseBranch: input.baseBranch, additions: [] };
        } else if (endpoint.endsWith("/complete") || endpoint.endsWith("/cancel")) {
          task = { ...task, status: endpoint.endsWith("/complete") ? "completed" : "cancelled", canStart: false, canEdit: false, canComplete: false, canCancel: false };
        } else if (endpoint.endsWith("/issues")) {
          const items = fixture.response(new URL(origin + `/api${base}/issues`)).items.filter(issue => input.issueIds.includes(issue.id));
          task = { ...task, issueIds: [...task.issueIds, ...input.issueIds], additions: [...task.additions, { requestId: input.requestId, status: "ready", issues: items }] };
        } else if (endpoint.endsWith("/continue")) {
          task = { ...task, execution: { status: "running", sessionId: "fixture-session" }, canComplete: false, canCancel: false, additions: task.additions.map(batch => ({ ...batch, status: "sent" })) };
        }
        return send({ task });
      }
      const result = fixture.response(url);
      return result ? send(result) : send({ error: "Unexpected fixture endpoint " + endpoint }, 404);
    }
    const dist = path.resolve(__dirname, "../../web/dist");
    if (endpoint.startsWith("/assets/")) {
      const file = path.resolve(dist, "." + endpoint); assert.ok(file.startsWith(dist + path.sep));
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith(".js") ? "text/javascript" : "text/css" });
    }
    return route.fulfill({ body: fs.readFileSync(path.join(dist, "index.html")), contentType: "text/html" });
  });
  const button = name => page.getByRole("button", { name, exact: true });
  const capture = async name => {
    await page.locator(".operation-message-close").evaluateAll(buttons => buttons.forEach(button => button.click()));
    for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      // The dropdown portal follows its trigger through ResizeObserver alignment.
      await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, null, { timeout: 5000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: overflow at ${width}`);
      assert.equal(await page.getByRole("navigation", { name: "项目功能" }).count(), 0, "task details own their page heading");
      if (await page.locator('.development-detail-layout').isVisible()) await page.waitForFunction(() => document.querySelector('.development-info').open === window.matchMedia('(min-width: 1200px)').matches);
      if (await page.locator('.development-detail-layout').isVisible()) assert.equal(await page.locator('.development-info').evaluate(el => el.open), width >= 1200, 'task information is collapsed on medium and small screens');
      const branchSelect = page.locator('.development-start-settings .development-branch-select');
      if (await branchSelect.isVisible()) {
        const layout = await branchSelect.evaluate(el => {
          const bounds = selector => {
            const node = el.querySelector(selector);
            if (!node) return null;
            const { top, bottom, left, right, width, height } = node.getBoundingClientRect();
            return { top, bottom, left, right, width, height };
          };
          return { select: bounds('.ant-select'), refresh: bounds(':scope > button'), clear: bounds('.ant-select-clear') };
        });
        if (width > 767) assert.ok(Math.abs(layout.select.bottom - layout.refresh.bottom) <= 1, `${name}: branch refresh aligns with the select at ${width}`);
        else assert.ok(layout.refresh.top >= layout.select.bottom, `${name}: branch refresh follows the select at ${width}`);
        if (layout.clear) {
          assert.ok(layout.clear.top >= layout.select.top && layout.clear.bottom <= layout.select.bottom, `${name}: clear control stays inside the select at ${width}`);
          assert.ok(Math.abs((layout.clear.top + layout.clear.bottom) - (layout.select.top + layout.select.bottom)) <= 2, `${name}: clear control is vertically centered at ${width}`);
          assert.ok(layout.clear.width <= 16 && layout.clear.height <= 16, `${name}: clear icon does not inherit action button sizing at ${width}`);
          assert.ok(Math.abs(layout.clear.width - layout.clear.height) <= 1, `${name}: clear icon retains square bounds at ${width}`);
        }
      }
      const dialog = page.getByRole("dialog");
      if (await dialog.count()) {
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), `${name}: dialog overflow at ${width}`);
        assert.ok(await dialog.getByRole("button", { name: "关闭确认", exact: true }).evaluate(el => el.getBoundingClientRect().width >= 52), "confirmation close label does not shrink vertically");
      }
      await page.screenshot({ path: path.join(output, `task-detail-${name}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  try {
    await page.goto(taskUrl);
    await button("去准备开发环境").waitFor().catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
    assert.equal(await page.getByLabel("任务标题", { exact: true }).count(), 0);
    assert.equal(await page.getByText("尚未启动", { exact: true }).count(), 1);
    await capture("prepare");
    await button("去准备开发环境").click();
    await button("返回待开发任务").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("returnTask"), "search-task");
    await button("返回待开发任务").click();
    await button("去准备开发环境").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("taskOffset"), "30");
    assert.equal(writes.length, 0, "preparation navigation never dispatches development");

    spaceReady = true;
    await page.reload();
    await button('开始开发').waitFor();
    await capture('ready-scope');
    await button('开始开发').click();
    assert.equal(new URL(page.url()).searchParams.get('taskStart'), '1');
    assert.equal(writes.length, 0, 'opening confirmation never dispatches development');
    const branch = page.getByLabel("起始分支", { exact: true });
    assert.equal(await page.getByText("搜索远端分支", { exact: true }).count(), 0, 'search and selection use one field');
    assert.equal(await button("启动 Codex 开发").isDisabled(), true);
    await branch.click();
    await branch.fill('missing-branch');
    await page.getByText('没有匹配的远端分支。', { exact: true }).waitFor();
    assert.equal(await page.locator('.development-branch-select .ant-select-content-has-value').count(), 0, 'search text alone is not a branch selection');
    assert.equal(await button('启动 Codex 开发').isDisabled(), true, 'typing an unknown branch never selects or creates it');
    await capture('branch-search-empty');
    await branch.fill('feature/');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').getByText('feature/' + 'long-branch-name-'.repeat(12), { exact: true }).waitFor();
    await capture('branch-search-long');
    await branch.fill('MAIN');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').getByText('main', { exact: true }).waitFor();
    await branch.press('ArrowDown');
    await branch.press('Enter');
    await page.locator('.development-branch-select .ant-select-content-has-value').filter({ hasText: /^main$/ }).waitFor();
    await page.getByText('当前权限模式不可用，请选择可用的权限模式。', { exact: true }).waitFor();
    assert.equal(await button('启动 Codex 开发').isDisabled(), true, 'unsupported execution permissions block startup');
    permissionsAvailable = true;
    await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
    await button('刷新权限选项').click();
    await page.keyboard.press('Escape');
    await selectOption(page.getByRole('combobox', { name: 'Agent 模型', exact: true }), 'fixture-model');
    await selectOption(page.getByRole('combobox', { name: '思考强度', exact: true }), 'high');
    await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
    await page.locator('.app-select-option[data-value="auto"]').click();
    await page.locator('.development-branch-select .ant-select').hover();
    await page.locator('.development-branch-select .ant-select-clear').click();
    assert.equal(await button('启动 Codex 开发').isDisabled(), true, 'clearing a selected branch blocks startup');
    await selectRemoteBranch(page);
    await branch.click();
    await page.locator('.development-branch-select .ant-select').hover();
    await capture('branch-selected-open');
    await page.keyboard.press('Escape');
    const supplement = "本轮补充要求\n验证移动端，保留 {{title}} 与 $&";
    const supplementInput = page.getByLabel("补充提示词", { exact: true });
    await supplementInput.fill(supplement);
    assert.equal(writes.length, 0, "supplement entry is a local start draft");
    failBranches = true;
    await button("刷新远端分支").click();
    await page.getByText("远端暂不可用，请刷新重试。", { exact: true }).waitFor();
    assert.equal(await button("启动 Codex 开发").isDisabled(), true);
    assert.equal(await branch.inputValue(), "");
    await capture("branch-error");
    failBranches = false;
    await button("刷新远端分支").click();
    await selectRemoteBranch(page);

    await button('返回任务详情').click();
    await button("编辑任务信息").click();
    assert.equal(await page.getByRole("form", { name: "编辑任务信息", exact: true }).getByLabel("补充提示词", { exact: true }).count(), 0);
    await page.getByLabel("任务标题", { exact: true }).fill("保留编辑中的任务标题");
    assert.equal(await button("开始开发").isDisabled(), true);
    await button("调整范围").click();
    await page.getByLabel("搜索追加事项").fill("补充资料");
    await button("搜索事项").click();
    await page.getByRole("checkbox", { name: /修复导出/ }).check();
    await button("刷新状态").click();
    await button("刷新状态").waitFor();
    assert.equal(await page.getByLabel("任务标题", { exact: true }).inputValue(), "保留编辑中的任务标题");
    assert.equal(await supplementInput.inputValue(), supplement);

    assert.equal(await page.getByRole("checkbox", { name: /修复导出/ }).isChecked(), true);
    await button("保存任务信息").click();
    await page.getByRole("heading", { name: "保留编辑中的任务标题", exact: true }).waitFor();
    assert.equal(Object.hasOwn(writes.at(-1).input, "issueIds"), false, "saving information cannot save checked issues");
    assert.equal(Object.hasOwn(writes.at(-1).input, "supplementaryPrompt"), false, "information saves cannot submit the start supplement");
    await button("保存关联事项").click();
    await page.getByText("关联事项已保存，不会启动开发。", { exact: true }).waitFor();
    assert.equal(Object.hasOwn(writes.at(-1).input, "title"), false, "saving issues cannot save information drafts");
    assert.equal(writes.filter(write => write.endpoint.endsWith("/start")).length, 0);
    await capture("ready");
    await button('开始开发').click();
    assert.equal(await supplementInput.inputValue(), supplement, 'returning to the confirmation view preserves the supplement');
    assert.equal(await selectValue(page.getByRole('combobox', { name: '思考强度', exact: true })), 'high', 'returning retains execution preferences');
    assert.equal(await button('启动 Codex 开发').isDisabled(), true, 'explicit scope confirmation is required');
    await page.getByRole('checkbox', { name: '我已确认任务范围、起始分支和执行设置。', exact: true }).check();
    await capture('start-confirmation');
    await selectOption(page.getByRole('combobox', { name: '界面语言', exact: true }), 'en');
    assert.equal(await page.locator('.development-start-settings textarea').inputValue(), supplement, 'language changes preserve the start draft');
    await capture('start-confirmation-en');
    await selectOption(page.getByRole('combobox', { name: 'Interface language', exact: true }), 'zh-CN');
    await button("启动 Codex 开发").click();
    await button("进入 Codex 会话").waitFor();
    assert.equal(await button("标记开发任务完成").count(), 0);
    assert.equal(await button("取消任务并释放认领").count(), 0);
    assert.equal(writes.filter(write => write.endpoint.endsWith("/start")).length, 1);
    assert.equal(writes.at(-1).input.supplementaryPrompt, supplement);
    assert.equal(writes.at(-1).input.model, 'fixture-model');
    assert.equal(writes.at(-1).input.reasoningEffort, 'high');
    assert.equal(writes.at(-1).input.permissionMode, 'auto');
    assert.equal(await supplementInput.count(), 0, "the input belongs to the pre-start form");
    await capture("running");

    task = { ...started(), additions: [] };
    await page.reload();
    await button("标记开发任务完成").waitFor();
    await button("追加关联事项").click();
    await button("搜索事项").click();
    await page.getByRole("checkbox", { name: /修复导出/ }).check();
    await button("保存追加资料（暂不发送）").click();
    await button("发送资料并继续 Codex").waitFor();
    assert.equal(writes.filter(write => write.endpoint.endsWith("/continue")).length, 0);
    assert.equal(writes.at(-1).input.send, false);
    await button("发送资料并继续 Codex").click();
    await page.getByText("Codex：执行中", { exact: true }).waitFor();
    assert.equal(writes.filter(write => write.endpoint.endsWith("/continue")).length, 1);

    task = started();
    await page.reload();
    await button("标记开发任务完成").click();
    let dialog = page.getByRole("dialog", { name: "确认完成开发任务", exact: true });
    await dialog.waitFor();
    const finishes = () => writes.filter(write => write.endpoint.endsWith("/complete")).length;
    assert.equal(finishes(), 0);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await button("标记开发任务完成").evaluate(el => document.activeElement === el), true);
    await button("标记开发任务完成").click();
    await capture("confirm-complete");
    await button("确认完成开发任务").click();
    await page.getByText("任务：已完成", { exact: true }).waitFor();
    assert.equal(finishes(), 1);
    assert.equal(await button("发送资料并继续 Codex").count(), 0);
    await capture("completed");

    task = planned(); failStart = true;
    await page.reload();
    await button('开始开发').click();
    await selectRemoteBranch(page);
    await page.getByRole('checkbox', { name: '我已确认任务范围、起始分支和执行设置。', exact: true }).check();
    await button("启动 Codex 开发").click();
    await page.getByText("任务：执行结果待确认", { exact: true }).waitFor();
    assert.equal(await button("启动 Codex 开发").count(), 0, "ambiguous dispatch cannot be blindly retried");
    await capture("unknown");
    failStart = false;

    task = planned(); readonly = true;
    await page.reload();
    await page.getByRole("heading", { name: "开发任务只读", exact: true }).waitFor();
    assert.equal(await button("启动 Codex 开发").count(), 0);
    assert.equal(await button("取消任务并释放认领").count(), 0);
    await capture("readonly");
    readonly = false;

    task = planned(); rejectStart = true;
    await page.reload();
    await button('开始开发').click();
    await selectRemoteBranch(page);
    await page.getByRole('checkbox', { name: '我已确认任务范围、起始分支和执行设置。', exact: true }).check();
    assert.equal(await supplementInput.inputValue(), "", "newly opened task starts with an empty local draft");
    const longSupplement = supplement.repeat(30);
    await supplementInput.fill(longSupplement);
    await selectOption(page.getByRole('combobox', { name: 'Agent 模型', exact: true }), 'fixture-model');
    await selectOption(page.getByRole('combobox', { name: '思考强度', exact: true }), 'low');
    assert.equal(await page.getByRole('checkbox', { name: '我已确认任务范围、起始分支和执行设置。', exact: true }).isChecked(), false, 'changing execution settings requires confirmation again');
    await page.getByRole('checkbox', { name: '我已确认任务范围、起始分支和执行设置。', exact: true }).check();
    await button("启动 Codex 开发").click();
    await page.getByRole("alert").filter({ hasText: "启动前校验失败" }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="补充提示词"]').disabled);
    assert.equal(await supplementInput.inputValue(), longSupplement, "pre-dispatch failure preserves the start draft");
    assert.equal(await selectValue(page.getByRole('combobox', { name: '思考强度', exact: true })), 'low', 'pre-dispatch failure preserves execution preferences');
    await capture("start-rejected");
    rejectStart = false;
    await button("启动 Codex 开发").click();
    await button("进入 Codex 会话").waitFor();
    assert.equal(writes.at(-1).input.supplementaryPrompt, longSupplement);
    assert.equal(writes.at(-1).input.reasoningEffort, 'low');

    task = { ...planned(), title: "很长的开发任务名称：".repeat(14) };
    await page.reload();
    await button("编辑任务信息").waitFor();
    await capture("long-title");
    await button("取消任务并释放认领").click();
    dialog = page.getByRole("dialog", { name: "取消任务并释放认领", exact: true });
    await dialog.getByRole("button", { name: "确认取消任务", exact: true }).click();
    await page.getByText("任务：已取消", { exact: true }).waitFor();

    task = planned();
    await page.reload();
    await button('开始开发').click();
    await supplementInput.fill("旧任务的启动草稿");
    await button('返回任务详情').click();
    await button("编辑任务信息").click();
    await page.getByLabel("任务标题", { exact: true }).fill("旧任务的迟到保存");
    let releaseSave, saveStarted;
    const saving = new Promise(resolve => { saveStarted = resolve; });
    await page.route("**" + apiTask, async route => {
      if (route.request().method() !== "POST") return route.fallback();
      saveStarted(); await new Promise(resolve => { releaseSave = resolve; });
      return route.fulfill({ json: { task: { ...task, title: "旧任务的迟到保存" } } });
    }, { times: 1 });
    await button("保存任务信息").click();
    await saving;
    await page.goto(`${origin}${base}?tab=tasks&task=other-task`);
    await page.getByRole("heading", { name: "切换后的另一任务", exact: true }).waitFor();
    await button('开始开发').click();
    assert.equal(await supplementInput.inputValue(), "", "task changes cannot inherit another start supplement");
    assert.equal(await selectValue(page.getByRole('combobox', { name: 'Agent 模型', exact: true })), '', 'task changes cannot inherit execution preferences');
    releaseSave();
    await page.getByRole("heading", { name: "切换后的另一任务", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "旧任务的迟到保存", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

module.exports = { verifyDevelopmentTaskDetail };
