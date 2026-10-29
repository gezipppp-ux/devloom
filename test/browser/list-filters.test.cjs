/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { selectOption, selectPreference } = require("../support/select.cjs");
const { imageBase64 } = require("../support/issue-markdown.cjs");

async function verifyListFilters({ page, origin, projects }) {
  const output = path.resolve("state/browser/list-filters-live"); fs.mkdirSync(output, { recursive: true });
  const options = {
    releases: [{ id: "release-1", projectId: projects.projectId, name: "v0.4.1", status: "active" }, { id: "release-2", projectId: projects.projectId, name: "v0.4.2", status: "active" }],
    people: [{ id: "visual-admin", displayName: "陈亦" }, { id: "member-1", displayName: "林晓 · 企业客户体验与业务协作负责人" }, { id: "member-2", displayName: "周宁" }],
    statuses: [{ id: "planned", name: "规划中" }, { id: "developing", name: "开发中" }],
  };
  const originalIssue = projects.response(new URL(origin + `/api/projects/${projects.projectId}/issues/search`));
  const originalTask = projects.response(new URL(origin + `/api/projects/${projects.projectId}/tasks/search-task`)).task;
  const items = [
    { ...originalIssue, id: "search", title: "平台模型配置：默认模型弹框提示条与选项间距不足", reporterId: "member-1", developerId: "visual-admin", priority: "high", status: "planned", statusName: "规划中", releaseId: "release-1", releaseName: "v0.4.1" },
    { ...originalIssue, id: "export", title: "客户列表支持按手机号与姓名组合搜索", reporterId: "member-2", developerId: "member-2", priority: "normal", status: "developing", statusName: "开发中", releaseId: "release-2", releaseName: "v0.4.2" },
    { ...originalIssue, id: "empty", title: "【客户反馈】跨项目协作管理：统一筛选、提报人展示及包含多个来源事项的交付验证体验", reporterId: "member-1", developerId: "visual-admin", priority: "normal", status: "planned", statusName: "规划中", releaseId: "release-1", releaseName: "v0.4.1" },
  ];
  const requests = [];
  let failure = false;
  const handler = async route => {
    const url = new URL(route.request().url()), kind = url.pathname.split("/").at(-1);
    if (!["issues", "tasks", "deliveries"].includes(kind)) return route.fallback();
    requests.push(url);
    if (failure) return route.fulfill({ status: 503, json: { error: "读取失败，筛选条件已保留" } });
    const records = items.map((item, index) => kind === "issues" ? item : kind === "tasks" ? { ...originalTask, id: index ? `task-${index}` : "search-task", title: item.title, projectId: projects.projectId, projectName: "MY智营", status: index ? "planned" : "started", releaseId: item.releaseId, releaseName: item.releaseName, executorId: "visual-admin", reporterIds: index === 2 ? ["member-1", "member-2"] : [item.reporterId] } : { ...item, authorId: "visual-admin", status: "pending" });
    const filtered = records.filter(row => ["releaseId", "priority", "ownerId", "reporterId", "status"].every(key => {
      const selected = (url.searchParams.get(key) || "").split(",").filter(Boolean);
      if (!selected.length || selected.includes("all") || selected.includes("active") || selected.includes("not_cancelled")) return true;
      const values = key === "reporterId" ? row.reporterIds || [row.reporterId] : [key === "ownerId" ? row.executorId || row.developerId : row[key]];
      return selected.some(value => values.includes(value));
    }));
    return route.fulfill({ json: { items: filtered, tasks: filtered, people: options.people, total: filtered.length, nextOffset: null, filterOptions: options } });
  };
  const pattern = "**/api/workbench/*";
  const projectPattern = `**/api/projects/${projects.projectId}/*`;
  await page.route(pattern, handler);
  await page.route(projectPattern, handler);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin + `/issues?projectId=${projects.projectId}&offset=30`);
    await page.locator('.ui-data-table tbody tr').first().waitFor();
    const choose = async (label, value) => selectOption(page.getByRole("combobox", { name: label, exact: true }), value);
    await choose("版本", "release-1");
    await page.waitForURL(url => url.searchParams.get("releaseId") === "release-1" && !url.searchParams.has("offset"));
    await choose("提报人", "member-1");
    await page.waitForFunction(() => document.querySelectorAll('.ui-data-table tbody tr').length === 2);
    assert.equal(new URL(page.url()).searchParams.get("reporterId"), "member-1");
    assert(requests.some(url => url.searchParams.get("releaseId") === "release-1" && url.searchParams.get("reporterId") === "member-1"));
    await page.reload();
    await page.locator('.ui-data-table tbody tr').first().waitFor();
    assert.equal(await page.locator('.ui-data-table tbody tr').count(), 2);
    await choose("负责人", "member-2");
    await page.getByText("暂无符合条件的内容", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清空筛选", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.ui-data-table tbody tr').length === 3);
    for (const [tab, key, label] of [["issues", "reporterId", "提报人"], ["tasks", "taskReporterId", "提报人"]]) {
      await page.goto(`${origin}/projects/${projects.projectId}?tab=${tab}`);
      await page.locator('.ui-data-table tbody tr').first().waitFor();
      await choose(label, "member-1");
      await page.waitForURL(url => url.searchParams.get(key) === "member-1");
      await page.waitForFunction(() => document.querySelectorAll('.ui-data-table tbody tr').length === 2);
      await page.screenshot({ path: path.join(output, `project-${tab}-1440.png`), fullPage: true });
    }
    const deliveryRoute = `**/api/projects/${projects.projectId}/deliveries/search`;
    const deliveryDetail = route => route.fulfill({ json: { delivery: { id: "search", title: "筛选返回验证", status: "pending", body: "fixture", checklist: [], checkedItems: [] }, people: [], permissions: [], canReview: false } });
    await page.route(deliveryRoute, deliveryDetail);
    try {
      const location = `/deliveries?projectId=${projects.projectId}&releaseId=release-1&reporterId=member-1&status=pending`;
      await page.goto(origin + location);
      await page.locator('.ui-data-table .ui-title-link').first().click();
      await page.getByRole("heading", { name: "筛选返回验证", exact: true }).waitFor();
      await page.getByRole("button", { name: "← 返回交付", exact: true }).click();
      await page.waitForURL(origin + location);
      await page.waitForFunction(() => document.querySelectorAll('.ui-data-table tbody tr').length === 2);
    } finally { await page.unroute(deliveryRoute, deliveryDetail); }
    for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
      await page.setViewportSize({ width, height });
      for (const [kind, location] of [["issues","issues"],["tasks","development"],["deliveries","deliveries"]]) {
        await page.goto(`${origin}/${location}?projectId=${projects.projectId}`);
        await page.locator('.ui-data-table tbody tr').first().waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${kind} overflow at ${width}`);
        await page.screenshot({ path: path.join(output, `${kind}-${width}.png`), fullPage: true });
      }
      if (width < 768) {
        await page.getByRole("button", { name: "筛选", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "筛选", exact: true });
        await dialog.waitFor();
        await selectOption(dialog.getByRole("combobox", { name: "提报人", exact: true }), "member-2");
        await page.screenshot({ path: path.join(output, `filters-${width}.png`) });
        await dialog.getByRole("button", { name: "查看结果", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(new URL(page.url()).searchParams.get("reporterId"), "member-2");
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/issues?projectId=${projects.projectId}&reporterId=member-1`);
    await page.locator('.ui-data-table').waitFor();
    failure = true;
    await choose("版本", "release-2");
    await page.getByText("读取失败，筛选条件已保留", { exact: true }).first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get("reporterId"), "member-1");
    await page.screenshot({ path: path.join(output, "failure-1440.png") });
    failure = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByText("暂无符合条件的内容", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "empty-1440.png") });
    await selectPreference(page, "locale", "en");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto(`${origin}/development?projectId=${projects.projectId}`);
      await page.locator('.ui-data-table').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.screenshot({ path: path.join(output, `tasks-en-${width}.png`), fullPage: true });
    }
    await selectPreference(page, "locale", "zh-CN");
    const source = `/api/projects/${projects.projectId}/files/00000000-0000-4000-8000-000000000068`;
    const taskRoute = `**/api/projects/${projects.projectId}/tasks/search-task`;
    const detail = route => route.fulfill({ json: { task: { ...originalTask, issues: [{ ...originalIssue, description: `![需求截图](${source})`, images: [{ source, url: `${source}?inline=1` }] }] } } });
    const imageRoute = `**${source}?inline=1`, image = route => route.fulfill({ contentType: "image/png", body: Buffer.from(imageBase64, "base64") });
    await page.route(taskRoute, detail); await page.route(imageRoute, image);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/projects/${projects.projectId}?tab=tasks&task=search-task`);
      await page.locator('.development-scope-view').first().click();
      const picture = page.locator('.markdown-content img');
      await picture.waitFor();
      assert(await picture.evaluate(img => img.complete && img.naturalWidth > 0));
      assert.equal(await picture.getAttribute('src'), `${source}?inline=1`);
      await page.screenshot({ path: path.join(output, 'task-image-1440.png'), fullPage: true });
    } finally { await page.unroute(taskRoute, detail); await page.unroute(imageRoute, image); }
  } finally { await page.unroute(pattern, handler); await page.unroute(projectPattern, handler); }
  console.log("List filters: shared controls, URL restoration, request filters, empty/error states, image mapping and seven viewports passed.");
}
module.exports = { verifyListFilters };
