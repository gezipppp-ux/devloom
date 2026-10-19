/* global document, localStorage */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

async function verifyIssueDeletion({ page, origin, projects }) {
  const output = path.resolve("state/browser/issue-deletion");
  fs.mkdirSync(output, { recursive: true });
  const endpoint = `/api/projects/${projects.projectId}/issues`;
  let issue = { ...projects.response(new URL(origin + endpoint + "/search")), title: "删除信息不明确的需求：保留正确的业务范围、验收依据与关联资料，并确认清理后的列表和待办状态", deletion: { allowed: true, reason: "" } };
  let removed = false, fail = false, releaseDelete;
  const writes = [];
  const routeHandler = async route => {
    const url = new URL(route.request().url());
    if (url.pathname === endpoint) return route.fulfill({ json: { items: removed ? [] : [issue], people: issue.people, nextOffset: null } });
    if (url.pathname === endpoint + "/search") return route.fulfill({ status: removed ? 404 : 200, json: removed ? { error: "项目资料不存在。" } : issue });
    if (url.pathname === endpoint + "/search/delete") {
      writes.push(route.request().postDataJSON());
      if (fail) return route.fulfill({ status: 409, json: { error: "事项已变化，请刷新后重新确认删除。" } });
      await new Promise(resolve => { releaseDelete = resolve; });
      removed = true;
      return route.fulfill({ json: { id: issue.id, deleted: true } });
    }
    return route.fallback();
  };
  await page.route("**/api/projects/**/issues**", routeHandler);
  const location = `${origin}/projects/${projects.projectId}?tab=issues&issue=search&q=保留筛选&status=draft&releaseId=release-1&selection=search`;
  const open = async () => { await page.goto(location); await page.getByRole("heading", { name: issue.title, exact: true }).waitFor(); };
  const more = name => page.getByRole("button", { name, exact: true });
  async function confirm(moreName = "更多操作", deleteName = "删除事项") {
    await more(moreName).click();
    await page.getByRole("menuitem", { name: deleteName }).click();
    const dialog = page.getByRole("dialog", { name: deleteName, exact: true });
    await dialog.waitFor();
    return dialog;
  }
  try {
    for (const locale of ["zh-CN", "en"]) {
      await page.evaluate(value => localStorage.setItem("web-coding.locale", value), locale);
      for (const [width, height] of [[1920, 1080], [2560, 1440], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
        await page.setViewportSize({ width, height });
        await open();
        await page.screenshot({ path: path.join(output, `${locale}-${width}-detail.png`), fullPage: true });
        const moreName = locale === "en" ? "More actions" : "更多操作";
        const dialog = await confirm(moreName, locale === "en" ? "Delete issue" : "删除事项");
        assert.equal(await dialog.getByRole("button", { name: locale === "en" ? "Confirm deletion" : "确认删除", exact: true }).isEnabled(), true);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= height + 1);
        await page.screenshot({ path: path.join(output, `${locale}-${width}-confirmation.png`), fullPage: true });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await more(moreName).evaluate(element => element === document.activeElement), true);
        assert.equal(writes.length, 0, "opening and cancelling never deletes");
      }
    }
    await page.evaluate(() => localStorage.setItem("web-coding.locale", "zh-CN"));
    await page.setViewportSize({ width: 1440, height: 900 });
    issue = { ...issue, type: "bug", deletion: { allowed: false, reason: "事项已关联开发任务或交付记录，不能删除。" } };
    await open();
    let dialog = await confirm();
    assert.equal(await dialog.getByRole("button", { name: "确认删除", exact: true }).isDisabled(), true);
    await dialog.getByText(issue.deletion.reason, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "linked-bug-disabled.png"), fullPage: true });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    issue = { ...issue, release: { ...issue.release, status: "archived" } };
    await open();
    assert.equal(await more("更多操作").count(), 0);
    issue = { ...issue, release: { ...issue.release, status: "active" }, deletion: { allowed: true, reason: "" } };
    const permissionIndex = projects.permissions.indexOf("issue.delete");
    projects.permissions.splice(permissionIndex, 1);
    try { await open(); assert.equal(await more("更多操作").count(), 0); }
    finally { projects.permissions.splice(permissionIndex, 0, "issue.delete"); }
    await open(); fail = true;
    dialog = await confirm();
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    await page.screenshot({ path: path.join(output, "revision-conflict.png"), fullPage: true });
    assert.equal(new URL(page.url()).searchParams.get("issue"), "search");
    assert.equal(await dialog.getByRole("button", { name: "确认删除", exact: true }).count(), 0);
    issue = { ...issue, revision: issue.revision + 1 }; fail = false;
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === endpoint + "/search"), dialog.getByRole("button", { name: "刷新事项后重新确认", exact: true }).click()]);
    dialog = await confirm();
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await dialog.getByRole("button", { name: "正在删除…", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "取消", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), true);
    assert.equal(writes.length, 2);
    releaseDelete();
    await page.getByText("暂无符合条件的事项。", { exact: true }).waitFor();
    const query = new URL(page.url()).searchParams;
    assert.equal(query.has("issue"), false); assert.equal(query.has("selection"), false);
    assert.equal(query.get("q"), "保留筛选"); assert.equal(query.get("status"), "draft"); assert.equal(query.get("releaseId"), "release-1");
    assert.equal(writes.at(-1).revision, issue.revision);
    await page.screenshot({ path: path.join(output, "deleted-empty-list.png"), fullPage: true });
    removed = false;
    await open(); dialog = await confirm();
    const pendingRequest = page.waitForRequest(request => new URL(request.url()).pathname === endpoint + "/search/delete");
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await pendingRequest;
    // Simulate a shell navigation while the native modal blocks pointer input.
    await page.locator('.ui-primary-nav').getByRole("button", { name: "项目", exact: true }).evaluate(element => element.click());
    await page.locator('.project-card').first().waitFor();
    const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoint + "/search/delete");
    releaseDelete(); await lateResponse;
    assert.equal(new URL(page.url()).pathname, "/projects", "late deletion cannot navigate a new page");
    assert.equal(await page.locator('.project-card').count() > 0, true);
  } finally {
    releaseDelete?.();
    await page.unroute("**/api/projects/**/issues**", routeHandler);
    await page.evaluate(() => localStorage.setItem("web-coding.locale", "zh-CN"));
  }
}
module.exports = { verifyIssueDeletion };
