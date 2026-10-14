/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifySessionFiles(browser, origin, key, errors, output) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  const before = "const value = 1;\n", current = "const value = 2;\nexport { value };\n";
  const files = [{ path: "src/seed.ts", status: "M" }, { path: "migration.sql", status: "A" }, { path: "removed.ts", status: "D" }];
  const pending = [];
  let delay = false, fail = false;
  await page.route(`**/api/runs/${key}`, async route => {
    const response = await route.fetch();
    const detail = await response.json();
    await route.fulfill({ json: { ...detail, items: [{ id: "file-links", type: "agentMessage", text: '[seed.ts](src/seed.ts:2) 与 `migration.sql`。\n\n[同名文件](duplicate.ts) · [已删除](removed.ts) · [无法定位](missing.ts)\n\n[`带代码标签`](src/seed.ts)\n\n[unsafe](javascript:alert(1)) <button data-file-path="outside.ts">伪造文件</button>\n\n```html\n<script>window.fileXss=1</script>\n```' }], nextCursor: null } });
  });
  await page.route(`**/api/runs/${key}/files?*`, route => route.fulfill({ json: { files } }));
  await page.route(`**/api/runs/${key}/file?*`, async route => {
    const url = new URL(route.request().url());
    const file = url.searchParams.get("path"), scope = url.searchParams.get("scope");
    if (delay) { await new Promise(resolve => pending.push(resolve)); }
    if (fail || file === "missing.ts") { await route.fulfill({ status: 400, json: { error: "未找到此文件" } }); return; }
    if (file === "duplicate.ts") { await route.fulfill({ json: { candidates: ["one/duplicate.ts", "two/duplicate.ts"] } }); return; }
    const old = scope === "head" ? current : before;
    await route.fulfill({ json: {
      path: file, previousPath: file, scope, base: "a".repeat(40), head: "b".repeat(40), status: file === "removed.ts" ? "D" : "M",
      before: { text: old, exists: true, reason: null },
      current: { text: file === "removed.ts" ? "" : current, exists: file !== "removed.ts", reason: null },
      hunks: scope === "head" ? [] : [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ["-const value = 1;", "+const value = 2;", "+export { value };"] }],
      comparisonReason: null, readAt: "2026-10-09T06:30:00Z",
    } });
  });
  try {
    await page.goto(origin);
    const link = page.getByRole("button", { name: "seed.ts", exact: true });
    await link.waitFor();
    const draft = page.getByRole("textbox", { name: "发送给 Codex 的指令" });
    await draft.fill("预览过程中保留草稿");
    await link.click();
    const panel = page.getByRole("complementary", { name: "文件预览与对比" });
    await panel.locator('[data-line="2"]').waitFor();
    assert.match(await panel.locator('[data-line="2"]').getAttribute("class"), /file-target-line/);
    assert.equal(await draft.inputValue(), "预览过程中保留草稿");
    await panel.getByRole("button", { name: "变更对比", exact: true }).click();
    await panel.locator(".file-diff-line.removed").waitFor();
    await panel.getByLabel("差异显示方式").selectOption("split");
    await panel.locator(".file-split").waitFor({ state: "visible" });
    await panel.getByLabel("文件比较范围").selectOption("head");
    await panel.getByText("此范围内没有内容差异。", { exact: true }).waitFor();
    await panel.getByLabel("文件比较范围").selectOption("task");
    await panel.locator(".file-split").waitFor();
    await page.screenshot({ path: path.join(output, "file-panel-desktop.png"), fullPage: true });
    await page.keyboard.press("Escape");
    assert.equal(await panel.count(), 0);
    assert.equal(await link.evaluate(el => el === document.activeElement), true);
    await page.getByRole("button", { name: "同名文件", exact: true }).click();
    await panel.getByRole("button", { name: "two/duplicate.ts", exact: true }).click();
    await panel.locator(".file-panel-heading small").filter({ hasText: "two/duplicate.ts" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "已删除", exact: true }).click();
    await panel.getByRole("button", { name: "源码", exact: true }).click();
    await panel.getByText(/当前文件已删除/).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "无法定位", exact: true }).click();
    await page.locator('.operation-message[data-type="error"]').filter({ hasText: "未找到此文件" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('.message-markdown button[data-file-path="outside.ts"]').count(), 0);
    assert.equal(await page.locator('.message-markdown button button').count(), 0);
    assert.equal(await page.evaluate(() => window.fileXss), undefined);

    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await link.click();
      await panel.locator('[data-line="2"]').waitFor();
      await panel.getByRole("button", { name: "变更对比", exact: true }).click();
      await panel.locator(".file-diff-line.removed").waitFor();
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      const overflow = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 12).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })) }));
      assert.ok(overflow.scroll <= width, JSON.stringify(overflow));
      await page.screenshot({ path: path.join(output, `file-panel-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    delay = true;
    const request = page.waitForRequest(r => r.url().includes(`/runs/${key}/file?`));
    await link.click(); await request;
    await panel.getByText("正在读取文件…").waitFor();
    await page.keyboard.press("Escape");
    delay = false;
    pending.splice(0).forEach(resolve => resolve());
    await page.getByRole("button", { name: "migration.sql", exact: true }).click();
    await panel.locator(".file-panel-heading small").filter({ hasText: "migration.sql" }).waitFor();
    await panel.locator(".file-diff-line.removed").waitFor();
    assert.equal(await panel.locator(".file-panel-heading small").innerText(), "migration.sql");
    fail = true;
    await panel.getByRole("button", { name: "刷新文件与差异" }).click();
    await page.locator('.operation-message[data-type="error"]').filter({ hasText: "未找到此文件" }).waitFor();
    fail = false;
    await panel.getByRole("button", { name: "重试", exact: true }).click();
    await panel.locator(".file-diff-line.removed").waitFor();
    assert.equal(await draft.inputValue(), "预览过程中保留草稿");
    await page.keyboard.press("Escape");
    const gitButton = page.getByRole("button", { name: "Worktree Git", exact: true });
    await gitButton.click();
    await page.getByRole("button", { name: "修改 src/seed.ts", exact: true }).click();
    await panel.locator(".file-diff-line.removed").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await gitButton.evaluate(el => el === document.activeElement), true);
  } finally {
    pending.splice(0).forEach(resolve => resolve());
    await page.close();
  }
}
module.exports = { verifySessionFiles };
