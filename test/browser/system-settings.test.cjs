const { navigateWorkspace } = require("../support/browser-navigation.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function verifySystemSettings(browser, { origin, output, errors, directory, repository, workspace }) {
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => errors.push(error.message));
  const base = path.join(directory, "system worktrees");
  const selected = path.join(base, "selected");
  fs.mkdirSync(selected, { recursive: true });
  for (let index = 0; index < 103; index++)
    fs.mkdirSync(path.join(base, `folder-${String(index).padStart(3, "0")}`));
  const initial = await (await page.request.get(`${origin}/api/system/settings`)).json();
  const baseField = page.getByRole("textbox", { name: "成员目录基础路径", exact: true });
  const saveBase = page.getByRole("button", { name: "保存基础目录", exact: true });
  const readonlyRepository = page.getByLabel("项目代码仓库路径", { exact: true });
  const preview = page.getByLabel("工作区 Worktree 完整路径", { exact: true });
  const settingsEndpoint = `${origin}/api/workspaces/${workspace.id}/settings`;
  const readWorkspace = async () => (await page.request.get(settingsEndpoint)).json();
  const readSystem = async () => (await page.request.get(`${origin}/api/system/settings`)).json();
  const openSystem = async () => {
    const menu = page.getByRole("button", { name: "打开导航", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: "管理中心", exact: true }).click();
    await page.getByRole("navigation", { name: "管理中心", exact: true }).getByRole("button", { name: "目录设置", exact: true }).click();
    await baseField.waitFor();
  };
  const openWorkspace = async () => {
    await navigateWorkspace(page, workspace);
    await page.getByRole("heading", { name: `${workspace.name} · 工作区设置`, exact: true }).waitFor();
    await preview.waitFor();
  };
  const saveWorkspace = async () => {
    let captured;
    const pending = new Promise((resolve) => { captured = resolve; });
    await page.route(settingsEndpoint, (route) => {
      if (route.request().method() !== "POST") return route.continue();
      captured(route);
    }, { times: 1 });
    const response = page.waitForResponse((entry) => entry.url() === settingsEndpoint && entry.request().method() === "POST");
    await page.getByRole("button", { name: "保存执行设置", exact: true }).click();
    const held = await pending;
    for (const label of ["新任务开发分支", "Worktree 初始化命令"])
      assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true,
        `${label} must not accept draft changes while the save response is pending`);
    await held.continue();
    assert.equal((await response).status(), 200);
    await page.getByText("设置已保存，新任务将使用此配置。", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Worktree 初始化命令", { exact: true }).isDisabled(), false, "successful saving unlocks the form");
  };
  const runPosts = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/runs"))
      runPosts.push(request.url());
  });
  try {
    await page.goto(`${origin}/?workspace=${workspace.id}`);
    await preview.waitFor();
    await openSystem();
    await page.waitForFunction((value) =>
      document.querySelector('input[aria-label="成员目录基础路径"]')?.value === value, initial.memberStorageRoot);
    await baseField.fill(base);
    const savedBase = page.waitForResponse((entry) => entry.url() === `${origin}/api/system/settings` && entry.request().method() === "POST");
    await saveBase.click();
    assert.equal((await savedBase).status(), 200);
    assert.equal((await readSystem()).memberStorageRoot, base);
    await page.reload();
    if (!(await baseField.count())) await openSystem();
    await page.waitForFunction((value) =>
      document.querySelector('input[aria-label="成员目录基础路径"]')?.value === value, base);

    const failedDraft = path.join(directory, "unsaved worktrees");
    await baseField.fill(failedDraft);
    await page.route("**/api/system/settings", (route) => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ error: "模拟基础目录保存失败" }),
    }), { times: 1 });
    await saveBase.click();
    await page.getByRole("alert").filter({ hasText: "模拟基础目录保存失败" }).waitFor();
    assert.equal(await baseField.inputValue(), failedDraft, "save failure retains the draft");
    assert.equal((await readSystem()).memberStorageRoot, base, "save failure preserves the saved base directory");
    await baseField.fill(base);
    await page.getByRole("button", { name: "浏览服务器目录", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "选择服务器目录", exact: true });
    const browsePath = picker.getByRole("textbox", { name: "浏览目录路径", exact: true });
    await picker.waitFor();
    await picker.getByRole("button", { name: "打开目录：folder-000", exact: true }).waitFor();
    await picker.getByRole("button", { name: "加载更多目录", exact: true }).click();
    await picker.getByRole("button", { name: "打开目录：selected", exact: true }).waitFor();
    await picker.screenshot({ path: path.join(output, "system-directory-picker-desktop.png") });
    await picker.getByRole("button", { name: "打开目录：selected", exact: true }).click();
    await page.waitForFunction((value) =>
      document.querySelector('input[aria-label="浏览目录路径"]')?.value === value, selected);
    await picker.getByRole("button", { name: "上一级", exact: true }).click();
    await page.waitForFunction((value) =>
      document.querySelector('input[aria-label="浏览目录路径"]')?.value === value, base);
    await browsePath.fill(path.join(base, "missing"));
    await picker.getByRole("button", { name: "打开目录", exact: true }).click();
    const directoryError = page.locator('.operation-message[data-type="error"]')
      .filter({ hasText: "目录不存在，请输入已有的服务端目录。" });
    await directoryError.waitFor();
    await browsePath.fill(selected);
    await picker.getByRole("button", { name: "打开目录", exact: true }).click();
    await directoryError.getByRole("button", { name: "关闭提示", exact: true }).click();
    await directoryError.waitFor({ state: "hidden" });
    await picker.getByRole("button", { name: "选择此目录", exact: true }).click();
    await picker.waitFor({ state: "hidden" });
    assert.equal(await baseField.inputValue(), selected);
    assert.equal((await readSystem()).memberStorageRoot, base, "directory selection changes only the unsaved draft");
    const selectedSave = page.waitForResponse((entry) => entry.url() === `${origin}/api/system/settings` && entry.request().method() === "POST");
    await saveBase.click();
    assert.equal((await selectedSave).status(), 200);
    await page.screenshot({ path: path.join(output, "system-settings-desktop.png"), fullPage: true });

    await openWorkspace();
    assert.equal(await readonlyRepository.innerText(), repository);
    assert.equal(await page.getByRole("textbox", { name: "工作区 Worktree 目录", exact: true }).count(), 0);
    const expected = path.join(selected, "worktree", "fixture");
    await page.waitForFunction(value => document.querySelector('[aria-label="工作区 Worktree 完整路径"]')?.textContent.trim() === value, expected);
    await page.getByLabel("Worktree 初始化命令", { exact: true }).fill('node -e "process.exit(0)"');
    await saveWorkspace();
    const saved = await readWorkspace();
    assert.equal(saved.worktreeRoot, expected);
    assert.equal(saved.projectName, "fixture");
    assert.equal(saved.memberStorageRoot, selected);
    await page.reload();
    await preview.waitFor();
    assert.equal((await preview.innerText()).trim(), expected);
    const auth = await (await page.request.get(`${origin}/api/auth/session`)).json();
    const rejected = await page.request.post(settingsEndpoint, { headers: { origin, "x-csrf-token": auth.token }, data: { projectName: "../outside" } });
    assert.equal(rejected.status(), 400);
    assert.equal((await readWorkspace()).worktreeRoot, expected, "paths cannot be changed through settings");

    for (const [name, width, height] of [["desktop", 1440, 1100], ["mobile", 390, 844], ["narrow", 320, 844]]) {
      await page.setViewportSize({ width, height });
      await preview.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${name} workspace path preview must not overflow the viewport`);
      assert.ok(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth),
        `${name} workspace settings must not overflow the content column`);
      await page.screenshot({ path: path.join(output, `worktree-settings-${name}.png`), fullPage: true });
      await openSystem();
      await baseField.waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${name} system settings must not overflow the viewport`);
      await page.screenshot({ path: path.join(output, `system-settings-${name}.png`), fullPage: true });
      await page.getByRole("button", { name: "浏览服务器目录", exact: true }).click();
      await picker.waitFor();
      const choose = picker.getByRole("button", { name: "选择此目录", exact: true });
      await choose.scrollIntoViewIfNeeded();
      const bounds = await choose.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height,
        `${name} directory selection remains reachable`);
      assert.ok(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth),
        `${name} directory picker must not overflow`);
      await page.screenshot({ path: path.join(output, `system-directory-picker-${name}.png`) });
      await page.keyboard.press("Escape");
      await picker.waitFor({ state: "hidden" });
      await openWorkspace();
    }
    assert.deepEqual(runPosts, [], "settings and directory browsing never execute requirements");
  } finally {
    await page.close();
  }
}

module.exports = { verifySystemSettings };
