/* global document */
const assert = require("node:assert/strict");
const { selectOption, selectValue, selectOptions, selectPreference } = require("../support/select.cjs");
const { openIssueCreate } = require("../support/browser-navigation.cjs");
const { setMarkdown, markdownValue, pasteImage } = require("../support/issue-markdown.cjs");

async function verifyIssueCreation({ page, origin, projects }) {
  const projectPath = `/projects/${projects.projectId}`;
  const listPath = `${projectPath}?tab=issues&q=客户`;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + listPath);
  const trigger = page.getByRole("button", { name: "新建事项", exact: true });
  await trigger.waitFor();
  assert.equal(await trigger.count(), 1, "the project list has one creation entry");
  await trigger.focus(); await trigger.press("ArrowDown");
  await page.getByRole("menuitem", { name: "新建需求", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.ok(await trigger.evaluate(element => element === document.activeElement));
  await trigger.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "新建 Bug", exact: true }).waitFor();
  for (const field of await page.locator(".issue-fields-content .markdown-editor").all()) {
    const canvas = field.locator('[contenteditable="true"]');
    await canvas.waitFor();
    assert.ok((await canvas.boundingBox()).height >= 160, "each empty Bug writing field stays expanded");
  }
  assert.equal(await page.locator(".project-tab-bar, .project-heading").count(), 0);
  assert.equal(await page.getByRole("button", { name: "新建事项", exact: true }).count(), 0);
  assert.equal(await page.locator(".issue-create-page details").count(), 0, "people, dates and tags stay expanded");
  await page.getByLabel("标题", { exact: true }).fill("保留类型切换草稿");
  await setMarkdown(page, "描述", "公共描述");
  await setMarkdown(page, "复现步骤", "打开页面后再次导出");
  await pasteImage(page, "描述", "type-switch.png");
  const description = await markdownValue(page);
  assert.ok((await selectOptions(page.getByLabel("业务负责人", { exact: true }))).some(option => option.value === "member-dev"));
  assert.ok(!(await selectOptions(page.getByLabel("测试负责人", { exact: true }))).some(option => option.value === "member-dev"));
  assert.ok(!(await selectOptions(page.getByLabel("业务验收人", { exact: true }))).some(option => option.value === "member-dev"));
  await selectOption(page.getByLabel("业务负责人", { exact: true }), "member-1");
  await selectOption(page.getByLabel("测试负责人", { exact: true }), "member-1");
  await selectOption(page.getByLabel("业务验收人", { exact: true }), "member-2");
  await selectOption(page.getByLabel("关注人", { exact: true }), ["member-2"]);
  await page.getByLabel("截止日期", { exact: true }).fill("2026-10-25");
  await page.getByLabel("标签", { exact: true }).fill("画布, 体验");
  await page.getByLabel("标签", { exact: true }).press("Tab");
  await selectOption(page.getByLabel("事项类型", { exact: true }), "requirement");
  await page.getByRole("heading", { name: "新建需求", exact: true }).waitFor();
  assert.equal(await markdownValue(page), description);
  assert.equal(await markdownValue(page, "复现步骤"), "打开页面后再次导出");
  await page.getByRole("button", { name: "添加一条", exact: true }).click();
  await page.getByLabel("验收标准第 1 条").fill("筛选结果与导出一致");
  await selectOption(page.getByLabel("业务验收人", { exact: true }), "member-dev");
  await selectOption(page.getByLabel("事项类型", { exact: true }), "bug");
  await page.getByText("当前负责人缺少流程所需权限，请选择有权限的成员。", { exact: true }).waitFor();
  await selectOption(page.getByLabel("业务验收人", { exact: true }), "member-2");
  assert.equal(await page.getByLabel("验收标准第 1 条").inputValue(), "筛选结果与导出一致");
  assert.equal(await page.getByLabel("标题", { exact: true }).inputValue(), "保留类型切换草稿");
  assert.equal(await selectValue(page.getByLabel("业务负责人", { exact: true })), "member-1");
  assert.deepEqual(await selectValue(page.getByLabel("关注人", { exact: true })), ["member-2"]);
  assert.equal(await page.locator(".markdown-attachments li").count(), 1);
  await selectPreference(page, "locale", "en");
  await page.getByRole("heading", { name: "Owners & watchers", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Date & tags", exact: true }).waitFor();
  await selectPreference(page, "locale", "zh-CN");
  assert.equal(await page.getByLabel("标题", { exact: true }).inputValue(), "保留类型切换草稿");

  const endpoint = `${origin}/api/projects/${projects.projectId}/issues`;
  const writes = [];
  const failSave = async route => {
    if (route.request().method() !== "POST") return route.fallback();
    writes.push(route.request().postDataJSON());
    await route.fulfill({ status: 500, json: { error: "新建事项模拟保存失败" } });
  };
  await page.route(endpoint, failSave);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "POST");
      await page.getByRole("button", { name: "保存事项", exact: true }).click();
      await response;
      await page.getByRole("button", { name: "保存事项", exact: true, disabled: false }).waitFor();
    }
    assert.equal(writes.length, 2);
    assert.equal(writes[0].requestId, writes[1].requestId, "retry keeps the original creation identity");
    assert.equal(writes[1].type, "bug");
    assert.deepEqual(writes[1].acceptanceCriteria, ["筛选结果与导出一致"]);
    assert.equal(writes[1].businessOwnerId, "member-1");
    assert.equal(writes[1].qaOwnerId, "member-1");
    assert.equal(writes[1].acceptanceOwnerId, "member-2");
    assert.deepEqual(writes[1].watcherIds, ["member-2"]);
    assert.equal(writes[1].dueDate, "2026-10-25");
    assert.deepEqual(writes[1].tags, ["画布", "体验"]);
    assert.equal(writes[1].attachments.length, 1);
    assert.equal(await markdownValue(page), description);
  } finally { await page.unroute(endpoint, failSave); }
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.locator(".project-tab-bar").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("q"), "客户", "cancel returns to the source filters");
  await openIssueCreate(page);
  const emptyDescription = page.getByRole("group", { name: "描述编辑器", exact: true }).locator('[contenteditable="true"]');
  await emptyDescription.waitFor();
  assert.ok((await emptyDescription.boundingBox()).height >= 160, "a new requirement keeps its empty writing area");
  assert.equal(await page.getByLabel("标题", { exact: true }).inputValue(), "");
  assert.equal(await page.locator(".markdown-attachments li").count(), 0);
  await page.getByRole("button", { name: "取消", exact: true }).click();

  for (const source of ["/", `/issues?projectId=${projects.projectId}`]) {
    await page.goto(origin + source);
    await openIssueCreate(page, "Bug");
    const chooser = page.getByRole("dialog", { name: "选择事项所属项目", exact: true });
    await chooser.locator(".ui-project-choices > button").first().click();
    await page.getByRole("heading", { name: "新建 Bug", exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("tab"), "bugs");
    await page.getByRole("button", { name: "取消", exact: true }).click();
  }
}

