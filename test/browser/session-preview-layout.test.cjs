/* global window, document, history, PopStateEvent, localStorage */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeItem } = require("../../src/codex/session-item.cjs");

function tallPreview(title) {
  return `<style>#layout-demo{width:960px;height:920px;padding:48px;display:flex;flex-direction:column;justify-content:space-between;background:#f6f4ec;color:#263f39;font:16px/1.6 system-ui}#layout-demo h2{font-size:58px;font-weight:500;margin:0}#layout-demo button{padding:14px 24px;font-size:18px;background:#263f39;color:#fff;border:0;border-radius:8px}#layout-demo output{font-size:64px}</style><section id="layout-demo"><div>VISUALIZE / LAB<hr><h2>${title}</h2></div><output id="layout-count">0</output><div><p>完整内容底部 · Preview bottom</p><button id="layout-increment">增加计数</button><button id="layout-feedback">引用当前方案</button></div></section><script>window.previewInstance=Math.random();let count=window.openai.widgetState?.modelContent?.count||0;const output=document.getElementById('layout-count');output.textContent=count;document.getElementById('layout-increment').onclick=()=>{output.textContent=++count;window.openai.setWidgetState({modelContent:{count}});};document.getElementById('layout-feedback').onclick=()=>window.openai.sendFollowUpMessage({prompt:'继续当前方案'});</script>`;
}

