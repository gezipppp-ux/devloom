/* global document */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { selectOption, selectPreference } = require("../support/select.cjs");
const { dismissOperationMessages } = require("../support/operation-feedback.cjs");
const { defaultWorkflow } = require("../../src/domain/issue-workflows.cjs");
const { recommendedWorkflow } = require("../../src/domain/recommended-workflow.cjs");

async function deliveryWithoutAgentChecks() {
  const { createServer } = await import("vite"), { default: vue } = await import("@vitejs/plugin-vue");
  const source = `import {createApp,h} from 'vue'; import {createRouter,createWebHistory} from 'vue-router';
import {i18n} from '/src/shared/i18n/index.js'; import LocaleSelect from '/src/shared/components/LocaleSelect.vue';
import OperationMessages from '/src/shared/components/OperationMessages.vue';
import Detail from '/src/features/projects/IssueDetail.vue'; import Upgrade from '/src/features/projects/IssueWorkflowUpgrade.vue';
import Issues from '/src/features/projects/ProjectIssues.vue'; import Tasks from '/src/features/projects/ProjectTasks.vue'; import Queue from '/src/features/projects/WorkQueue.vue'; import Delivery from '/src/features/projects/DeliveryDetail.vue';
import Workflow from '/src/features/settings/SystemWorkflows.vue'; import Publish from '/src/features/projects/PublishDelivery.vue';
import '/src/shared/styles/style.css'; import '/src/shared/styles/workbench.css'; import '/src/shared/styles/projects.css';
const router=createRouter({history:createWebHistory(),routes:[{path:'/projects/:projectId',name:'project',component:{render:()=>null}},{path:'/deliveries',name:'deliveries',component:{render:()=>null}},{path:'/:pathMatch(.*)*',component:{render:()=>null}}]});
await router.push(location.pathname+location.search); await router.isReady();
const kind=new URLSearchParams(location.search).get('kind'); const component={issue:Detail,upgrade:Upgrade,workflow:Workflow,task:Publish,project:Issues,tasks:Tasks,queue:Queue,review:Delivery}[kind];
createApp({render:()=>h('div',[h(LocaleSelect),h(OperationMessages),h(component,{projectId:'p',...(kind==='tasks'||kind==='project'?{}:{issueId:'i'}),type:'requirement',kind:'tasks',deliveryId:'d',onOpenTask:()=>router.push({query:{tab:'tasks'}}),...(kind==='task'?{taskId:'t'}:{}),permissions:['issue.view','issue.assign','issue.transition','collaboration.view','deliverable.create','comment.create']})])}).use(router).use(i18n).mount('#app');`;
  const server = await createServer({ configFile: false, root: path.resolve("web"), logLevel: "error", plugins: [vue(), {
    name: "delivery-fixture", resolveId(id) { if (id === "virtual:delivery") return "\0delivery"; }, load(id) { if (id === "\0delivery") return source; },
    configureServer(server) { server.middlewares.use(async (req, res, next) => { if (!req.url.startsWith("/fixture")) return next(); res.setHeader("Content-Type", "text/html"); res.end(await server.transformIndexHtml(req.url, '<html><body><main id="app"></main><script type="module" src="/@id/virtual:delivery"></script></body></html>')); }); },
  }], server: { host: "127.0.0.1", port: 0 } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}) });
    const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 900 } }), errors = [], writes = [], reads = [], assigned = new Set();
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    const output = path.resolve("state/browser/delivery-without-agent"); fs.mkdirSync(output, { recursive: true });
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`, definition = recommendedWorkflow("requirement");
    let mode = "manual", rejectWrite = true, latestVersion = 2, actionLabel = "线下处理";
    const issue = (id = "i") => ({ id, number: id === "i" ? 1 : 2, type: "requirement", title: id === "i" ? "可验证的业务成果" : "另一条待处理事项", description: "已完成配置或开发，并提供实际核验记录。", acceptanceCriteria: "结果符合业务要求", priority: "normal", revision: 3, watcherIds: [],
      status: "ready", statusName: "待开发", workflow: { version: 2, latestPublishedVersion: latestVersion, definition }, processing: { handlerId: "u", status: "ready" },
      deliverySubmission: { allowed: true, label: actionLabel, taskId: mode === "manual" ? null : "t" },
      assignmentAllowed: true, developerId: assigned.has(id) ? "u" : null, development: mode === "manual" && !assigned.has(id) ? null : { taskId: "t", executorId: "u", executorName: "处理人" }, people: [], availableTransitions: [],
      workflowActions: [{ trigger: "delivery.submitted", name: actionLabel, statusName: "待验证" }],
    });
    await page.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname, input = route.request().postDataJSON();
      if (!pathname.startsWith("/api/")) return route.fallback();
      if (route.request().method() === "GET") reads.push(new URL(route.request().url()));
      if (route.request().method() === "POST") {
        writes.push({ pathname, input });
        if (pathname.endsWith('/tasks')) { input.issueIds.forEach(id => assigned.add(id)); return route.fulfill({ json: { tasks: input.issueIds.map(id => ({ id: 't-' + id })) } }); }
        if (rejectWrite && !pathname.startsWith("/api/system/")) return route.fulfill({ status: 409, json: { error: "事项、任务或流程已变化，请重新预览后提交。" } });
        return route.fulfill({ json: pathname.includes("workflow-upgrade") ? issue() : pathname.startsWith("/api/system/") ? { workflow: { draft: input.definition, revision: 2, publishedVersion: 1 }, recommendedDefinition: definition } : { id: "delivery" } });
      }
      let result = { items: [], people: [] };
      if (pathname.endsWith("/workflow-upgrade")) result = { available: true, issueRevision: 3, actionRevision: 2, targetVersionId: "v2", currentVersion: 1, targetVersion: 2, statusName: "规划中", targetStatusName: "规划中", handlerId: "u", tasks: [], people: [{ id: "u", displayName: "处理人" }] };
      else if (pathname.startsWith("/api/system/")) result = { workflow: { draft: defaultWorkflow("requirement"), revision: 1, publishedVersion: 1 }, recommendedDefinition: definition };
      else if (/\/issues\/[ij]$/.test(pathname)) result = issue(pathname.split("/").at(-1));
      else if (pathname.endsWith("/issues")) result = { items: [issue(), issue("j")], people: [{ id: "u", displayName: "处理人" }] };
      else if (pathname.endsWith("/members")) result = { members: [{ userId: "u", username: "dev", displayName: "处理人", status: "active", userStatus: "active", effectivePermissions: ["session.start"] }] };
      else if (pathname.endsWith("/history")) result = { items: [{ id: "h", action: "workflow.upgraded", data: { before: { workflowVersion: { version: 1 } }, after: { workflowVersion: { version: 2 } }, reason: "已审核新流程" } }], people: [] };
      else if (pathname.endsWith("/reviewers")) result = { items: [{ id: "qa", displayName: "验证人", username: "qa" }] };
      else if (pathname.endsWith("/tasks/t")) result = { task: { id: "t", title: "已有成果", status: "planned", kind: "issues", issues: [issue(), { id: "done", title: "已送验范围" }], issueIds: ["i", "done"], additions: [], scope: [{ id: "i", submission: { allowed: true } }, { id: "done", submission: { allowed: false } }] } };
      else if (pathname.endsWith('/issue-workflows/requirement')) result = { workflow: { versions: [{ version: 1, definition }] } };
      else if (pathname.endsWith('/tasks')) result = { tasks: [], items: [], total: 0 };
      else if (pathname.endsWith('/deliveries/d')) result = { delivery: { id: 'd', title: '定制验证', status: 'pending', reviewerId: 'qa', checklist: ['核验结果'], checkedItems: [] }, canReview: true, permissions: ['deliverable.review', 'issue.accept'], people: [], issue: { ...issue(), workflowActions: [
        { trigger: 'verification.started', name: '进入质检', allowed: true, statusName: '质检中' },
        { trigger: 'verification.accepted', name: '确认交付合格', allowed: true, statusName: '已交付' },
        { trigger: 'verification.returned', name: '发回补充材料', allowed: false, statusName: '补充材料' },
      ] } };
      await route.fulfill({ json: result });
    });
    const open = kind => page.goto(`${origin}/fixture?kind=${kind}`);
    const viewports = [[1920, 1080], [2560, 1440], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]];
    async function capture(name) {
      for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name} overflow at ${width}`);
        const dialog = page.getByRole("dialog");
        if (await dialog.count()) assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name} dialog overflow at ${width}`);
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
      await page.getByRole("button", { name: "线下处理", exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /采用新流程版本/ }).count(), 0);
      assert.equal(await page.getByText('当前没有可用的状态操作。', { exact: true }).count(), 0);
      await capture(`issue-page-${mode}`);
      latestVersion = 3; await page.reload();
      await page.getByRole('button', { name: /采用新流程版本/ }).waitFor();
      latestVersion = 2;
      await page.getByRole("button", { name: "线下处理", exact: true }).click();
      await page.getByLabel("交付说明", { exact: true }).fill("已完成工作和可复核的证据");
      await page.getByLabel("验证结果", { exact: true }).fill("验证通过");
      await selectOption(page.getByLabel("交付验证人", { exact: true }), "qa");
      await page.getByRole("dialog").getByRole("checkbox").check();
      await capture(`delivery-${mode}`);
      const submit = page.getByRole("dialog").getByRole("button", { name: actionLabel, exact: true });
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
    await selectPreference(page, "locale", "en");
    actionLabel = '配置完成，提交复核';
    await open("task");
    await page.getByRole("heading", { name: actionLabel, exact: true }).first().waitFor();
    assert.equal(await page.getByText("已送验范围", { exact: true }).count(), 0, "pending scope cannot be selected again");
    await page.screenshot({ path: path.join(output, "delivery-en-320.png") });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await open("workflow");
    await selectPreference(page, "locale", "zh-CN");
    await page.getByRole('button', { name: '流程模板', exact: true }).waitFor();
    await capture('workflow-page');
    const before = writes.length;
    await page.getByRole("button", { name: "流程模板", exact: true }).click();
    await capture('workflow-template');
    await page.getByRole("button", { name: "确认载入草稿", exact: true }).click();
    await page.getByRole('button', { name: '交接预览', exact: true }).click();
    await selectOption(page.getByRole('dialog').getByLabel('来源状态', { exact: true }), 'ready');
    await selectOption(page.getByRole('dialog').getByLabel('触发事件', { exact: true }), 'delivery.submitted');
    await page.getByRole('dialog').getByText('待开发 → 待验证', { exact: true }).waitFor();
    await capture('handoff-preview');
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(writes.length, before, "loading the template never saves or publishes");
    await page.getByRole("button", { name: "保存流程草稿", exact: true }).click();
    await page.getByText("流程草稿已保存。", { exact: true }).last().waitFor();
    assert.deepEqual(writes.at(-1).input.definition, definition);
    assert.ok(!writes.some(write => write.pathname.endsWith("/publish") || write.pathname.endsWith("/start")));
    await dismissOperationMessages(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    mode = 'manual';
    await page.goto(`${origin}/fixture?kind=project&issue=i&q=保持筛选&offset=30`);
    await page.getByRole('button', { name: '指派', exact: true }).click();
    await selectOption(page.getByRole('dialog').getByLabel('开发负责人', { exact: true }), 'u');
    await page.getByRole('button', { name: '确认指派', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: '查看开发任务', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('issue'), 'i');
    assert.equal(new URL(page.url()).searchParams.get('q'), '保持筛选');
    assert.equal(new URL(page.url()).searchParams.get('offset'), '30');
    await page.getByRole('textbox', { name: '评论内容', exact: true }).fill('保留当前讨论草稿');
    assert.equal(await page.getByRole('button', { name: '指派', exact: true }).isDisabled(), true);
    assigned.clear();
    await page.goto(`${origin}/fixture?kind=project&q=保持筛选&offset=30`);
    await page.getByRole('checkbox', { name: '选择事项 1', exact: true }).check();
    await page.getByRole('checkbox', { name: '选择事项 2', exact: true }).check();
    await page.getByRole('button', { name: '指派', exact: true }).click();
    await selectOption(page.getByRole('dialog').getByLabel('开发负责人', { exact: true }), 'u');
    await page.getByRole('button', { name: '确认指派', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('checkbox', { name: '选择事项 1', exact: true, disabled: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('tab'), null);
    assert.equal(new URL(page.url()).searchParams.get('offset'), '30');
    assert.equal(writes.at(-1).input.issueIds.length, 2);
    for (const kind of ['tasks', 'queue']) {
      await open(kind);
      if (kind === 'queue') await page.getByRole('button', { name: '筛选', exact: true }).click();
      await page.getByLabel('任务状态', { exact: true }).waitFor();
      assert.equal(reads.filter(url => url.pathname.endsWith('/tasks')).at(-1).searchParams.get('status'), 'not_cancelled');
      for (const status of ['all', 'cancelled']) {
        const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/tasks') && new URL(response.url()).searchParams.get('status') === status);
        await selectOption(page.getByLabel('任务状态', { exact: true }), status); await response;
      }
    }
    await open('review');
    await page.getByRole('button', { name: '进入质检', exact: true }).waitFor();
    await page.getByRole('button', { name: '确认交付合格', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '发回补充材料', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '通过验收', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log("Delivery without Agent: entry points, template, upgrade, retry, scope, English and seven responsive viewports passed.");
  } finally { await browser?.close(); await server.close(); }
}

module.exports = { deliveryWithoutAgentChecks };
if (require.main === module) deliveryWithoutAgentChecks().catch(error => { console.error(error); process.exitCode = 1; });
