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
    await page.locator(".project-issue-list strong").filter({ hasText: "v0.5.9" }).waitFor();
    await page.getByRole("button", { name: "编辑版本", exact: true }).click();
    await name.fill("v1.0-rc");
    await save.click();
    await page.locator("#release-name-error").waitFor();
    assert.equal(writes.length, 1, "editing uses the same validation as creation");

    const session = await (await page.request.get(`${origin}/api/auth/session`)).json();
    for (const url of [endpoint, `${endpoint}/${release.id}`]) {
      const rejected = await page.request.post(url, { headers: { "x-tapd-token": session.token }, data: { name: "任意名称", ...(url !== endpoint ? { revision: release.revision } : {}) } });
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
    await page.locator(".project-issue-list strong").filter({ hasText: "v1.0" }).waitFor();
  } finally { page.off("request", record); }
}

module.exports = { verifyReleaseNameForm, verifyProjectReleases };