async function verifySessionPreviewLayout(browser, origin, manager, key, output) {
  const directory = (await manager.store.read(key)).worktree.path;
  const files = ["gallery-count.html", "gallery-data.html"].map(name => path.join(directory, name));
  files.forEach((file, index) => fs.writeFileSync(file, tallPreview(index ? "数据一目了然。" : "每一次点击，都有回应。")));
  const text = "两个可交互测试页：\n\n" + files.map((file, index) => `visualize${JSON.stringify({ path: file, title: index ? "数据视图" : "交互计数" })}`).join("\n\n") + "\n\n选择后继续讨论。";
  const item = await manager.views.presenter.item(key, normalizeItem({ id: "preview-group-layout", type: "agentMessage", status: "completed", text }, "layout-turn"));
  files.forEach(file => fs.unlinkSync(file));
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  const errors = [], messages = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/workbench/attention*", route => route.fulfill({ json: { items: [], total: 0, nextCursor: null } }));
  await page.route(`**/api/runs/${key}`, async route => {
    const response = await route.fetch(), detail = await response.json();
    await route.fulfill({ json: { ...detail, status: "completed", turnId: null, readOnlyReason: null, requests: [], items: [item], nextCursor: null } });
  });
  await page.route(`**/api/runs/${key}/messages`, async route => { messages.push(route.request().postDataJSON()); await route.fulfill({ json: { accepted: true } }); });
  const group = page.locator(".session-preview-group"), active = () => group.locator(".session-preview:visible");
  const frame = () => active().frameLocator("iframe");
  async function fitted() {
    let previous = "", stable = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      const size = await active().evaluate(preview => {
        const stage = preview.querySelector(".preview-stage"), canvas = preview.querySelector(".preview-canvas"), iframe = preview.querySelector("iframe");
        return { width: iframe.clientWidth, height: iframe.clientHeight, scale: canvas.clientWidth / iframe.clientWidth,
          fits: canvas.clientHeight <= stage.clientHeight + 1 && stage.scrollWidth <= stage.clientWidth + 1 };
      });
      const scale = await frame().locator("body").evaluate(element => Number(element.style.transform.slice(6, -1)));
      const next = JSON.stringify(size);
      stable = size.fits && size.width >= 960 && Math.abs(scale - size.scale) < .002 && next === previous ? stable + 1 : 0;
      if (stable >= 3) return;
      previous = next;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail("preview viewport and sandbox did not settle at the same fitted size");
  }
  try {
    await page.goto(`${origin}/?task=${key}`);
    await frame().locator("#layout-demo").waitFor();
    await fitted();
    assert.equal(await group.count(), 1, "adjacent files should render in one group");
    assert.equal(await group.locator("iframe").count(), 1, "unvisited pages load lazily");
    await page.getByText("两个可交互测试页：", { exact: true }).waitFor();
    await page.getByText("选择后继续讨论。", { exact: true }).waitFor();
    const instance = await frame().locator("body").evaluate(() => window.previewInstance);
    await active().locator(".preview-stage").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "session-preview-gallery-initial.png"), fullPage: true });
    await frame().locator("#layout-increment").click();
    await frame().locator("#layout-count").filter({ hasText: /^1$/ }).waitFor();
    await active().getByRole("button", { name: "下一个预览", exact: true }).click();
    await frame().locator("#layout-count").filter({ hasText: /^0$/ }).waitFor();
    await frame().locator("#layout-increment").click();
    await frame().locator("#layout-increment").click();
    await frame().locator("#layout-count").filter({ hasText: /^2$/ }).waitFor();
    await active().getByRole("button", { name: "上一个预览", exact: true }).click();
    assert.equal(await frame().locator("#layout-count").textContent(), "1");
    assert.equal(await frame().locator("body").evaluate(() => window.previewInstance), instance);
    await active().getByRole("button", { name: "全屏预览", exact: true }).click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await fitted();
    assert.equal(await frame().locator("body").evaluate(() => window.previewInstance), instance);
    await page.screenshot({ path: path.join(output, "session-preview-fullscreen-native.png"), fullPage: true });
    await frame().locator("#layout-increment").press("Escape");
    await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector(".session-preview-group.is-fullscreen"));
    assert.equal(await frame().locator("#layout-count").textContent(), "1");

    // The fallback must escape the conversation's containment without moving
    // or reloading the iframe, including when an unsaved draft is present.
    await group.evaluate(element => { element.requestFullscreen = () => Promise.reject(new Error("unsupported")); });
    await active().getByRole("button", { name: "全屏预览", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".session-preview-group")?.matches(":popover-open"));
    const fullscreenBounds = await group.boundingBox();
    assert.deepEqual([fullscreenBounds.x, fullscreenBounds.y, fullscreenBounds.width, fullscreenBounds.height], [0, 0, 1440, 900]);
    assert.equal(await frame().locator("body").evaluate(() => window.previewInstance), instance);
    await active().getByRole("button", { name: "下一个预览", exact: true }).click();
    assert.equal(await frame().locator("#layout-count").textContent(), "2");
    await page.screenshot({ path: path.join(output, "session-preview-fullscreen-fallback.png"), fullPage: true });
    await frame().locator("#layout-feedback").click();
    await page.locator(".composer-preview-reference").waitFor();
    assert.equal(await group.evaluate(element => element.matches(":popover-open")), false);
    assert.equal(messages.length, 0, "fullscreen feedback only stages the existing composer");
    assert.match(await page.locator(".composer-preview-reference").textContent(), /数据视图/);
    await page.getByRole("button", { name: "移除预览引用", exact: true }).click();
    await page.locator(".session-composer textarea").fill("");

    const containment = await page.locator(".workspace > main").evaluate(element => window.getComputedStyle(element).containerType);
    await group.evaluate(element => { element.showPopover = undefined; });
    await active().getByRole("button", { name: "全屏预览", exact: true }).click();
    assert.deepEqual(await group.boundingBox(), { x: 0, y: 0, width: 1440, height: 900 });
    assert.equal(await frame().locator("#layout-count").textContent(), "2");
    await active().getByRole("button", { name: "退出全屏", exact: true }).click();
    assert.equal(await page.locator(".workspace > main").evaluate(element => window.getComputedStyle(element).containerType), containment);
    await group.evaluate(element => { delete element.showPopover; });

    for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
      await page.setViewportSize({ width, height }); await fitted();
      await group.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `page overflow at ${width}`);
      if (width >= 1280) assert.ok((await page.locator(".session-composer .composer").boundingBox()).height <= 130, "compact empty composer");
      await page.screenshot({ path: path.join(output, `session-preview-gallery-${width}.png`), fullPage: true });
      await active().getByRole("button", { name: "全屏预览", exact: true }).click(); await fitted();
      const bounds = await group.boundingBox();
      assert.ok(Math.abs(bounds.width - width) < 2 && Math.abs(bounds.height - height) < 2);
      await page.screenshot({ path: path.join(output, `session-preview-gallery-fullscreen-${width}.png`), fullPage: true });
      await active().getByRole("button", { name: "退出全屏", exact: true }).click();
      await active().getByRole("button", { name: "原始大小", exact: true }).click();
      await frame().locator("body").evaluate(element => new Promise(resolve => {
        const check = () => element.style.transform === "scale(1)" ? resolve() : window.requestAnimationFrame(check);
        check();
      }));
      await active().getByRole("button", { name: "适应窗口", exact: true }).click(); await fitted();
    }
    await page.locator(".session-composer textarea").fill("第一行\n第二行\n第三行\n第四行");
    assert.equal(await page.locator(".session-composer textarea").inputValue(), "第一行\n第二行\n第三行\n第四行");
    await page.locator(".composer-send").scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".composer-send").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    }), true);
    await page.evaluate(() => localStorage.setItem("web-coding.locale", "en"));
    await page.reload(); await frame().locator("#layout-demo").waitFor(); await fitted();
    await active().locator(".preview-stage").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "session-preview-gallery-en-320.png"), fullPage: true });
    // A document using viewport units must not grow its iframe on each resize.
    await frame().locator("#layout-demo").evaluate(element => { element.style.width = "100%"; element.style.height = "100vh"; });
    await page.setViewportSize({ width: 1440, height: 900 });
    const samples = [];
    for (let index = 0; index < 6; index++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      samples.push(await frame().locator("body").evaluate(element => ({ viewport: window.innerHeight, content: element.scrollHeight })));
    }
    assert.ok(samples.every(size => size.viewport <= 640 && size.content < 1200), "viewport-sized content stays bounded");
    assert.deepEqual(samples.at(-1), samples.at(-2), "100vh layout settles without resize growth");
    await group.evaluate(element => { element.requestFullscreen = () => Promise.reject(new Error("unsupported")); });
    await active().getByRole("button", { name: "Fullscreen preview", exact: true }).click();
    await page.evaluate(() => { history.pushState({}, "", "/accounts"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await group.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.equal(await page.locator("[inert]").count(), 0);
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "session-preview-layout-failure.png"), fullPage: true });
    throw error;
  } finally { await page.close(); }
}

module.exports = { verifySessionPreviewLayout };
