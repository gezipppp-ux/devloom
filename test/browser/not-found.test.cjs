/* global document, window, PopStateEvent */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { createWebServer } = require("../../src/http/server.cjs");
const { selectPreference } = require("../support/select.cjs");

async function verifyNotFound(browser) {
  const application = createWebServer({ testIdentity: true, workspaces: { close: async () => {} } });
  const origin = await application.listen(0);
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [], apiRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/api/**", route => {
    apiRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { user: null, token: "not-found-fixture" } });
  });
  const output = path.resolve("state/browser/not-found");
  fs.mkdirSync(output, { recursive: true });
  const missing = `${origin}/projects/unknown/details?draft=private-query-marker`;
  try {
    assert.equal((await page.goto(missing)).status(), 404);
    const title = page.getByRole("heading", { name: "这个页面走丢了", exact: true });
    await title.waitFor();
    assert.equal(page.url(), missing);
    assert.equal(await page.locator(".not-found-address code").textContent(), "/projects/unknown/details");
    assert.equal((await page.locator("body").innerText()).includes("private-query-marker"), false);
    assert.deepEqual(apiRequests, [], "a public 404 needs no account or business API");
    assert.equal((await page.reload()).status(), 404);
    await title.waitFor();

    for (const locale of ["zh-CN", "en"]) {
      await selectPreference(page, "locale", locale);
      await page.getByRole("heading", { name: locale === "en" ? "This page took a wrong turn" : "这个页面走丢了", exact: true }).waitFor();
      assert.equal(page.url(), missing, "language switching preserves the missing address");
      for (const [width, height] of [[2560, 1440], [1920, 1080], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${locale} overflow at ${width}`);
        for (const button of await page.locator(".not-found-actions > *").all()) {
          const box = await button.boundingBox();
          assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width, "actions remain reachable");
        }
        await page.screenshot({ path: path.join(output, `${locale}-${width}.png`), fullPage: true });
      }
    }
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await page.screenshot({ path: path.join(output, "en-dark-320.png"), fullPage: true });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: path.join(output, "en-dark-1920.png"), fullPage: true });
    await page.getByRole("link", { name: "Back to workbench", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Sign in to your workbench", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/login", "home keeps the normal authentication guard");

    // The same popstate event as browser navigation exercises the Vue catch-all
    // without another document request, with a real previous application page.
    await page.evaluate(() => {
      const previous = window.location.pathname;
      window.history.pushState({ ...window.history.state, back: previous }, "", "/missing-client-route");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    });
    await page.getByRole("heading", { name: "This page took a wrong turn", exact: true }).waitFor();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in to your workbench", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/login");

    assert.equal((await page.goto(`${origin}/404`)).status(), 404);
    await page.getByRole("heading", { name: "This page took a wrong turn", exact: true }).waitFor();
    assert.equal(await page.locator(".not-found-address").count(), 0);
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in to your workbench", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    process.stdout.write("404 browser checks passed: direct links, reload, client navigation, safe back/home actions, public access, languages, themes and seven responsive sizes.\n");
  } finally {
    await context.close();
    await application.close();
  }
}

async function main() {
  const browser = await chromium.launch({ ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  try { await verifyNotFound(browser); } finally { await browser.close(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
module.exports = { verifyNotFound };
