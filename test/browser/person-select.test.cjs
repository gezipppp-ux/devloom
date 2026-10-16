/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { selectOption, selectValue } = require("../support/select.cjs");
const { source, people, members, issue, task, permissions } = require("../fixtures/person-select.cjs");

async function personSelectChecks() {
  const { createServer } = await import("vite"), { default: vue } = await import("@vitejs/plugin-vue");
  const server = await createServer({ configFile: false, root: path.resolve("web"), logLevel: "error", plugins: [vue(), {
    name: "person-select-fixture",
    resolveId(id) { if (id === "virtual:people") return "\0people"; },
    load(id) { if (id === "\0people") return source; },
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith("/people")) return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/@id/virtual:people"></script></body></html>'));
    }); },
  }], server: { host: "127.0.0.1", port: 0 } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}) });
    const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 900 } }), errors = [], writes = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    await page.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith("/api/")) return route.fallback();
      if (route.request().method() !== "GET") writes.push(route.request().postDataJSON());
      let result = { items: [], nextOffset: null, people: [] };
      if (pathname.endsWith("/members")) result = { members: new URL(page.url()).searchParams.get("kind") === "members" ? [] : members, candidates: people.map(person => ({ ...person, grantablePermissions: permissions })) };
      else if (pathname.endsWith("/reviewers")) result = { items: people };
      else if (pathname.endsWith("/issues/i")) result = issue;
      else if (pathname.endsWith("/tasks/t")) result = { task };
      else if (pathname.endsWith("/deliveries/d")) result = { delivery: { id: "d", title: "测试交付", status: "pending", checklist: [], checkedItems: [], reviewerId: "li", authorId: "li", revision: 1 }, permissions, people };
      await route.fulfill({ json: result });
    });
    const open = kind => page.goto(`http://127.0.0.1:${server.httpServer.address().port}/people?kind=${kind}`);
    const popup = page.locator(".app-select-popup:visible");
    async function search(control, query, expected) {
      if (await control.getAttribute("aria-expanded") !== "true") await control.click();
      await control.fill(query);
      await popup.waitFor();
      await page.waitForFunction(expected => {
        const nodes = [...document.querySelectorAll('.app-select-popup .app-select-option')].filter(node => node.getClientRects().length);
        return JSON.stringify(nodes.map(node => node.dataset.value)) === JSON.stringify(expected);
      }, expected);
    }
    async function check(label) {
      const control = page.getByRole("combobox", { name: label, exact: true });
      for (const query of ["张三", "zhangsan", "ZS", "dev-01"]) await search(control, query, ["zhang"]);
      await control.press("Escape");
      await popup.waitFor({ state: "hidden" });
      return control;
    }
    await open("fields");
    for (const label of ["提报人", "业务负责人", "测试负责人", "业务验收人", "关注人"]) await check(label);
    const qa = page.getByRole("combobox", { name: "测试负责人", exact: true });
    await search(qa, "not-a-person", []);
    await popup.getByText("没有匹配选项", { exact: true }).waitFor();
    await qa.fill("");
    await popup.locator('[data-value="li"]').waitFor();
    await search(qa, "sm", ["shan"]);
    await qa.press("ArrowDown"); await qa.press("Enter");
    await popup.waitFor({ state: "hidden" });
    assert.equal(await selectValue(qa), "shan");
    const watchers = page.getByRole("combobox", { name: "关注人", exact: true });
    await search(watchers, "zs", ["zhang"]);
    await popup.locator('[data-value="zhang"]').click();
    assert.deepEqual(new Set(await selectValue(watchers)), new Set(["li", "zhang"]), "searching does not remove an existing selected person");
    await watchers.press("Escape");
    await popup.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "切换禁用" }).click();
    assert.equal(await qa.isDisabled(), true);
    await page.getByRole("button", { name: "切换禁用" }).click();
    const output = path.resolve("state/browser/person-select"); fs.mkdirSync(output, { recursive: true });
    for (const [width, height] of [[1920,1080], [2560,1440], [1440,900], [1280,720], [768,1024], [390,844], [320,740]]) {
      await page.setViewportSize({ width, height });
      await qa.evaluate(node => node.scrollIntoView({ block: "center" }));
      await search(qa, "zs", ["zhang"]);
      await popup.evaluate(node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
      assert.ok(await popup.evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= window.innerWidth; }));
      await page.screenshot({ path: path.join(output, `people-${width}.png`) });
      await qa.press("Escape");
      await popup.waitFor({ state: "hidden" });
    }
    await page.getByRole("button", { name: "English" }).click();
    await search(page.getByRole("combobox", { name: "QA owner", exact: true }), "no-match", []);
    await popup.getByText("No matching options", { exact: true }).waitFor();
    await page.evaluate(() => window.localStorage.removeItem("web-coding.locale"));
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [kind, label, button] of [["plan", "开发负责人"], ["settings", "负责人"], ["members", "用户", "添加成员"], ["publish", "交付验证人"], ["delivery", "重新指定验证人"], ["assets", "负责人", "新建资产"], ["task", "开发负责人", "编辑任务信息"]]) {
      await open(kind);
      if (button) await page.getByRole("button", { name: button, exact: true }).click();
      const control = await check(label);
      await search(control, "zs", ["zhang"]);
      await popup.locator('[data-value="zhang"]').click();
      await popup.waitFor({ state: "hidden" });
      assert.equal(await selectValue(control), "zhang", `${kind} preserves the user ID`);
      if (kind === "plan") {
        assert.equal(await page.locator("dialog[open]").count(), 1, "Escape only closes the dropdown");
        await page.getByRole("button", { name: "确认指派", exact: true }).click();
        await page.locator("dialog[open]").waitFor({ state: "hidden" });
        assert.equal(writes.at(-1).executorId, "zhang");
      }
      if (kind === "members") {
        assert.equal(await page.locator("dialog[open]").count(), 1, "opening and selecting a person never dismisses the member dialog");
        await page.mouse.click(10, 10);
        await page.locator("dialog[open]").waitFor({ state: "hidden" });
      }
    }
    await open("detail");
    await page.getByRole("button", { name: "重新分派处理人", exact: true }).click();
    await check("重新分派处理人");
    await selectOption(page.getByRole("combobox", { name: "目标状态", exact: true }), "handoff");
    await check("下一处理人");
    assert.deepEqual(errors, []);
    console.log("Person dropdowns: all 14 fields support name, username, full pinyin and initials; multiselect, keyboard, modal, locale and responsive checks passed.");
  } finally { await browser?.close(); await server.close(); }
}

module.exports = { personSelectChecks };
