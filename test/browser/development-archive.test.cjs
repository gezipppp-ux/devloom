/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");
const { selectOption } = require("../support/select.cjs");

async function verifyDevelopmentArchive({ page, origin, projectId, output }) {
  const tasks = [
    { id: "plan", title: "仍待开发的任务", canMerge: true, canArchive: false, status: "planned" },
    { id: "session-a", title: "可归档会话 A", canMerge: false, canArchive: true, status: "started", workspaceId: "ux-workspace", runKey: "archive-a" },
    { id: "session-b", title: "另一个项目中的会话 B", canMerge: false, canArchive: true, status: "completed", workspaceId: "another-workspace", runKey: "archive-b" },
    { id: "readonly", title: "只有查看权限的会话", canMerge: false, canArchive: false, status: "started", workspaceId: "ux-workspace", runKey: "readonly" },
  ].map(task => ({ ...task, projectId, projectName: "归档交互测试", issueIds: [] }));
  const archived = new Set(), writes = [];
  let fail = true;
  let hold = false, releaseArchive, markPending;
  const archivePending = new Promise(resolve => { markPending = resolve; });
  const listRoute = async route => {
    const items = tasks.filter(task => !archived.has(task.id));
    await route.fulfill({ json: { items, people: [], total: items.length, nextOffset: null } });
  };
  const archiveRoute = async route => {
    const endpoint = new URL(route.request().url()).pathname;
    writes.push(endpoint);
    if (hold) { markPending(); await new Promise(resolve => { releaseArchive = resolve; }); }
    if (endpoint.endsWith("archive-b/archive") && fail) return route.fulfill({ status: 409, json: { error: "任务仍有待处理的问题或审批，请先结束本轮。" } });
    archived.add(endpoint.endsWith("archive-a/archive") ? "session-a" : "session-b");
    return route.fulfill({ json: { archivedAt: new Date().toISOString() } });
  };
  await page.route("**/api/workbench/tasks?*", listRoute);
  await page.route("**/api/workspaces/*/runs/*/archive", archiveRoute);
  const select = title => page.getByRole("checkbox", { name: `选择开发任务 ${title}`, exact: true });
  const dialog = page.getByRole("dialog", { name: "归档所选会话", exact: true });
  try {
    await page.goto(origin + "/development");
    await select("可归档会话 A").waitFor();
    assert.equal(await select("只有查看权限的会话").isDisabled(), true);
    await page.getByRole("checkbox", { name: "选择当前页全部任务", exact: true }).check();
    assert.equal(await select("仍待开发的任务").isChecked(), true);
    assert.equal(await select("可归档会话 A").isChecked(), true);
    assert.equal(await page.getByRole("button", { name: "归档所选会话", exact: true }).isDisabled(), true, "plans cannot be archived as sessions");
    await select("仍待开发的任务").uncheck();
    const trigger = page.getByRole("button", { name: "归档所选会话", exact: true });
    await trigger.click();
    assert.equal(writes.length, 0, "opening archive confirmation cannot mutate sessions");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    assert.equal(await select("可归档会话 A").isChecked(), true, "cancelling preserves selection");
    await trigger.click();
    for (const locale of ["zh-CN", "en"]) {
      // Language changes retain the confirmation and selected identities.
      if (locale === "en") { await page.keyboard.press("Escape"); await selectOption(page.locator(".ui-locale"), locale); await page.getByRole("button", { name: "Archive selected sessions", exact: true }).click(); }
      const confirmation = page.getByRole("dialog", { name: locale === "en" ? "Archive selected sessions" : "归档所选会话", exact: true });
      for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `archive page fits ${locale} ${width}`);
        assert.ok(await confirmation.evaluate(element => element.scrollWidth <= element.clientWidth), `archive confirmation fits ${locale} ${width}`);
        await confirmation.getByRole("button", { name: locale === "en" ? "Confirm archive" : "确认归档", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `batch-archive-${locale}-${width}.png`) });
      }
    }
    await page.keyboard.press("Escape");
    await selectOption(page.locator(".ui-locale"), "zh-CN");
    await page.setViewportSize({ width: 1440, height: 900 });
    await trigger.click();
    await dialog.getByRole("button", { name: "确认归档", exact: true }).click();
    await dialog.getByText("任务仍有待处理的问题或审批，请先结束本轮。", { exact: true }).waitFor();
    await page.getByRole("checkbox", { name: "选择开发任务 可归档会话 A", exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual(writes, ["/api/workspaces/ux-workspace/runs/archive-a/archive", "/api/workspaces/another-workspace/runs/archive-b/archive"], "each selected session uses its own workspace");
    assert.equal(await select("另一个项目中的会话 B").isChecked(), true);
    fail = false;
    await dialog.getByRole("button", { name: "重试未归档会话", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await select("另一个项目中的会话 B").waitFor({ state: "hidden" });
    assert.equal(writes.filter(endpoint => endpoint.endsWith("archive-a/archive")).length, 1, "retry never resubmits successful rows");
    assert.equal(writes.filter(endpoint => endpoint.endsWith("archive-b/archive")).length, 2);
    await page.getByText("共 2 个任务", { exact: true }).waitFor();
    assert.equal(writes.some(endpoint => /\/(start|delete)$/.test(endpoint)), false);
    await select("仍待开发的任务").check();
    await page.getByRole("button", { name: "取消选择", exact: true }).click();
    await page.locator(".ui-selection-bar").waitFor({ state: "hidden" });
    archived.clear();
    await page.reload();
    await select("可归档会话 A").check();
    await select("另一个项目中的会话 B").check();
    await trigger.click();
    hold = true;
    const beforeNavigation = writes.length;
    await dialog.getByRole("button", { name: "确认归档", exact: true }).click();
    await archivePending;
    await page.goto(origin + "/issues");
    releaseArchive();
    await page.getByRole("heading", { name: "事项", exact: true }).waitFor();
    assert.equal(writes.length, beforeNavigation + 1, "leaving the page stops the remaining batch writes");
  } finally {
    await page.unroute("**/api/workbench/tasks?*", listRoute);
    await page.unroute("**/api/workspaces/*/runs/*/archive", archiveRoute);
  }
}
module.exports = { verifyDevelopmentArchive };
