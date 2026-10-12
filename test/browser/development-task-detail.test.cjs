/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { projectVisual } = require("../fixtures/project-visual.cjs");

async function verifyDevelopmentTaskDetail({ browser, output }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const fixture = projectVisual("fixture-workspace");
  const origin = "http://127.0.0.1:49021", base = `/projects/${fixture.projectId}`;
  const taskUrl = `${origin}${base}?tab=tasks&task=search-task&taskScope=all&taskOffset=30`;
  const apiTask = `/api${base}/tasks/search-task`;
  const initial = structuredClone(fixture.response(new URL(origin + apiTask)).task);
  let task, spaceReady = false, readonly = false, failBranches = false, failStart = false;
  const writes = [], errors = [];
  const planned = () => ({ ...structuredClone(initial), revision: 1, status: "planned", execution: null, runKey: null, baseBranch: "", baseCommit: null, fetchedAt: null, additions: [], canStart: true, canEdit: true, canComplete: false, canCancel: true, canOpenSession: false });
  const started = (status = "completed") => ({ ...structuredClone(initial), execution: { status, sessionId: "fixture-session" }, canComplete: status === "completed", canCancel: status === "completed" });
  task = planned();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (endpoint.startsWith("/api/")) {
      if (endpoint === "/api/auth/session") return send({ user: { id: "visual-admin", username: "visual-admin", displayName: "演示管理员", role: "admin", status: "active", mustChangePassword: false }, token: "fixture", settings: {} });
      if (endpoint === "/api/account/git-accounts") return send({ accounts: [] });
      if (endpoint === `/api${base}`) {
        const result = fixture.response(url);
        return send({ ...result, project: { ...result.project, status: readonly ? "archived" : "active" }, space: { ...result.space, status: spaceReady ? "ready" : "awaiting_credentials" } });
      }
      if (endpoint === apiTask && request.method() === "GET") return send({ task });
      if (endpoint === `/api${base}/tasks/other-task`) return send({ task: { ...planned(), id: "other-task", title: "切换后的另一任务" } });
      if (endpoint === `/api${base}/tasks`) return send({ tasks: [task], nextOffset: null });
      if (endpoint === `/api${base}/branches` && failBranches) return send({ error: "远端暂不可用，请刷新重试。" }, 502);
      if (endpoint.startsWith(apiTask) && request.method() === "POST") {
        const input = request.postDataJSON();
        writes.push({ endpoint, input });
        if (endpoint === apiTask) {
          if (input.revision !== task.revision) return send({ error: "任务已变更，请刷新后重试。" }, 409);
          task = { ...task, ...input, revision: task.revision + 1 };
        } else if (endpoint.endsWith("/start")) {
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
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: overflow at ${width}`);
      const nav = page.getByRole("navigation", { name: "项目功能" });
      assert.equal(await nav.locator('[aria-current="page"]').textContent(), "开发任务");
      assert.ok(await nav.getByRole("button").evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().width >= 44)), "navigation targets stay readable");
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
    await button("去准备开发环境").waitFor();
    assert.equal(await page.getByLabel("任务标题", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Codex：尚未启动", { exact: true }).count(), 1);
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
    const branch = page.getByLabel("起始分支", { exact: true });
    await branch.locator('option[value="main"]').waitFor({ state: "attached" });
    assert.equal(await button("启动 Codex 开发").isDisabled(), true);
    await branch.selectOption("main");
    failBranches = true;
    await button("刷新远端分支").click();
    await page.getByText("远端暂不可用，请刷新重试。", { exact: true }).waitFor();
    assert.equal(await button("启动 Codex 开发").isDisabled(), true);
    assert.equal(await branch.inputValue(), "");
    await capture("branch-error");
    failBranches = false;
    await button("刷新远端分支").click();
    await branch.locator('option[value="main"]').waitFor({ state: "attached" });
    await branch.selectOption("main");

    await button("编辑任务信息").click();
    await page.getByLabel("任务标题", { exact: true }).fill("保留编辑中的任务标题");
    assert.equal(await button("启动 Codex 开发").isDisabled(), true);
    await button("添加关联事项").click();
    await page.getByLabel("搜索追加事项").fill("补充资料");
    await button("搜索事项").click();
    await page.getByRole("checkbox", { name: /修复导出/ }).check();
    await button("刷新状态").click();
    await button("刷新状态").waitFor();
    assert.equal(await page.getByLabel("任务标题", { exact: true }).inputValue(), "保留编辑中的任务标题");
    assert.equal(await page.getByRole("checkbox", { name: /修复导出/ }).isChecked(), true);
    await button("保存任务信息").click();
    await page.getByRole("heading", { name: "保留编辑中的任务标题", exact: true }).waitFor();
    assert.equal(Object.hasOwn(writes.at(-1).input, "issueIds"), false, "saving information cannot save checked issues");
    await button("保存关联事项").click();
    await page.getByText("关联事项已保存，不会启动开发。", { exact: true }).waitFor();
    assert.equal(Object.hasOwn(writes.at(-1).input, "title"), false, "saving issues cannot save information drafts");
    assert.equal(writes.filter(write => write.endpoint.endsWith("/start")).length, 0);
    await capture("ready");
    await button("启动 Codex 开发").click();
    await button("进入 Codex 会话").waitFor();
    assert.equal(await button("标记开发任务完成").count(), 0);
    assert.equal(await button("取消任务并释放认领").count(), 0);
    assert.equal(writes.filter(write => write.endpoint.endsWith("/start")).length, 1);
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
    await branch.locator('option[value="main"]').waitFor({ state: "attached" });
    await branch.selectOption("main");
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
    releaseSave();
    await page.getByRole("heading", { name: "切换后的另一任务", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "旧任务的迟到保存", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

module.exports = { verifyDevelopmentTaskDetail };
