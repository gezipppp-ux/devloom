/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { unzipSync } = require("fflate");

async function verifySkills(browser, origin, output) {
  const context = await browser.newContext({ locale: "zh-CN", javaScriptEnabled: false, acceptDownloads: true });
  try {
    const page = await context.newPage();
    assert.equal((await page.goto(origin + "/skills")).status(), 200);
    await page.getByRole("heading", { name: "需求与 Bug 提报技能", exact: true }).waitFor();
    const prompt = await page.getByLabel("将这段提示词发给 Agent").inputValue();
    assert.ok(prompt.includes(origin + "/skills/web-coding-issue-authoring/manifest.json"));
    assert.ok(prompt.includes("SHA-256"));
    assert.equal(await page.getByRole("link", { name: "English", exact: true }).count(), 0);
    await page.getByRole("heading", { name: "三条必守规则", exact: true }).waitFor();
    await page.getByRole("link", { name: "MCP 发布说明", exact: true }).first().waitFor();
    for (const [width, height] of [[1920, 1080], [2560, 1440], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Skills page must not overflow");
      await page.screenshot({ path: path.join(output, "skills-" + width + ".png"), fullPage: true });
      await page.getByRole("heading", { name: "4. 执行发布门禁", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, "skills-gates-" + width + ".png") });
      if (width < 768) assert.ok(await page.locator(".table-scroll").first().evaluate(element => element.scrollWidth <= element.clientWidth));
    }
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "下载完整技能包", exact: true }).click();
    const downloaded = await download;
    assert.equal(downloaded.suggestedFilename(), "web-coding-issue-authoring.zip");
    const filename = path.join(output, downloaded.suggestedFilename());
    await downloaded.saveAs(filename);
    const files = unzipSync(await fs.readFile(filename));
    assert.ok(files["web-coding-issue-authoring/references/prototypes.md"]);
    assert.ok(files["web-coding-issue-authoring/scripts/update-skill.cjs"]);
    await page.getByRole("link", { name: "MCP 接入设置", exact: true }).waitFor();
  } finally { await context.close(); }
}

module.exports = { verifySkills };
