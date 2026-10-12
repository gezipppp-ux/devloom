/* global window, document */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

async function operationFeedbackChecks() {
  const { createServer } = await import("vite");
  const { default: vue } = await import("@vitejs/plugin-vue");
  const source = `import {createApp,h,ref,nextTick} from 'vue';
import OperationMessages from '/src/shared/components/OperationMessages.vue';
import FeedbackMessage from '/src/shared/components/FeedbackMessage.vue';
import {showMessage,clearMessages,messageRevision} from '/src/shared/components/operation-messages.js';
import {useResource} from '/src/shared/api/use-resource.js';
import '/src/shared/styles/style.css';
const visible=ref(true), text=ref(''), type=ref('info');
const Resource={setup(){const resource=useResource(async()=>{throw new Error('后台读取失败');},{immediate:false});
window.resource=resource;
return()=>h('section',{id:'resource'},[h(FeedbackMessage,{message:resource.error.value,type:'error'}),h('button',{id:'save',onClick:()=>resource.perform(async()=>({}),()=>{visible.value=false;},'卸载后仍已保存')},'保存并离开')]);}};
window.feedback={show:showMessage,clear:clearMessages,revision:()=>messageRevision.value,async bind(message,kind){text.value=message;type.value=kind;await nextTick();},async reset(){text.value='';clearMessages();await nextTick();}};
createApp({render:()=>h('main',[h(OperationMessages),h(FeedbackMessage,{message:text.value,type:type.value}),h('section',{id:'content',style:'margin:160px 16px 0'},[h('input',{id:'field','aria-label':'原表单'}),h('p','固定页面内容'),visible.value?h(Resource):null]),h('dialog',{id:'modal'},[h('input',{id:'modal-field','aria-label':'弹窗表单'}),h('button',{onClick:()=>document.querySelector('#modal').close()},'关闭弹窗')])])}).mount('#app');`;
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
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const bounds = await cards.first().boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y < 64 && bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: path.join(output, `messages-${width}.png`), fullPage: true });
    }
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
    console.log("Operation feedback fake-API browser checks passed.");
  } finally { await browser?.close(); await server.close(); }
}

module.exports = { operationFeedbackChecks };
if (require.main === module) operationFeedbackChecks().catch(error => { console.error(error); process.exitCode = 1; });
