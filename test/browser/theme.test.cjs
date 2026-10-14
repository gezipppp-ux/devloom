const { selectOption, selectValue } = require("../support/select.cjs");
/* global document, window, Storage */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyTheme(page, origin, output) {
  const selector = page.getByRole("combobox", { name: "外观主题", exact: true });
  const expectTheme = async (target, theme) => {
    await target.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    assert.equal(await target.evaluate(() => window.getComputedStyle(document.documentElement).colorScheme), theme);
  };
  await page.emulateMedia({ colorScheme: "light" });
  assert.equal(await selectValue(selector), "system");
  await expectTheme(page, "light");
  assert.equal(await page.locator(".ui-avatar").evaluate(el => el.previousElementSibling.classList.contains("ui-theme-select")), true);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  await selectOption(selector, "light");
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "light");
  await selectOption(selector, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "dark");
  await page.reload();
  await selector.waitFor();
  assert.equal(await selectValue(selector), "dark");
  await expectTheme(page, "dark");

  const sibling = await page.context().newPage();
  try {
    await sibling.goto(origin);
    await expectTheme(sibling, "dark");
    await selectOption(selector, "light");
    await expectTheme(sibling, "light");
    await sibling.evaluate(() => window.localStorage.removeItem("web-coding.theme"));
    await expectTheme(page, "light");
    await page.waitForFunction(() => JSON.parse(document.querySelector(".ui-theme-select").dataset.value) === "system");
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(page, "dark");
  } finally { await sibling.close(); }

  // Switching appearance must keep the mounted form and its unsaved draft.
  await page.goto(origin + "/personal");
  const draft = page.getByLabel("显示名称", { exact: true });
  await draft.fill("未保存的外观测试草稿");
  const formNode = await draft.elementHandle();
  await selectOption(selector, "light");
  await selectOption(selector, "dark");
  assert.equal(await draft.inputValue(), "未保存的外观测试草稿");
  assert.equal(await formNode.evaluate(el => el.isConnected), true);
  await formNode.dispose();

  for (const locale of ["zh-CN", "en"]) {
    await selectOption(page.locator(".ui-locale"), locale);
    for (const [width, height] of [[2560, 1440], [1920, 1080], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      const control = page.locator('.ui-theme-select [role="combobox"]');
      await page.locator(".ui-theme-select").scrollIntoViewIfNeeded();
      await control.focus();
      assert.equal(await control.evaluate(el => el === document.activeElement), true);
      const bounds = await page.locator(".ui-theme-select").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height, `theme control is reachable at ${locale} ${width}: ${JSON.stringify(bounds)}`);
      if (width < 768) assert.ok(bounds.width >= 44 && bounds.height >= 44, "mobile appearance control has a 44px touch target");
      const projectBounds = await page.locator(".ui-project-select").boundingBox();
      if (width <= 600) assert.ok(projectBounds.width >= 100, `project context remains readable alongside the theme control at ${locale} ${width}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `theme header does not overflow at ${locale} ${width}`);
      await page.screenshot({ path: path.join(output, `theme-dark-${locale}-${width}.png`), fullPage: true });
      for (const appearance of ["light", "dark"]) {
        await selectOption(control, appearance);
        for (const name of ["project", "locale", "theme"]) {
          const root = page.locator(name === "locale" ? ".ui-locale" : `.ui-${name}-select`);
          const input = root.getByRole("combobox");
          const before = await selectValue(root);
          await input.focus();
          await input.press("ArrowDown");
          const popup = page.locator(".app-select-popup:visible");
          await popup.waitFor();
          await page.waitForFunction(() => [...document.querySelectorAll(".app-select-popup")].some(el => {
            const style = window.getComputedStyle(el);
            return style.display !== "none" && style.visibility === "visible" && style.opacity === "1";
          }));
          // Wait for placement and opening animation to finish before measuring.
          await popup.getByRole("option").first().waitFor();
          await page.screenshot({ path: path.join(output, `dropdown-${name}-${appearance}-${locale}-${width}.png`), animations: "disabled" });
          const box = await popup.boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= height + 1, `${name} popup fits ${appearance} ${locale} ${width}`);
          assert.equal(await popup.evaluate(el => window.getComputedStyle(el).backgroundColor), await page.evaluate(() => {
            const probe = document.createElement("span");
            probe.style.backgroundColor = "var(--surface)";
            document.body.append(probe);
            const color = window.getComputedStyle(probe).backgroundColor;
            probe.remove();
            return color;
          }), "popup uses the current theme surface");
          await input.press("Escape");
          await popup.waitFor({ state: "hidden" });
          assert.equal(await selectValue(root), before, "Escape keeps the selection");
          assert.equal(await input.evaluate(el => el === document.activeElement), true, "Escape keeps keyboard focus on the control");
        }
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectOption(page.locator(".ui-locale"), "zh-CN");
  await selector.focus();
  await selector.press("ArrowDown");
  await selector.press("ArrowDown");
  await selector.press("Enter");
  await page.locator(".app-select-popup:visible").waitFor({ state: "hidden" });
  assert.equal(await selectValue(selector), "system", "keyboard selection updates the preference");

  await page.evaluate(() => window.localStorage.setItem("web-coding.theme", "invalid"));
  await page.reload();
  await selector.waitFor();
  assert.equal(await selectValue(selector), "system");
  await expectTheme(page, "dark");

  const restricted = await page.context().newPage();
  try {
    await restricted.emulateMedia({ colorScheme: "dark" });
    await restricted.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error("storage unavailable"); };
      Storage.prototype.setItem = () => { throw new Error("storage unavailable"); };
    });
    await restricted.goto(origin);
    await expectTheme(restricted, "dark");
    await selectOption(restricted.getByRole("combobox", { name: "外观主题", exact: true }), "light");
    await expectTheme(restricted, "light");
  } finally { await restricted.close(); }

  // Storage can also become unavailable after the page has mounted.
  await page.evaluate(() => {
    Storage.prototype.getItem = () => { throw new Error("storage unavailable"); };
    Storage.prototype.setItem = () => { throw new Error("storage unavailable"); };
  });
  await selectOption(selector, "light");
  await expectTheme(page, "light");
  await page.reload();
  await selector.waitFor();
  await selectOption(selector, "system");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
  await page.goto(origin);
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
}

module.exports = { verifyTheme };
