/* global window, document */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

async function operationFeedbackChecks() {
  const { createServer } = await import("vite");
  const { default: vue } = await import("@vitejs/plugin-vue");
  const source = `import {i18n,setLocale} from '/src/shared/i18n/index.js';
import {createApp,h,ref,nextTick} from 'vue';
import OperationMessages from '/src/shared/components/OperationMessages.vue';
import FeedbackMessage from '/src/shared/components/FeedbackMessage.vue';
import {showMessage,clearMessages,messageRevision} from '/src/shared/components/operation-messages.js';
import {useResource} from '/src/shared/api/use-resource.js';
import '/src/shared/styles/style.css';
import '/src/shared/styles/workbench.css';
const visible=ref(true), text=ref(''), type=ref('info');
const Resource={setup(){const resource=useResource(async()=>{throw new Error('后台读取失败');},{immediate:false});
window.resource=resource;
return()=>h('section',{id:'resource'},[h(FeedbackMessage,{message:resource.error.value,type:'error'}),h('button',{id:'save',onClick:()=>resource.perform(async()=>({}),()=>{visible.value=false;},'卸载后仍已保存')},'保存并离开')]);}};
window.feedback={show:showMessage,clear:clearMessages,locale:setLocale,revision:()=>messageRevision.value,async bind(message,kind){text.value=message;type.value=kind;await nextTick();},async reset(){text.value='';clearMessages();await nextTick();}};
createApp({render:()=>h('main',[h(OperationMessages),h(FeedbackMessage,{message:text.value,type:type.value}),h('section',{id:'content',style:'margin:160px 16px 0'},[h('input',{id:'field','aria-label':'原表单'}),h('p','固定页面内容'),visible.value?h(Resource):null]),h('dialog',{id:'modal'},[h('input',{id:'modal-field','aria-label':'弹窗表单'}),h('button',{onClick:()=>document.querySelector('#modal').close()},'关闭弹窗')])])}).use(i18n).mount('#app');`;
  const server = await createServer({ configFile: false, root: path.resolve("web"), logLevel: "error", plugins: [vue(), {
    name: "operation-feedback-fixture",
    resolveId(id) { if (id === "virtual:feedback") return "\0feedback"; },
    load(id) { if (id === "\0feedback") return source; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/feedback") return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/@id/virtual:feedback"></script></body></html>'));
      });
    },
  }], server: { host: "127.0.0.1", port: 0 } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/feedback`);
    await page.locator("#field").waitFor();
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const cards = page.locator(".operation-message");
    const reset = () => page.evaluate(() => window.feedback.reset());
    const show = (message, type = "success") => page.evaluate(({ message, type }) => window.feedback.show(message, type), { message, type });
    const before = await page.locator("#content").boundingBox();
    await page.locator("#field").focus();
    for (const type of ["success", "error", "warning", "info"]) {
      await page.evaluate(type => window.feedback.bind(`${type} 操作提示`, type), type);
      await page.locator(`.operation-message[data-type="${type}"]`).waitFor();
    }
    assert.equal(await cards.count(), 4);
    assert.equal(await page.locator('.operation-message[role="alert"]').count(), 2);
    assert.equal(await page.locator('.operation-message[role="status"]').count(), 2);
    assert.deepEqual(await page.locator("#content").boundingBox(), before);
    assert.equal(await page.evaluate(() => document.activeElement.id), "field");
    const output = path.resolve("state/browser/operation-feedback");
    fs.mkdirSync(output, { recursive: true });
    for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1280, 720], [1440, 900], [1920, 1080], [2560, 1440]]) {
      await page.setViewportSize({ width, height });
      const bounds = await cards.first().boundingBox();
      const edge = width < 768 ? 16 : 24;
      const contentWidth = await page.evaluate(() => document.documentElement.clientWidth);
      assert.ok(Math.abs(bounds.y + bounds.height - (height - edge)) < 2, "latest message stays above bottom safe edge");
      assert.ok(bounds.x >= edge && Math.abs(bounds.x + bounds.width - (contentWidth - edge)) < 2, JSON.stringify({ width, bounds }));
      assert.ok(bounds.width <= 400, "2K keeps the same readable card width");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: path.join(output, `messages-${width}.png`), fullPage: true });
    }
    await cards.first().hover();
    await page.waitForFunction(() => document.querySelector('.operation-messages').dataset.expanded === 'true');
    const expandedBounds = await cards.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; }));
    assert.ok(expandedBounds.slice(1).every((rect, index) => rect.bottom < expandedBounds[index].top), "hover reveals every message without overlap");
    await page.clock.runFor(12000);
    assert.equal(await cards.count(), 4, "reading the stack pauses every message");
    await show("阅读期间的新提示", "error");
    await page.clock.runFor(12000);
    assert.equal(await cards.count(), 4, "new messages also pause while the stack is being read");
    await page.screenshot({ path: path.join(output, "messages-expanded.png") });
    await page.mouse.move(1, 1);
    await cards.last().getByRole('button').focus();
    await show("替换已聚焦的最旧提示", "warning");
    await page.waitForFunction(() => document.querySelector('.operation-messages').dataset.expanded === 'false');
    await page.clock.runFor(11000);
    assert.equal(await cards.count(), 0, "evicting a focused message must not leave the remaining timers paused forever");
    await reset();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { const nav = document.createElement('nav'); nav.className = 'ui-bottom-nav'; nav.textContent = '工作台 · 项目 · 事项 · 开发 · 交付'; document.body.append(nav); });
    await show("项目设置已保存");
    assert.ok((await cards.first().boundingBox()).y + (await cards.first().boundingBox()).height < (await page.locator('.ui-bottom-nav').boundingBox()).y, "message clears mobile navigation");
    await page.screenshot({ path: path.join(output, "messages-mobile-navigation.png") });
    await page.evaluate(() => document.querySelector('.ui-bottom-nav').remove());
    await reset();
    await page.evaluate(() => window.feedback.locale('en'));
    await show("Git 账号已保存。准备项目开发空间时会验证实际仓库的访问权限。");
    await cards.getByRole('button', { name: 'Dismiss notification' }).waitFor();
    assert.match(await cards.innerText(), /Git/);
    await page.screenshot({ path: path.join(output, "messages-mobile-en.png") });
    await reset();
    await page.evaluate(() => window.feedback.locale('zh-CN'));
    await page.setViewportSize({ width: 320, height: 400 });
    await show("LongUnbrokenErrorDetail".repeat(80), "error");
    const longText = cards.locator('.operation-message-text');
    assert.equal(await longText.evaluate(element => element.scrollHeight > element.clientHeight && element.scrollWidth <= element.clientWidth), true, "long details scroll vertically without widening the card");
    assert.ok((await cards.first().boundingBox()).y >= 0);
    await page.screenshot({ path: path.join(output, "messages-short-long.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reset();
    await show('<img src=x onerror="window.feedbackInjected=true">');
    assert.equal(await cards.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.feedbackInjected)), false);
    assert.match(await cards.innerText(), /<img src=x/);
    await reset();
    await show("重复成功"); await show("重复成功");
    assert.equal(await cards.count(), 1);
    await page.clock.runFor(4100);
    await cards.waitFor({ state: "hidden" });
    await show("悬浮暂停"); await cards.hover();
    await show("悬浮暂停"); await page.clock.runFor(12000);
    assert.equal(await cards.count(), 1);
    await page.mouse.move(1, 900); await page.clock.runFor(4100);
    await cards.waitFor({ state: "hidden" });
    await show("焦点暂停"); await cards.getByRole("button").focus();
    await show("焦点暂停"); await page.clock.runFor(12000);
    assert.equal(await cards.count(), 1);
    await page.locator("#field").focus(); await page.clock.runFor(4100);
    await cards.waitFor({ state: "hidden" });
    // Vue ignores events timestamped at listener attachment; advance the frozen clock before clicking a new card.
    await show("手动关闭", "error"); await page.clock.runFor(1); await cards.getByRole("button", { name: "关闭提示" }).click();
    await cards.waitFor({ state: "hidden" });
    await page.evaluate(() => document.querySelector("#modal").showModal());
    await page.locator("#modal-field").focus();
    await show("弹窗内提示", "warning"); await cards.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), "modal-field");
    await cards.getByRole("button").focus();
    assert.equal(await cards.getByRole("button").evaluate(element => element === document.activeElement), true);
    await page.clock.runFor(1); await cards.getByRole("button").click(); await cards.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await show("待清空"); await reset(); assert.equal(await cards.count(), 0);
    await page.evaluate(() => window.resource.reload({ background: true }));
    await cards.filter({ hasText: "后台读取失败" }).waitFor();
    const revision = await page.evaluate(() => window.feedback.revision());
    await page.evaluate(() => window.resource.reload({ background: true }));
    assert.equal(await page.evaluate(() => window.feedback.revision()), revision);
    await reset();
    await page.locator("#save").click();
    await page.locator("#resource").waitFor({ state: "detached" });
    await cards.filter({ hasText: "卸载后仍已保存" }).waitFor();
    assert.deepEqual(errors, []);
    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await touch.goto(`http://127.0.0.1:${server.httpServer.address().port}/feedback`);
    await touch.locator('#field').waitFor();
    await touch.evaluate(() => { window.feedback.show('第一条提示', 'error'); window.feedback.show('第二条提示', 'warning'); });
    await touch.locator('.operation-message-text').first().tap();
    await touch.waitForFunction(() => document.querySelector('.operation-messages').dataset.expanded === 'true');
    await touch.getByRole('button', { name: '关闭提示' }).first().tap();
    assert.equal(await touch.locator('.operation-message').count(), 1);
    await touch.locator('#field').tap();
    await touch.waitForFunction(() => document.querySelector('.operation-messages').dataset.expanded === 'false');
    await touch.close();
    console.log("Operation feedback fake-API browser checks passed.");
  } finally { await browser?.close(); await server.close(); }
}

module.exports = { operationFeedbackChecks };
if (require.main === module) operationFeedbackChecks().catch(error => { console.error(error); process.exitCode = 1; });
