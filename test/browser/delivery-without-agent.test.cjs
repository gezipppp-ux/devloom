/* global document */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { selectOption } = require("../support/select.cjs");
const { dismissOperationMessages } = require("../support/operation-feedback.cjs");
const { defaultWorkflow } = require("../../src/domain/issue-workflows.cjs");
const { recommendedWorkflow } = require("../../src/domain/recommended-workflow.cjs");

async function deliveryWithoutAgentChecks() {
  const { createServer } = await import("vite"), { default: vue } = await import("@vitejs/plugin-vue");
  const source = `import {createApp,h} from 'vue'; import {createRouter,createWebHistory} from 'vue-router';
import {i18n} from '/src/shared/i18n/index.js'; import LocaleSelect from '/src/shared/components/LocaleSelect.vue';
import OperationMessages from '/src/shared/components/OperationMessages.vue';
import Detail from '/src/features/projects/IssueDetail.vue'; import Upgrade from '/src/features/projects/IssueWorkflowUpgrade.vue';
import Workflow from '/src/features/settings/SystemWorkflows.vue'; import Publish from '/src/features/projects/PublishDelivery.vue';
import '/src/shared/styles/style.css'; import '/src/shared/styles/workbench.css'; import '/src/shared/styles/projects.css';
const router=createRouter({history:createWebHistory(),routes:[{path:'/deliveries',name:'deliveries',component:{render:()=>null}},{path:'/:pathMatch(.*)*',component:{render:()=>null}}]});
await router.push(location.pathname+location.search); await router.isReady();
const kind=new URLSearchParams(location.search).get('kind'); const component={issue:Detail,upgrade:Upgrade,workflow:Workflow,task:Publish}[kind];
createApp({render:()=>h('div',[h(LocaleSelect),h(OperationMessages),h(component,{projectId:'p',issueId:'i',...(kind==='task'?{taskId:'t'}:{}),permissions:['issue.view','issue.assign','issue.transition','collaboration.view','deliverable.create']})])}).use(router).use(i18n).mount('#app');`;
  const server = await createServer({ configFile: false, root: path.resolve("web"), logLevel: "error", plugins: [vue(), {
    name: "delivery-fixture", resolveId(id) { if (id === "virtual:delivery") return "\0delivery"; }, load(id) { if (id === "\0delivery") return source; },
    configureServer(server) { server.middlewares.use(async (req, res, next) => { if (!req.url.startsWith("/fixture")) return next(); res.setHeader("Content-Type", "text/html"); res.end(await server.transformIndexHtml(req.url, '<html><body><main id="app"></main><script type="module" src="/@id/virtual:delivery"></script></body></html>')); }); },
  }], server: { host: "127.0.0.1", port: 0 } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], writes = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    const output = path.resolve("state/browser/delivery-without-agent"); fs.mkdirSync(output, { recursive: true });
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`, definition = recommendedWorkflow("requirement");
    let mode = "manual", rejectWrite = true;
    const issue = () => ({ id: "i", number: 1, type: "requirement", title: "可验证的业务成果", description: "已完成配置或开发，并提供实际核验记录。", acceptanceCriteria: "结果符合业务要求", priority: "normal", revision: 3, watcherIds: [],
      status: mode === "manual" ? "planned" : "ready", statusName: mode === "manual" ? "规划中" : "待开发", workflow: { version: 2, definition }, processing: { handlerId: "u", status: "ready" },
      deliverySubmission: { allowed: true, label: mode === "manual" ? "提交人工成果" : "提交已有成果", taskId: mode === "manual" ? null : "t" },
      development: mode === "manual" ? null : { taskId: "t", executorId: "u", executorName: "处理人" }, people: [], availableTransitions: [],
      workflowActions: [{ trigger: "delivery.submitted", statusName: "待验证" }],
    });
    await page.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname, input = route.request().postDataJSON();
      if (!pathname.startsWith("/api/")) return route.fallback();
      if (route.request().method() === "POST") {
        writes.push({ pathname, input });
        if (rejectWrite && !pathname.startsWith("/api/system/")) return route.fulfill({ status: 409, json: { error: "事项、任务或流程已变化，请重新预览后提交。" } });
        return route.fulfill({ json: pathname.includes("workflow-upgrade") ? issue() : pathname.startsWith("/api/system/") ? { workflow: { draft: input.definition, revision: 2, publishedVersion: 1 }, recommendedDefinition: definition } : { id: "delivery" } });
      }
      let result = { items: [], people: [] };
      if (pathname.endsWith("/workflow-upgrade")) result = { available: true, issueRevision: 3, actionRevision: 2, targetVersionId: "v2", currentVersion: 1, targetVersion: 2, statusName: "规划中", targetStatusName: "规划中", handlerId: "u", tasks: [], people: [{ id: "u", displayName: "处理人" }] };
      else if (pathname.startsWith("/api/system/")) result = { workflow: { draft: defaultWorkflow("requirement"), revision: 1, publishedVersion: 1 }, recommendedDefinition: definition };
      else if (pathname.endsWith("/issues/i")) result = issue();
      else if (pathname.endsWith("/issues")) result = { items: [issue()] };
      else if (pathname.endsWith("/members")) result = { members: [] };
      else if (pathname.endsWith("/history")) result = { items: [{ id: "h", action: "workflow.upgraded", data: { before: { workflowVersion: { version: 1 } }, after: { workflowVersion: { version: 2 } }, reason: "已审核新流程" } }], people: [] };
      else if (pathname.endsWith("/reviewers")) result = { items: [{ id: "qa", displayName: "验证人", username: "qa" }] };
      else if (pathname.endsWith("/tasks/t")) result = { task: { id: "t", title: "已有成果", status: "planned", kind: "issues", issues: [issue(), { id: "done", title: "已送验范围" }], issueIds: ["i", "done"], additions: [], scope: [{ id: "i", submission: { allowed: true } }, { id: "done", submission: { allowed: false } }] } };
      await route.fulfill({ json: result });
    });
    const open = kind => page.goto(`${origin}/fixture?kind=${kind}`);
    const viewports = [[1920, 1080], [2560, 1440], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]];
    async function capture(name) {
      for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name} overflow at ${width}`);
        const dialog = page.getByRole("dialog");
        assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name} dialog overflow at ${width}`);
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`) });
      }
    }
    await open("upgrade");
    await page.getByLabel("切换原因").fill("使用支持人工成果的已发布流程");
    await page.getByRole("checkbox").check();
    await capture("upgrade");
    await page.getByRole("button", { name: "确认采用新流程", exact: true }).click();
    await page.getByRole("button", { name: "确认采用新流程", exact: true, disabled: false }).waitFor();
    assert.equal(await page.getByLabel("切换原因").inputValue(), "使用支持人工成果的已发布流程");
    await dismissOperationMessages(page);
    rejectWrite = false;
    await page.getByRole("button", { name: "确认采用新流程", exact: true }).click();
    await page.getByText("事项已采用新流程版本，原有历史已保留。", { exact: true }).last().waitFor();
    assert.equal(writes[0].input.requestId, writes[1].input.requestId, "unchanged retries preserve identity");
    await dismissOperationMessages(page);
    await page.getByRole("button", { name: "重新预览", exact: true }).click();
    await page.getByRole("button", { name: "确认采用新流程", exact: true, disabled: true }).waitFor();

    for (mode of ["manual", "existing"]) {
      rejectWrite = true; await open("issue");
      await page.getByRole("button", { name: mode === "manual" ? "提交人工成果" : "提交已有成果", exact: true }).click();
      await page.getByLabel("交付说明", { exact: true }).fill("已完成工作和可复核的证据");
      await page.getByLabel("验证结果", { exact: true }).fill("验证通过");
      await selectOption(page.getByLabel("交付验证人", { exact: true }), "qa");
      await page.getByRole("dialog").getByRole("checkbox").check();
      await capture(`delivery-${mode}`);
      const submit = page.getByRole("dialog").getByRole("button", { name: "提交交付并送验", exact: true });
      await submit.click(); await submit.waitFor({ state: "visible" });
      await page.getByRole("dialog").getByText("事项、任务或流程已变化，请重新预览后提交。", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("交付说明", { exact: true }).inputValue(), "已完成工作和可复核的证据");
      await dismissOperationMessages(page);
      rejectWrite = false; await submit.click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
      const attempts = writes.filter(write => write.pathname.endsWith("/deliveries")).slice(-2);
      assert.equal(attempts[0].input.requestId, attempts[1].input.requestId);
      assert.equal(attempts[1].input.taskId, mode === "manual" ? undefined : "t");
    }
    await page.getByRole("button", { name: "变更历史", exact: true }).click();
    await page.getByText("流程版本：v1 → v2", { exact: true }).waitFor();
    await selectOption(page.getByLabel("界面语言", { exact: true }), "en");
    await open("task");
    await page.getByRole("heading", { name: "Prepare delivery", exact: true }).first().waitFor();
    assert.equal(await page.getByText("已送验范围", { exact: true }).count(), 0, "pending scope cannot be selected again");
    await page.screenshot({ path: path.join(output, "delivery-en-320.png") });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await open("workflow");
    await selectOption(page.getByLabel("Interface language", { exact: true }), "zh-CN");
    const before = writes.length;
    await page.getByRole("button", { name: "载入推荐流程", exact: true }).click();
    await page.getByRole("button", { name: "确认载入草稿", exact: true }).click();
    assert.equal(writes.length, before, "loading the template never saves or publishes");
    await page.getByRole("button", { name: "保存流程草稿", exact: true }).click();
    await page.getByText("流程草稿已保存。", { exact: true }).last().waitFor();
    assert.deepEqual(writes.at(-1).input.definition, definition);
    assert.ok(!writes.some(write => write.pathname.endsWith("/publish") || write.pathname.endsWith("/start")));
    assert.deepEqual(errors, []);
    console.log("Delivery without Agent: entry points, template, upgrade, retry, scope, English and seven responsive viewports passed.");
  } finally { await browser?.close(); await server.close(); }
}

module.exports = { deliveryWithoutAgentChecks };
if (require.main === module) deliveryWithoutAgentChecks().catch(error => { console.error(error); process.exitCode = 1; });
