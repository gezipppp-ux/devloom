/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");
const { getPromptTemplates } = require("../../src/domain/prompt-templates.cjs");

async function verifyProjectPromptSettings({ page, origin, project, projects, admin, output }) {
  const endpoint = `${origin}/api/projects/${project.id}/prompts`;
  const defaults = getPromptTemplates();
  const scopes = page.getByRole("group", { name: "提示词作用域" });
  const types = page.getByRole("group", { name: "提示词类型" });
  const bug = page.getByRole("textbox", { name: "Bug提示词", exact: true });
  const requirement = page.getByRole("textbox", { name: "需求提示词", exact: true });
  const toggle = page.getByRole("checkbox", { name: "自定义此提示词，仅对我生效" });
  const read = async () => (await page.request.get(endpoint)).json();
  async function save(name, status = 200) {
    const response = page.waitForResponse(r => r.url() === endpoint && r.request().method() === "POST");
    await page.getByRole("button", { name, exact: true }).click();
    assert.equal((await response).status(), status);
    await page.getByRole("button", { name: "保留草稿，加载最新配置", exact: true }).waitFor({ state: "visible" });
  }
  await bug.waitFor();
  assert.equal(await bug.inputValue(), defaults.bug);
  assert.equal(await bug.isDisabled(), true);
  await scopes.getByRole("button", { name: "项目默认", exact: true }).click();
  const customBug = `共享 Bug {{title}}\n{{content}}\n{{images}}`;
  await bug.fill(customBug);
  await types.getByRole("button", { name: "需求提示词", exact: true }).click();
  assert.equal(await requirement.inputValue(), defaults.requirement);
  const customRequirement = `共享需求 {{title}}\n{{content}}\n{{images}}`;
  await requirement.fill(customRequirement);
  await save("保存项目提示词");
  assert.deepEqual((await read()).projectTemplates, { bug: customBug, requirement: customRequirement });
  await scopes.getByRole("button", { name: "我的配置", exact: true }).click();
  assert.equal(await requirement.inputValue(), customRequirement);
  assert.equal(await requirement.isDisabled(), true);
  await types.getByRole("button", { name: "Bug提示词", exact: true }).click();
  await toggle.check();
  const personal = "我的 Bug {{title}}\n{{content}}\n{{images}}\n<img src=x onerror=alert(1)> $& {{image_count}}";
  await bug.fill(personal);
  await page.locator(".prompt-preview > summary").click();
  const preview = page.getByLabel("提示词示例预览", { exact: true });
  assert.equal(await preview.locator("img").count(), 0);
  assert.ok((await preview.innerText()).includes("$& 1"));
  await save("保存我的提示词");
  assert.deepEqual((await read()).overrides, { bug: personal });
  assert.equal((await read()).projectTemplates.bug, customBug);
  await bug.fill("缺少必要占位符");
  await save("保存我的提示词", 400);
  await page.getByRole("alert").filter({ hasText: "缺少必填占位符" }).waitFor();
  assert.equal(await bug.inputValue(), "缺少必要占位符");
  assert.equal((await read()).overrides.bug, personal);
  await bug.fill(personal + "\n本地草稿");
  const current = await read();
  await projects.savePrompts(project.id, admin, { scope: "personal", revision: current.personalRevision, templates: { bug: personal + "\n另一个页面保存" } });
  await save("保存我的提示词", 409);
  assert.equal(await bug.inputValue(), personal + "\n本地草稿");
  await page.getByRole("button", { name: "保留草稿，加载最新配置", exact: true }).click();
  await page.getByRole("combobox", { name: "Bug 提示词冲突处理", exact: true }).selectOption("draft");
  await page.getByRole("button", { name: "确认合并并继续编辑", exact: true }).click();
  await save("保存我的提示词");
  assert.equal((await read()).overrides.bug, personal + "\n本地草稿");
  await page.reload();
  await bug.waitFor();
  assert.equal(await bug.inputValue(), personal + "\n本地草稿");
  await page.locator(".prompt-preview > summary").click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `prompt page fits ${width}px`);
    await page.screenshot({ path: path.join(output, `project-prompts-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "恢复跟随项目", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.getByRole("button", { name: "恢复跟随项目", exact: true }).isVisible(), true);
  }
  await page.getByRole("button", { name: "恢复跟随项目", exact: true }).click();
  assert.equal(await bug.inputValue(), customBug);
  assert.equal((await read()).overrides.bug, personal + "\n本地草稿", "reset requires explicit save");
  await save("保存我的提示词");
  assert.deepEqual((await read()).overrides, {});
  await scopes.getByRole("button", { name: "项目默认", exact: true }).click();
  await page.getByRole("button", { name: "恢复内置默认", exact: true }).click();
  await types.getByRole("button", { name: "需求提示词", exact: true }).click();
  await page.getByRole("button", { name: "恢复内置默认", exact: true }).click();
  await save("保存项目提示词");
  assert.deepEqual((await read()).projectTemplates, defaults);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
module.exports = { verifyProjectPromptSettings };