async function checkIssueCreationLayout(page, width) {
  for (const field of await page.locator(".issue-create-page .markdown-editor").all()) {
    const canvas = field.locator('[contenteditable="true"]');
    await canvas.waitFor();
    assert.ok((await canvas.boundingBox()).height >= 160, `writing area remains expanded at ${width}px`);
  }
  const heading = await page.locator(".issue-create-heading").boundingBox();
  const form = await page.locator(".issue-create-form").boundingBox();
  assert.ok(Math.abs(heading.width - form.width) < 1, "the creation form uses the full standalone page width");
  const main = await page.locator(".issue-fields-main").boundingBox();
  const people = await page.getByRole("group", { name: "责任人与关注人", exact: true }).boundingBox();
  const properties = await page.getByRole("group", { name: "事项属性", exact: true }).boundingBox();
  assert.ok(Math.abs(main.x - people.x) < 1, "responsibilities stay in the main column");
  assert.equal(await page.locator(".issue-create-page details").count(), 0);
  assert.equal(await page.locator(".project-tab-bar").count(), 0);
  if (width > 900) assert.ok(properties.x >= main.x + main.width + 20, "properties have a separate sidebar");
  else assert.ok(properties.y >= people.y + people.height + 20, "compact layouts put properties below people");
  assert.ok(await page.getByLabel("截止日期", { exact: true }).isVisible());
  assert.ok(await page.getByLabel("标签", { exact: true }).isVisible());
}

module.exports = { verifyIssueCreation, checkIssueCreationLayout };
