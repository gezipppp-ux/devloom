/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");
const { productTemplate } = require("../../src/domain/project-permissions.cjs");

async function verifyProjectPermissions({ page, projects, accounts, admin, project, output }) {
  const department = (await projects.saveDepartment(admin, { name: "权限预览测试部门", permissions: productTemplate })).department;
  const user = await accounts.create({ username: "permission-preview", password: "fixture-password", departmentId: department.id }, admin);
  await page.reload();
  await page.getByRole("navigation", { name: "项目功能" }).getByRole("button", { name: "成员", exact: true }).click();
  await page.getByRole("heading", { name: "项目分工与授权", exact: true }).waitFor();
  const select = page.getByLabel("用户", { exact: true });
  await select.selectOption(user.id);
  assert.equal(await page.getByRole("button", { name: "保存成员", exact: true }).isEnabled(), true, "new members receive project visibility");
  await page.getByLabel("权限组合", { exact: true }).selectOption("agent");
  await page.getByText(/部门未开放：.*启动开发任务/).waitFor();
  assert.equal(await page.getByRole("button", { name: "添加Agent 开发组合", exact: true }).isDisabled(), true, "a blocked core capability cannot masquerade as a successful combination");
  await page.getByLabel("权限组合", { exact: true }).selectOption("product");
  await page.getByRole("button", { name: "添加产品协作组合", exact: true }).click();
  await page.getByText(/保存后实际可用功能：/).waitFor();
  assert.equal((await page.getByText(/保存后实际可用功能：/).textContent()).includes("启动开发任务"), false);
  await page.getByRole("button", { name: "保存成员", exact: true }).click();
  await page.getByRole("button", { name: "调整permission-preview（permission-preview）权限", exact: true }).waitFor();
  assert.equal(await select.locator(`option[value="${user.id}"]`).count(), 0, "active member is excluded from add candidates");
  await page.getByRole("button", { name: "调整permission-preview（permission-preview）权限", exact: true }).click();
  await page.getByLabel("成员状态", { exact: true }).selectOption("disabled");
  await page.getByRole("button", { name: "保存成员", exact: true }).click();
  await page.getByRole("button", { name: "恢复permission-preview（permission-preview）成员", exact: true }).waitFor();
  assert.equal(await select.locator(`option[value="${user.id}"]`).count(), 0, "historical member has an explicit restore action");
  await page.getByRole("button", { name: "恢复permission-preview（permission-preview）成员", exact: true }).click();
  assert.equal(await page.getByLabel("成员状态", { exact: true }).inputValue(), "active");
  await page.getByRole("button", { name: "保存成员", exact: true }).click();
  await page.getByRole("button", { name: "调整permission-preview（permission-preview）权限", exact: true }).waitFor();
  assert.equal((await projects.members(project.id, admin)).members.filter(member => member.userId === user.id).length, 1);
  await page.getByRole("button", { name: "调整admin（admin）权限", exact: true }).click();
  await page.getByLabel("权限组合", { exact: true }).selectOption("product");
  await page.getByRole("button", { name: "添加产品协作组合", exact: true }).click();
  await page.getByText(/高级权限细项/).click();
  assert.equal(await page.getByRole("checkbox", { name: "管理项目成员", exact: true }).isChecked(), true, "adding work content preserves management");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(output, `permissions-${width}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `permissions page fits ${width}px`);
  }
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function verifyDepartmentCapabilities({ page, output }) {
  await page.getByRole("heading", { name: "部门可用功能", exact: true }).waitFor();
  assert.equal(await page.getByLabel("权限组合", { exact: true }).count(), 0, "department configuration is a capability ceiling, not project work assignments");
  const cards = page.locator(".permission-capabilities");
  assert.equal(await cards.getByRole("checkbox").count(), 6);
  await cards.getByRole("checkbox", { name: "Agent 开发", exact: true }).check();
  assert.equal(await cards.getByRole("checkbox", { name: "代码操作", exact: true }).isChecked(), true, "department capabilities include required code access");
  await cards.getByRole("checkbox", { name: "代码操作", exact: true }).uncheck();
  assert.equal(await cards.getByRole("checkbox", { name: "Agent 开发", exact: true }).isChecked(), false, "removing required capability also removes dependent execution");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(output, `department-capabilities-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
module.exports = { verifyProjectPermissions, verifyDepartmentCapabilities };
