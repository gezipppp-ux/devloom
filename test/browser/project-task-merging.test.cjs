const { selectOption } = require("../support/select.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");
const { selectRemoteBranch } = require("../support/remote-branch-select.cjs");

async function verifyProjectTaskMerging({ page, origin, project, database, content, admin, output, clients }) {
  const issues = [];
  for (const title of ["批量分配：搜索需求", "批量分配：搜索结果修复"]) issues.push(await content.createIssue(project.id, admin, { type: "requirement", title, qaOwnerId: admin.id }));
  const starts = () => clients.flatMap(client => client.calls).filter(call => call.method === "turn/start").length;
  const before = starts();
  await page.goto(`${origin}/projects/${project.id}?tab=issues&q=${encodeURIComponent("批量分配")}`);
  for (const issue of issues) await page.getByRole("checkbox", { name: `选择事项 ${issue.number}`, exact: true }).check();
  await page.getByRole("button", { name: "指派", exact: true }).click();
  const assignment = page.getByRole("dialog", { name: "指派", exact: true });
  await selectOption(assignment.getByLabel("开发负责人", { exact: true }), admin.id);
  await assignment.getByRole("button", { name: "确认指派", exact: true }).click();
  await assignment.waitFor({ state: 'hidden' });
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'issues', 'assignment preserves the issue list');
  assert.equal(new URL(page.url()).searchParams.get('q'), '批量分配', 'assignment preserves filters');
  await page.getByRole('checkbox', { name: `选择事项 ${issues[0].number}`, exact: true, disabled: true }).waitFor();
  await page.goto(`${origin}/projects/${project.id}?tab=tasks`);
  await page.getByRole("button", { name: "我的开发任务", exact: true }).click();
  assert.equal(await page.locator('.ui-selection-bar').count(), 0, "merge controls appear only after selection");
  await page.getByRole("checkbox", { name: `选择开发任务 ${issues[0].title}`, exact: true }).check();
  assert.equal(await page.getByRole("button", { name: "合并所选任务（1）", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "项目全部任务", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("taskScope") === "all");
  await page.locator('.ui-selection-bar').waitFor({ state: 'hidden' });
  await page.goto(`${origin}/development?projectId=${project.id}`);
  for (const issue of issues) await page.getByRole("checkbox", { name: `选择开发任务 ${issue.title}`, exact: true }).check();
  const plans = await database.client.developmentTask.findMany({ where: { issueLinks: { some: { issueId: { in: issues.map(issue => issue.id) } } } } });
  assert.equal(plans.length, 2);
  assert.equal(starts(), before, "assignment does not execute");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, `my-development-tasks-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "合并所选任务（2）", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "合并开发任务", exact: true });
  await dialog.getByLabel("合并后的任务标题", { exact: true }).fill("搜索功能与缺陷统一开发");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
    await dialog.getByRole("button", { name: "确认合并", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `merge-development-${width}.png`), fullPage: false });
  }
  await page.route(`**/projects/${project.id}/tasks/merge`, route => route.fulfill({ status: 409, json: { error: "模拟合并冲突，请刷新任务后重试。" } }), { times: 1 });
  await dialog.getByRole("button", { name: "确认合并", exact: true }).click();
  await page.getByText("模拟合并冲突，请刷新任务后重试。", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("合并后的任务标题", { exact: true }).inputValue(), "搜索功能与缺陷统一开发");
  await dialog.getByRole("button", { name: "确认合并", exact: true }).click();
  await page.getByRole("heading", { name: "搜索功能与缺陷统一开发", exact: true }).waitFor();
  const id = new URL(page.url()).searchParams.get("task");
  const merged = await database.client.developmentTask.findUnique({ where: { id } });
  assert.equal(merged.status, "planned");
  assert.equal(starts(), before, "merging does not execute");
  assert.equal(await database.client.issueDevelopmentClaim.count({ where: { taskId: id } }), 2);
  assert.equal(await database.client.developmentTask.count({ where: { id: { in: plans.map(task => task.id) }, status: "merged" } }), 2);
  await page.goto(`${origin}/projects/${project.id}?tab=issues&issue=${issues[0].id}`);
  const taskLink = page.getByRole("link", { name: "查看开发任务", exact: true });
  await taskLink.waitFor();
  assert.equal(await page.getByRole('button', { name: '认领', exact: true, disabled: false }).count(), 0, 'an assigned issue cannot be claimed again');
  assert.equal(await page.getByRole("button", { name: "指派", exact: true }).isDisabled(), true);
  await page.screenshot({ path: path.join(output, "assigned-issue-320.png"), fullPage: true });
  await taskLink.click();
  assert.equal(new URL(page.url()).searchParams.get("task"), id);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '开始开发', exact: true }).click();
  await selectRemoteBranch(page);
  await page.getByRole('checkbox', { name: '我已确认任务范围、起始分支和执行设置。', exact: true }).check();
  await page.getByRole("button", { name: "启动 Codex 开发", exact: true }).click();
  await page.getByRole("button", { name: "进入 Codex 会话", exact: true }).click();
  await page.getByRole("button", { name: "■ 停止", exact: true }).waitFor();
  assert.equal(starts(), before + 1);
  await page.getByRole("button", { name: "■ 停止", exact: true }).click();
  await page.getByRole("button", { name: "■ 停止", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "返回项目协作", exact: true }).click();
  await page.getByRole("heading", { name: "搜索功能与缺陷统一开发", exact: true }).waitFor();
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "标记开发任务完成", exact: true }).count(), 0, "unverified scope cannot be marked completed");
  await page.goto(origin + '/projects/' + project.id + '?tab=issues&issue=' + issues[0].id);
  await page.getByRole("button", { name: "提交验证", exact: true }).click();
  const publishing = page.getByRole("dialog", { name: "提交验证", exact: true });
  await publishing.getByLabel("交付说明", { exact: true }).fill("合并范围已完成实现，验证搜索结果和移动端布局。");
  await selectOption(publishing.getByLabel("交付验证人", { exact: true }), admin.id);
  await publishing.getByRole("checkbox", { name: issues[1].title, exact: true }).check();
  await publishing.getByRole("checkbox", { name: /我确认将以上交付说明/ }).check();
  for (const width of [1920, 2560, 1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1080 });
    assert.ok(await publishing.evaluate(element => element.scrollWidth <= element.clientWidth));
    await publishing.getByRole("button", { name: "提交验证", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'workflow-delivery-' + width + '.png') });
  }
  const submitted = page.waitForResponse(response => response.url().endsWith('/deliveries/batch') && response.request().method() === 'POST');
  await publishing.getByRole("button", { name: "提交验证", exact: true }).click();
  const submission = await submitted;
  assert.equal(submission.status(), 201, await submission.text());
  await publishing.waitFor({ state: "hidden" });
  const deliveries = await database.client.projectDeliverable.findMany({ where: { taskId: id } });
  assert.equal(deliveries.length, 2);
  assert.equal((await database.client.developmentTask.findUnique({ where: { id } })).status, "started");
  for (const delivery of deliveries) {
    assert.equal((await content.readIssue(project.id, delivery.issueId, admin)).status, "pending_verification");
    await page.goto(origin + '/deliveries?projectId=' + project.id + '&delivery=' + delivery.id);
    await page.getByRole("button", { name: "开始验证", exact: true }).click();
    await page.getByRole("button", { name: "开始验证", exact: true }).waitFor({ state: "hidden" });
    assert.equal((await content.readIssue(project.id, delivery.issueId, admin)).status, "verifying");
    for (const checkbox of await page.getByRole("checkbox").all()) if (await checkbox.isEnabled()) await checkbox.check();
    await page.getByRole("button", { name: "验证通过", exact: true }).click();
    await page.getByRole("heading", { name: "验收记录", exact: true }).waitFor();
    assert.equal((await content.readIssue(project.id, delivery.issueId, admin)).status, "implemented");
  }
  assert.equal((await database.client.developmentTask.findUnique({ where: { id } })).status, "completed");
  assert.equal(await database.client.issueDevelopmentClaim.count({ where: { taskId: id } }), 0);
  await content.createIssue(project.id, admin, { type: "requirement", title: "批量分配：尚未认领的事项" });
  await page.goto(`${origin}/projects/${project.id}?tab=issues&q=${encodeURIComponent("批量分配")}`);
  for (const issue of issues) {
    const row = page.locator(".ui-data-table tbody tr").filter({ hasText: issue.title });
    await row.getByText("无进行中的开发任务", { exact: false }).waitFor();
    const text = await row.innerText();
    assert.ok((await row.locator('td[data-label="负责人"]').innerText()).includes(admin.displayName), "completed development still shows the responsible developer beside the avatar");
    assert.ok(text.includes("已实现"));
    assert.equal(text.includes("待认领"), false, "no active task does not mean no responsible developer");
  }
  const unassigned = page.locator(".ui-data-table tbody tr").filter({ hasText: "批量分配：尚未认领的事项" });
  assert.match(await unassigned.innerText(), /待认领/);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, `completed-development-issues-${width}.png`), fullPage: true });
    const filter = page.locator(".project-filter");
    assert.ok(await filter.evaluate(element => {
      const selectors = [...element.querySelectorAll("select")];
      const label = element.querySelector("label").getBoundingClientRect();
      const button = element.querySelector("button").getBoundingClientRect();
      return selectors.every(select => select.clientWidth >= 100) &&
        (label.right <= button.left || button.right <= label.left || label.bottom <= button.top || button.bottom <= label.top);
    }), `filters remain readable and do not overlap at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

module.exports = { verifyProjectTaskMerging };
