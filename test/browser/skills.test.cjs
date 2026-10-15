/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifySkills(browser, origin, output) {
  const context = await browser.newContext({ javaScriptEnabled: false, acceptDownloads: true });
  try {
    const page = await context.newPage();
    const response = await page.goto(origin + "/skills");
    assert.equal(response.status(), 200);
    await page.getByRole("heading", { name: "Agent Skills 指南", exact: true }).waitFor();
    const prompt = await page.getByLabel("将这段提示词发给 Agent").inputValue();
    assert.ok(prompt.includes(origin + "/skills/SKILL.md"));
    assert.ok((await page.locator("article").innerText()).includes('"projectId": "<PROJECT_ID>"'));
    await page.getByRole("heading", { name: "get_issue_workflow", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Bug 示例", exact: true }).waitFor();
    assert.equal(await page.locator("article ol > li").count(), 8);
    assert.ok((await page.getByRole("region", { name: "事项字段", exact: true }).innerText()).includes("dueDate"));
    for (const [width, height] of [[1920, 1080], [2560, 1440], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Skills page must not overflow");
      await page.screenshot({ path: path.join(output, "skills-" + width + ".png"), fullPage: true });
      await page.getByRole("heading", { name: "3. 需求与 Bug 字段", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, "skills-fields-" + width + ".png") });
      if (width < 768) assert.ok(await page.locator(".table-scroll").evaluate(element => element.scrollWidth <= element.clientWidth), "mobile field entries must be readable without horizontal scrolling");
    }
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "下载 SKILL.md" }).click();
    const downloaded = await download;
    assert.equal(downloaded.suggestedFilename(), "SKILL.md");
    await downloaded.saveAs(path.join(output, "SKILL.md"));
    await page.getByRole("link", { name: "English", exact: true }).click();
    await page.getByRole("heading", { name: "Agent Skills guide", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Bug example", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, "skills-en-320.png"), fullPage: true });
    await page.getByRole("link", { name: "MCP settings", exact: true }).waitFor();
  } finally { await context.close(); }
}

module.exports = { verifySkills };
