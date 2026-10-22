const assert = require("node:assert/strict");

async function verifyDetailNavigation({ page, origin, projects }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const query = encodeURIComponent("客户");
  const issueList = `/issues?projectId=${projects.projectId}&q=${query}&type=requirement&scope=mine&offset=30`;
  await page.goto(origin + issueList);
  await page.getByRole("button", { name: "优化客户搜索体验", exact: true }).click();
  await page.getByRole("button", { name: "返回事项", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), issueList);
  assert.equal(await page.locator(".ui-primary-nav .active").innerText(), "事项");
  assert.equal(await page.locator(".ui-breadcrumb").innerText(), "事项详情");
  await page.reload();
  await page.getByRole("button", { name: "返回事项", exact: true }).click();
  await page.waitForURL(origin + issueList);
  assert.equal(await page.getByRole("searchbox", { name: "搜索", exact: true }).inputValue(), "客户");
  await page.goBack();
  await page.getByRole("button", { name: "返回事项", exact: true }).waitFor();
  assert.equal(await page.locator(".ui-primary-nav .active").innerText(), "事项");
  await page.goForward();
  await page.waitForURL(origin + issueList);

  const projectList = `/projects/${projects.projectId}?tab=issues&q=${query}`;
  await page.goto(origin + projectList);
  await page.getByRole("button", { name: "优化客户搜索体验", exact: true }).click();
  await page.getByRole("button", { name: "返回事项", exact: true }).waitFor();
  assert.equal(await page.locator(".ui-primary-nav .active").innerText(), "项目");
  await page.getByRole("button", { name: "返回事项", exact: true }).click();
  await page.waitForURL(origin + projectList);

  await page.goto(origin + `/issues?type=bug`);
  await page.getByRole("button", { name: "修复导出结果与筛选条件不一致", exact: true }).click();
  await page.getByRole("button", { name: "返回事项", exact: true }).waitFor();
  assert.equal(await page.locator(".ui-primary-nav .active").innerText(), "事项");
  await page.getByRole("button", { name: "返回事项", exact: true }).click();
  await page.waitForURL(origin + "/issues?type=bug");

  const taskList = `/development?projectId=${projects.projectId}&status=started&q=${query}&offset=30`;
  await page.goto(origin + taskList);
  await page.getByRole("button", { name: "客户搜索与空结果提示", exact: true }).click();
  await page.getByRole("button", { name: "返回任务列表", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "返回任务列表", exact: true }).click();
  await page.waitForURL(origin + taskList);

  for (const value of ["https://example.test/issues", "//example.test/issues", "/personal", "/development"]) {
    await page.goto(origin + `/projects/${projects.projectId}?tab=issues&issue=search&returnTo=${encodeURIComponent(value)}`);
    await page.getByRole("button", { name: "返回事项", exact: true }).click();
    await page.waitForURL(origin + `/projects/${projects.projectId}?tab=issues`);
  }
}

module.exports = { verifyDetailNavigation };
