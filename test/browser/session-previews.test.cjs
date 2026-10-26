/* global document, window, Event, localStorage */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { previewHtml } = require("../fixtures/session-preview.cjs");
const { normalizeItem } = require("../../src/codex/session-item.cjs");
const { temporary } = require("../support/helpers.cjs");
const { selectOption } = require("../support/select.cjs");
const { verifySessionPreviewLayout } = require("./session-preview-layout.test.cjs");

async function verifySessionPreviews(browser, origin, manager, key, output) {
  const directory = (await manager.store.read(key)).worktree.path;
  const file = path.join(directory, "preview-browser-fixture.html");
  fs.writeFileSync(file, previewHtml);
  const item = id => normalizeItem({ id, type: "agentMessage", status: "completed",
    text: `这里是可调整的客户搜索方案。\n\nvisualize${JSON.stringify({ path: file, title: "客户搜索 · 随聊调整" })}\n\n选择后可引用当前版本继续讨论。` }, "preview-fixture");
  const first = await manager.views.presenter.item(key, item("preview-first"));
  const second = await manager.views.presenter.item(key, item("preview-second"));
  const firstId = first.contentParts.find(part => part.type === "preview").id;
  const secondId = second.contentParts.find(part => part.type === "preview").id;
  let displayedItems = [second];
  fs.unlinkSync(file);
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  const errors = [], writes = [];
  const consoleErrors = [];
  page.on("response", response => { if (response.status() >= 400) consoleErrors.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", request => consoleErrors.push(`${request.url()} ${request.failure()?.errorText}`));
  page.on("request", request => { if (request.url().includes("preview-runtime")) consoleErrors.push(`REQUEST ${request.url()}`); });
  page.on("console", entry => { if (entry.type() === "error") consoleErrors.push(entry.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/workbench/attention*", route => route.fulfill({ json: { items: [], total: 0, nextCursor: null } }));
  await page.route(`**/api/runs/${key}`, async route => {
    const response = await route.fetch(), detail = await response.json();
    await route.fulfill({ json: { ...detail, status: "completed", turnId: null, readOnlyReason: null, requests: [], items: displayedItems, nextCursor: null } });
  });
  await page.route(`**/api/runs/${key}/messages`, async route => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({ json: { accepted: true } });
  });
  const preview = page.locator(".session-preview");
  const frame = page.frameLocator(".session-preview iframe");
  const saved = async () => { await preview.getByText("交互状态已保存", { exact: true }).waitFor(); };
  const radius = () => preview.getByRole("slider");
  const setRadius = async value => {
    await radius().evaluate((element, next) => { element.value = String(next); element.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    await page.waitForFunction(next => document.querySelector('.preview-control input[type="range"]')?.value === String(next), value);
  };
  try {
    await page.goto(`${origin}/?task=${key}`);
    await frame.locator("#preview-demo").waitFor();
    await preview.getByText("可交互预览", { exact: true }).waitFor();
    assert.equal(await preview.locator(".preview-adjustments").count(), 0);
    const isolation = await frame.locator("body").evaluate(() => {
      let parentBlocked = false, cookieBlocked = false;
      try { void window.parent.document.body; } catch { parentBlocked = true; }
      try { void document.cookie; } catch { cookieBlocked = true; }
      return { parentBlocked, cookieBlocked };
    });
    assert.deepEqual(isolation, { parentBlocked: true, cookieBlocked: true });
    await preview.getByRole("button", { name: "调整预览", exact: true }).click();
    await setRadius(24); await saved();
    assert.equal(await frame.locator("#preview-demo").evaluate(element => element.style.borderRadius), "24px");
    await frame.locator("#increment").click();
    await frame.locator("#counter").filter({ hasText: "1 次" }).waitFor();
    await page.waitForResponse(response => response.url().endsWith(`/previews/${secondId}/state`) && response.status() === 200);
    await saved();
    await page.reload();
    await frame.locator("#counter").filter({ hasText: "1 次" }).waitFor();
    await preview.getByRole("button", { name: "调整预览", exact: true }).click();
    assert.equal(await radius().inputValue(), "24");
    await preview.getByRole("button", { name: "查看原始效果", exact: true }).click();
    assert.equal(await frame.locator("#preview-demo").evaluate(element => element.style.borderRadius), "12px");
    await preview.getByRole("button", { name: "返回调整结果", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.preview-control input[type="range"]')?.value === "24");

    // A delayed save response must never restore an older control value.
    let release, captured;
    const intercepted = new Promise(resolve => { captured = resolve; });
    await page.route(`**/api/runs/${key}/previews/${secondId}/state`, async route => {
      const response = await route.fetch();
      const wait = new Promise(resolve => { release = resolve; });
      captured(); await wait; await route.fulfill({ response });
    }, { times: 1 });
    await setRadius(20); await intercepted;
    await setRadius(28); release(); await saved();
    assert.equal(await radius().inputValue(), "28");
    assert.equal(Object.values((await manager.store.previews(key).read(secondId)).state.controls)[0], 28);

    // A second tab's update raises a conflict and retains this tab's draft.
    const peer = await manager.store.previews(key).read(secondId);
    await manager.store.previews(key).save(secondId, peer.revision, peer.state);
    await setRadius(30);
    await preview.getByText("预览状态已更新，请重新载入后再调整。", { exact: true }).waitFor();
    assert.equal(await radius().inputValue(), "30");
    await preview.locator(".preview-error").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "session-preview-conflict.png"), fullPage: true });
    await preview.getByRole("button", { name: "放弃调整并重新载入", exact: true }).click();
    await frame.locator("#counter").filter({ hasText: "1 次" }).waitFor();
    await preview.getByText("交互状态已保存", { exact: true }).waitFor();

    assert.equal(writes.length, 0);
    await frame.locator("#follow-up").click();
    await page.locator(".composer-preview-reference").waitFor();
    assert.equal(await page.locator(".session-composer textarea").inputValue(), "采用当前预览的布局继续实现。");
    assert.equal(writes.length, 0, "bridge feedback stages a draft only");
    assert.doesNotMatch(await page.locator(".composer-preview-reference").textContent(), /PRIVATE_ONLY|privateContent/);
    await page.locator(".composer-send").click();
    await page.locator(".composer-preview-reference").waitFor({ state: "detached" });
    assert.equal(writes[0].preview.id, secondId);
    assert.equal(writes[0].preview.state.widget.modelContent.count, 1);
    assert.doesNotMatch(JSON.stringify(writes), /PRIVATE_ONLY|privateContent/);

    await selectOption(preview.getByRole("combobox", { name: "预览版本", exact: true }), firstId);
    await preview.getByText("历史版本或只读会话：可以查看和引用，调整不会保存。", { exact: true }).waitFor();
    await frame.locator("#counter").filter({ hasText: "0 次" }).waitFor();
    if (!await preview.locator(".preview-adjustments").count()) await preview.getByRole("button", { name: "调整预览", exact: true }).click();
    assert.equal(await radius().isDisabled(), true);
    await preview.locator(".preview-adjustments").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "session-preview-history.png"), fullPage: true });
    await selectOption(preview.getByRole("combobox", { name: "预览版本", exact: true }), secondId);
    await frame.locator("#counter").filter({ hasText: "1 次" }).waitFor();

    for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
      await page.setViewportSize({ width, height });
      await preview.scrollIntoViewIfNeeded();
      const bounds = await preview.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `overflow at ${width}`);
      await page.screenshot({ path: path.join(output, `session-preview-${width}.png`), fullPage: true });
      await preview.locator(".preview-reset").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `session-preview-adjustments-${width}.png`), fullPage: true });
      if (width < 768) {
        await page.locator(".composer-send").scrollIntoViewIfNeeded();
        assert.equal(await page.locator(".composer-send").evaluate(element => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }), true, `composer reachable at ${width}`);
        await page.screenshot({ path: path.join(output, `session-preview-composer-${width}.png`), fullPage: true });
      }
    }
    await page.evaluate(() => localStorage.setItem("web-coding.locale", "en"));
    await page.reload();
    await preview.getByRole("button", { name: "Adjust preview", exact: true }).click();
    await page.screenshot({ path: path.join(output, "session-preview-en-320.png"), fullPage: true });
    // Variant navigation filters control groups and preserves each binding.
    fs.writeFileSync(file, `<div class="viz-carousel" aria-label="Designs"><section data-variant="Simple" id="simple" aria-label="Simple"><h2>Simple</h2></section><section data-variant="Detailed" id="detailed" aria-label="Detailed" hidden><h2>Detailed</h2></section></div><script>const simple={size:10},detailed={size:20};new Tweak({container:document.getElementById('simple')}).addSlider(simple,'size',{label:'Simple size',min:0,max:40});new Tweak({container:document.getElementById('detailed')}).addSlider(detailed,'size',{label:'Detailed size',min:0,max:40});</script>`);
    displayedItems = [await manager.views.presenter.item(key, item("preview-carousel"))];
    fs.unlinkSync(file);
    await page.reload();
    await preview.getByRole("button", { name: "Adjust preview", exact: true }).click();
    await preview.getByRole("slider", { name: /Simple size/ }).waitFor();
    assert.equal(await preview.getByRole("slider").count(), 1);
    // Capture the painted sandbox after scrolling it into the short mobile
    // timeline, before exercising its own carousel controls.
    await frame.getByRole("button", { name: "Next", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "session-preview-carousel-320.png"), fullPage: true });
    await frame.getByRole("button", { name: "Next", exact: true }).click();
    await preview.getByRole("slider", { name: /Detailed size/ }).waitFor();
    assert.equal(await preview.getByRole("slider").count(), 1);
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "session-preview-failure.png"), fullPage: true });
    console.error({ errors, consoleErrors, preview: await preview.textContent().catch(() => "missing"),
      sandbox: await frame.locator("body").evaluate(() => ({ head: document.head.innerHTML, tweak: typeof window.Tweak,
        scripts: [...document.scripts].map(script => ({ src: script.src, text: script.textContent.slice(0, 80) })) })).catch(() => null) });
    throw error;
  } finally { await page.close(); }
  await verifySessionPreviewLayout(browser, origin, manager, key, output);
}

async function main() {
  const cleanup = [], directory = temporary({ after: callback => cleanup.push(callback) });
  const store = new RunStore(directory), key = "1-2", client = new FakeClient();
  fs.mkdirSync(store.dir(key));
  fs.writeFileSync(path.join(store.dir(key), "run.json"), JSON.stringify({
    workitem: { title: "会话交互预览", id: "2", workspace_id: "1" }, source: { channel: "manual", scope: "1", id: "2" },
    agent: { provider: "codex" }, session_id: "original", worktree: { path: directory, branch: "codex/fixture" }, execution: { status: "completed" },
  }));
  const manager = new SessionManager({ store, client, worktreeReason: () => null });
  const application = createWebServer({ manager, testIdentity: true });
  const origin = await application.listen(0), output = path.resolve("state/browser/previews");
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : "chromium"), headless: true });
    await verifySessionPreviews(browser, origin, manager, key, output);
    process.stdout.write("Session previews passed: sandbox, dynamic controls, revisions, reload, history, feedback and seven viewports.\n");
  } finally { await browser?.close(); await application.close(); for (const callback of cleanup.reverse()) await callback(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verifySessionPreviews };
