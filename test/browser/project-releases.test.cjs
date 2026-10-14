/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyReleaseNameForm({ page, output, endpoint }) {
  const name = page.getByLabel("版本名称", { exact: true });
  const save = page.getByRole("button", { name: "保存版本", exact: true });
  const writes = [];
  const record = request => { if (request.url().startsWith(endpoint) && request.method() === "POST") writes.push(request); };
  page.on("request", record);
  try {
    for (const value of ["", "1.0", "V1.0", "v1", "v1.0.0.0", "v01.0", "v1.0-beta", "v1.0 "]) {
      await name.fill(value);
      await save.click();
      await page.locator("#release-name-error").waitFor();
      assert.equal(await name.getAttribute("aria-invalid"), "true");
    }
    assert.equal(writes.length, 0, "invalid form submissions must not send a write request");
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await name.blur();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const hint = await page.locator("#release-name-hint").boundingBox();
      const error = await page.locator("#release-name-error").boundingBox();
      const description = await page.getByLabel("版本说明", { exact: true }).boundingBox();
      assert.ok(error.y >= hint.y + hint.height && description.y >= error.y + error.height, "validation must not overlap the next field");
      await save.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `release-validation-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const value of ["v0.1", "v1.0", "v0.5.9"]) {
      await name.fill(value);
      assert.equal(await name.evaluate(input => input.checkValidity()), true);
      assert.equal(await page.locator("#release-name-error").count(), 0);
    }
  } finally { page.off("request", record); }
}

async function verifyProjectReleases({ page, origin, projectId, output }) {
  const versions = page.getByRole('list', { name: '版本列表', includeHidden: true });
  const version = name => versions.getByRole('article', { name, exact: true, includeHidden: true });
  const back = () => page.getByRole('button', { name: '返回版本', exact: true }).first().click();
  async function openScope(name) {
    if (await page.locator('.release-scope-page').isVisible()) await back();
    await version(name).getByRole('button', { name: '查看范围', exact: true }).click();
    await page.getByRole('region', { name: '版本范围', exact: true }).waitFor();
    assert.equal(await page.locator('.project-tab-bar').count(), 0, 'release scope uses the standalone prototype layout');
    assert.equal(await page.getByRole('button', { name: '保存范围', exact: true }).count(), 0, 'scope editing is outside the confirmed feature range');
  }
  await page.goto(`${origin}/projects/${projectId}?tab=releases`);
  await page.getByRole("button", { name: "新建版本", exact: true }).click();
  const endpoint = `${origin}/api/projects/${projectId}/releases`;
  await verifyReleaseNameForm({ page, output, endpoint });
  const name = page.getByLabel("版本名称", { exact: true });
  const save = page.getByRole("button", { name: "保存版本", exact: true });
  const writes = [];
  const record = request => { if (request.url().startsWith(endpoint) && request.method() === "POST") writes.push(request); };
  page.on("request", record);
  try {
    const createdResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "POST");
    await save.click();
    const created = await createdResponse;
    assert.equal(created.status(), 201);
    const release = await created.json();
    await page.getByRole("heading", { name: "v0.5.9", exact: true }).waitFor();
    await openScope('v0.5.9');
    await page.getByRole("button", { name: "编辑版本", exact: true }).click();
    await name.fill("v1.0-rc");
    await save.click();
    await page.locator("#release-name-error").waitFor();
    assert.equal(writes.length, 1, "editing uses the same validation as creation");

    const session = await (await page.request.get(`${origin}/api/auth/session`)).json();
    for (const url of [endpoint, `${endpoint}/${release.id}`]) {
      const rejected = await page.request.post(url, { headers: { "x-csrf-token": session.token }, data: { name: "任意名称", ...(url !== endpoint ? { revision: release.revision } : {}) } });
      assert.equal(rejected.status(), 400, "direct HTTP writes cannot bypass validation");
      assert.match((await rejected.json()).error, /版本号格式无效/);
    }
    const unchanged = await (await page.request.get(endpoint)).json();
    assert.deepEqual(unchanged.items, [release], "invalid create and edit requests leave the stored release unchanged");
    await name.fill("v1.0");
    const editedResponse = page.waitForResponse(response => response.url() === `${endpoint}/${release.id}` && response.request().method() === "POST");
    await save.click();
    const edited = await editedResponse;
    assert.equal(edited.status(), 200);
    assert.equal((await edited.json()).name, "v1.0");
    await page.getByRole("heading", { name: "v1.0", exact: true }).waitFor();
    await back();
    await page.getByRole("button", { name: "新建版本", exact: true }).click();
    await name.fill("v1.1");
    await page.getByLabel("版本说明", { exact: true }).fill("第二个版本\n保留分行说明。");
    await save.click();
    await page.getByRole("heading", { name: "v1.1", exact: true }).waitFor();
    await version('v1.0').locator('.release-row-description').filter({ hasText: '暂无版本说明' }).waitFor();
    await openScope('v1.0');
    await page.getByRole("heading", { name: "v1.0", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "v1.0", exact: true }).waitFor();
    await page.getByRole("button", { name: "编辑版本", exact: true }).click();
    await name.fill("v1.2");
    assert.equal(await page.getByRole('button', { name: '返回版本', exact: true, includeHidden: true }).first().isDisabled(), true, "version navigation cannot discard an edit draft");
    await name.press("Escape");
    assert.equal(await page.getByRole("button", { name: "编辑版本", exact: true }).evaluate(button => button === document.activeElement), true);
    const beforeConfirmation = writes.length;
    await page.getByRole("button", { name: "归档版本", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "归档版本", exact: true });
    await dialog.waitFor();
    assert.equal(writes.length, beforeConfirmation, "opening confirmation cannot archive a release");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "归档版本", exact: true }).evaluate(button => button === document.activeElement), true);
    await page.getByRole("button", { name: "归档版本", exact: true }).click();
    await dialog.getByRole("button", { name: "确认归档版本", exact: true }).click();
    await version('v1.0').waitFor({ state: "detached" });
    await page.getByRole("heading", { name: "v1.1", exact: true }).waitFor();
    await page.getByLabel("包含已归档版本").check();
    await openScope('v1.0');
    await page.getByText("归档内容只读", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "编辑版本", exact: true }).count(), 0);
    await page.getByRole("button", { name: "恢复版本", exact: true }).click();
    await page.getByRole("button", { name: "编辑版本", exact: true }).waitFor();
    await back();
    await page.getByLabel("包含已归档版本").uncheck();
    await page.getByRole("heading", { name: "v1.0", exact: true }).waitFor();
  } finally { page.off("request", record); }
}

async function verifyReleaseViewStates({ page, origin, projectId, capture }) {
  const url = `${origin}/api/projects/${projectId}/releases?*`;
  let respond, status = 200, response = { items: [] };
  let pending = new Promise(resolve => { respond = resolve; });
  const handler = async route => { await pending; await route.fulfill({ status, json: response }); };
  await page.route(url, handler);
  try {
    await page.goto(`${origin}/projects/${projectId}?tab=releases`);
    await page.getByText('正在读取版本…', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '新建版本', exact: true }).isDisabled(), true);
    await capture('loading');
    respond(); pending = null;
    await page.getByRole('heading', { name: '暂无版本', exact: true }).waitFor();
    await capture('empty');
    status = 500; response = { error: '模拟版本读取失败' };
    await page.reload();
    await page.getByText('版本加载失败，请刷新重试。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '暂无版本', exact: true }).count(), 0, 'a failed load is not an empty release list');
    await capture('error');
    const longName = `v${'1'.repeat(97)}.0`;
    status = 200; response = { items: [{ id: 'long-release', name: longName, revision: 1, status: 'active', updatedAt: null, description: '长文本版本说明，需要在手机和桌面完整阅读。\n'.repeat(14) + '<img src=x onerror=alert(1)>保持纯文本展示' }] };
    await page.getByRole('button', { name: '刷新版本', exact: true }).click();
    await page.getByRole('heading', { name: longName, exact: true }).waitFor();
    assert.equal(await page.locator('.release-row-description img').count(), 0);
    await capture('long-content');
  } finally {
    respond();
    await page.unroute(url, handler);
  }
}

module.exports = { verifyReleaseNameForm, verifyProjectReleases, verifyReleaseViewStates };
