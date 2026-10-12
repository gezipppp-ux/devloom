/* global document */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { pasteImage, markdownValue, visual, verifyVisualWriting, captureEditor } = require("../support/issue-markdown.cjs");

async function main() {
  await require("./operation-feedback.test.cjs").operationFeedbackChecks();
  const { createServer } = await import("vite"), { default: vue } = await import("@vitejs/plugin-vue");
  const project = { id: "p", name: "原项目", description: "原说明", ownerUserId: "u", revision: 1, settings: {} };
  const issue = { id: "i", number: 1, type: "requirement", title: "原事项", description: "原描述", revision: 1, priority: "normal", status: "ready", statusName: "规划中", participantIds: [], assigneeId: null, acceptanceCriteria: "", availableTransitions: [{ id: "develop", name: "开发中", permission: "issue.edit", requiresReason: true }], people: [] };
  const asset = { id: "a", title: "测试资产", type: "note", environment: "test", category: "", tags: ["参考"], content: "内容", ownerId: "u", issueIds: ["i"], expiresAt: "2027-01-01T00:00:00Z", revision: 32, people: [{ id: "u", username: "product-member", displayName: "产品成员" }] };
  const permissions = ["asset.view", "asset.edit", "issue.view", "issue.edit", "collaboration.view", "comment.create", "deliverable.create", "session.start"];
  const source = `import {createApp,h,ref} from 'vue'; import {createRouter,createWebHistory} from 'vue-router';
import OperationMessages from '/src/shared/components/OperationMessages.vue'; import Discussion from '/src/features/projects/IssueDiscussion.vue'; import Settings from '/src/features/projects/ProjectSettings.vue'; import Detail from '/src/features/projects/IssueDetail.vue'; import Assets from '/src/features/projects/ProjectAssets.vue'; import '/src/shared/styles/style.css';
const router=createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:{render:()=>null}}]}); await router.push(location.pathname+location.search); await router.isReady();
const kind=new URLSearchParams(location.search).get('fixture'); const component={discussion:Discussion,settings:Settings,issue:Detail,assets:Assets}[kind];
const currentProject=ref(${JSON.stringify(project)}), permissions=ref(${JSON.stringify(permissions)});
createApp({render:()=>h('div',[h(OperationMessages),kind==='settings'?h('button',{onClick:()=>{currentProject.value={...currentProject.value,name:'父级刷新名称',revision:currentProject.value.revision+1}}},'模拟父级刷新'):null,kind==='discussion'?h('button',{onClick:()=>{permissions.value=permissions.value.includes('collaboration.view')?['issue.view']: ${JSON.stringify(permissions)}}},'切换讨论权限'):null,h(component,{project:currentProject.value,projectId:'p',issueId:'i',endpoint:'/projects/p/issues/i',permissions:permissions.value})])}).use(router).mount('#app');`;
  const server = await createServer({ configFile: false, root: path.resolve("web"), logLevel: "error", plugins: [vue(), { name: "editing-fixture", resolveId(id) { if (id === "virtual:editing") return "\0editing"; }, load(id) { if (id === "\0editing") return source; }, configureServer(server) { server.middlewares.use(async (req, res, next) => { if (!req.url.startsWith("/fixture")) return next(); res.setHeader("Content-Type", "text/html"); res.end(await server.transformIndexHtml(req.url, '<html><body><main id="app"></main><script type="module" src="/@id/virtual:editing"></script></body></html>')); }); } }], server: { host: "127.0.0.1", port: 0 } });
  let browser;
  try {
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = [], writes = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });

    let releaseComment, pendingComment;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), pathname = url.pathname;
      if (!pathname.startsWith("/api/")) return route.fallback();
      const input = route.request().postDataJSON();
      let response = { tasks: [], items: [], nextOffset: null, people: [] }, status = 200;
      if (route.request().method() === "POST") {
        writes.push({ pathname, input });
        if (pathname.endsWith("/comments")) { pendingComment = true; await new Promise(resolve => { releaseComment = resolve; }); response = {}; }
        else if (pathname === "/api/projects/p") { if (input.revision === 1) { status = 409; response = { error: "项目已修改" }; } else response = { project: { ...project, ...input, revision: 3 } }; }
        else if (pathname.endsWith("/issues/i")) { if (input.revision === 1) { status = 409; response = { error: "事项已修改" }; } else response = { ...issue, ...input, revision: 3 }; }
        else if (pathname.endsWith("/issues/i/transition")) response = { ...issue, status: "developing", statusName: "开发中", availableTransitions: [], revision: 3 };
      } else if (pathname.endsWith('/comments')) response = { items: [{ id: 'loaded', body: '已有评论缓存' }], people: [] };
      else if (pathname.endsWith("/members")) response = { members: [{ userId: "u", username: "product-member", displayName: "产品成员", status: "active", userStatus: "active" }] };
      else if (pathname === "/api/projects/p") response = { project: { ...project, name: "他人项目名称", description: "他人说明", revision: 2 } };
      else if (pathname.endsWith("/issues/i")) response = { ...issue, title: "他人事项标题", description: "他人描述", revision: 2 };
      else if (pathname.endsWith("/assets/a")) response = asset;
      else if (pathname.endsWith("/assets/a/history")) response = { items: [{ id: `h${url.searchParams.get("offset")}`, revision: url.searchParams.get("offset") === "30" ? 2 : 32, actorId: "u", createdAt: "2026-10-10", data: { title: "资产修订内容", hasSecret: true } }], nextOffset: url.searchParams.get("offset") === "30" ? null : 30, people: asset.people };
      else if (pathname.endsWith("/assets")) response = { items: [asset], nextOffset: null };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(response) });
    });
    const open = kind => page.goto(`${origin}/fixture?fixture=${kind}`);
    await open("discussion"); await page.getByLabel("评论内容").fill("评论草稿"); await page.getByRole("button", { name: "评论", exact: true }).click(); assert.equal(await page.getByLabel("评论内容").inputValue(), "评论草稿");
    await page.getByRole("button", { name: "交付结果", exact: true }).click(); await page.getByLabel("交付说明").fill("交付草稿"); await page.getByRole("button", { name: "变更历史" }).click(); await page.getByRole("button", { name: "评论", exact: true }).click(); assert.equal(await page.getByLabel("评论内容").inputValue(), "评论草稿");
    await page.getByRole("button", { name: "发表评论" }).click(); await page.waitForFunction(() => document.querySelector('button[type="submit"]').disabled); assert.ok(pendingComment); await page.getByLabel("评论内容").fill("提交后新增文字"); releaseComment(); await page.getByRole("button", { name: "发表评论", disabled: false }).waitFor(); assert.equal(await page.getByLabel("评论内容").inputValue(), "提交后新增文字");
    await page.getByRole("button", { name: "交付结果", exact: true }).click(); assert.equal(await page.getByLabel("交付说明").inputValue(), "交付草稿");
    let releaseDiscussion, discussionStarted;
    const pendingDiscussion = new Promise(resolve => { discussionStarted = resolve; });
    await page.route('**/api/projects/p/issues/i/comments?*', async route => { discussionStarted(); await new Promise(resolve => { releaseDiscussion = resolve; }); await route.fulfill({ json: { items: [{ id: 'late', body: '撤权前迟到的评论' }], people: [] } }); }, { times: 1 });
    await page.getByRole('button', { name: '评论', exact: true }).click(); await pendingDiscussion;
    await page.getByRole('button', { name: '切换讨论权限' }).click();
    releaseDiscussion();
    await page.getByText('暂无记录。', { exact: true }).waitFor();
    assert.equal(await page.getByText('撤权前迟到的评论', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('评论内容').count(), 0);
    await page.getByRole('button', { name: '切换讨论权限' }).click();
    await page.getByRole('button', { name: '评论', exact: true }).click(); assert.equal(await page.getByLabel('评论内容').inputValue(), '');
    await page.getByText('已有评论缓存', { exact: true }).waitFor();
    await page.getByLabel('评论内容').fill('撤权时待提交草稿');
    await page.getByRole('button', { name: '发表评论' }).click();
    await page.getByRole('button', { name: '发表评论', disabled: true }).waitFor();
    await page.getByRole('button', { name: '切换讨论权限' }).click();
    assert.equal(await page.getByText('已有评论缓存', { exact: true }).count(), 0);
    releaseComment();
    await page.getByText('暂无记录。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '切换讨论权限' }).click();
    await page.getByRole('button', { name: '交付结果', exact: true }).click(); assert.equal(await page.getByLabel('交付说明').inputValue(), '');
    await open("settings"); await page.getByRole("button", { name: "模拟父级刷新" }).click(); assert.equal(await page.getByLabel("项目名称", { exact: true }).inputValue(), "父级刷新名称"); await page.getByLabel("项目名称", { exact: true }).fill("待保留草稿"); await page.getByRole("button", { name: "模拟父级刷新" }).click(); await page.getByText(/服务器上的项目已更新/).waitFor(); assert.equal(await page.getByLabel("项目名称", { exact: true }).inputValue(), "待保留草稿");
    await open("settings"); await page.getByLabel("项目名称", { exact: true }).fill("我的项目名称"); await page.getByRole("button", { name: "保存项目设置" }).click(); await page.locator('.operation-message[data-type="error"]').filter({ hasText: "项目已修改" }).last().waitFor(); await page.getByRole("button", { name: "保留草稿，加载最新内容" }).click(); await page.getByLabel("项目名称冲突处理").selectOption("draft"); await page.getByRole("button", { name: "确认合并并继续编辑" }).click(); assert.equal(await page.getByLabel("说明", { exact: true }).inputValue(), "他人说明"); await page.getByRole("button", { name: "保存项目设置" }).click(); await page.locator('.operation-message[data-type="success"]').filter({ hasText: "已保存。" }).last().waitFor(); assert.equal(writes.at(-1).input.revision, 2); assert.equal(writes.at(-1).input.name, "我的项目名称");
    const count = writes.length; await page.getByLabel("清除已保存 Cookie").check(); await page.getByRole("button", { name: "保存项目设置" }).click(); await page.locator('.operation-message[data-type="error"]').filter({ hasText: /请填写 TAPD 项目 ID 后再修改/ }).last().waitFor(); assert.equal(writes.length, count);
    await open("issue");
    await page.getByRole("heading", { name: "他人事项标题", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "返回事项列表", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "刷新详情", exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "开发任务", exact: true }).count(), 0);
    await page.getByLabel("评论内容").fill("切换编辑时保留讨论草稿");
    await page.getByRole("button", { name: "编辑事项", exact: true }).click();
    await page.getByRole("button", { name: "取消编辑", exact: true }).click();
    assert.equal(await page.getByLabel("评论内容").inputValue(), "切换编辑时保留讨论草稿");
    assert.equal(await page.getByLabel("原因", { exact: true }).count(), 0);
    await page.getByLabel("目标状态", { exact: true }).selectOption("develop");
    assert.equal(await page.getByLabel("原因", { exact: true }).getAttribute("required"), "");
    await page.getByLabel("原因", { exact: true }).fill("开始实现已确认的需求");
    await page.getByRole("button", { name: "更新状态", exact: true }).click();
    await page.getByText("当前没有可用的状态操作。", { exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).input, { transitionId: "develop", reason: "开始实现已确认的需求", revision: 2 });
    assert.equal(writes.some(write => write.pathname.endsWith("/tasks")), false, "changing status never creates a development task");
    assert.equal(await page.getByLabel("评论内容").inputValue(), "切换编辑时保留讨论草稿");
    // Load revision one for the edit baseline, then the latest version for conflict recovery.
    let issueReads = 0;
    await page.route("**/api/projects/p/issues/i", async route => { if (route.request().method() === "POST") return route.fallback(); await route.fulfill({ json: issueReads++ ? { ...issue, title: "他人事项标题", description: "他人描述", revision: 2 } : issue }); });
    await open("issue"); await page.getByRole("button", { name: "编辑事项" }).click(); assert.equal(await page.getByRole("button", { name: "认领到开发任务", exact: true }).isDisabled(), true); await page.getByLabel("标题", { exact: true }).fill("我的事项标题"); await pasteImage(page); await verifyVisualWriting(page); const issueDraft = await markdownValue(page); await page.getByRole("button", { name: "保存事项", exact: true }).click(); await page.locator('.operation-message[data-type="error"]').filter({ hasText: "事项已修改" }).last().waitFor(); assert.equal(await markdownValue(page), issueDraft); assert.equal(writes.at(-1).input.attachments.length, 1); await page.getByRole("button", { name: "保留草稿，加载最新内容" }).click(); await page.getByLabel("标题冲突处理").selectOption("draft"); await page.getByLabel("描述冲突处理").selectOption("draft"); await page.getByRole("button", { name: "确认合并并继续编辑" }).click(); assert.equal(await markdownValue(page), issueDraft); const editorOutput = path.resolve("state/browser/project-editing"); fs.mkdirSync(editorOutput, { recursive: true }); await visual(page); await captureEditor(page, editorOutput, "issue-conflict"); await page.getByRole("button", { name: "保存事项", exact: true }).click(); await page.getByRole("heading", { name: "我的事项标题" }).waitFor(); assert.equal(writes.at(-1).input.revision, 2); assert.equal(writes.at(-1).input.attachments.length, 1);
    await page.goto(`${origin}/fixture?fixture=assets&tab=assets&asset=a&assetQuery=测试`); await page.getByRole("heading", { name: "测试资产", exact: true }).waitFor(); await page.getByText("负责人：产品成员", { exact: true }).waitFor(); assert.match(await page.getByRole("link", { name: /#1 他人事项标题/ }).getAttribute("href"), /tab=issues&issue=i/); await page.getByText("有效期：2027-01-01", { exact: true }).waitFor(); await page.reload(); await page.getByRole("heading", { name: "测试资产", exact: true }).waitFor(); await page.getByRole("button", { name: "修订历史", exact: true }).click(); await page.getByRole("button", { name: "更早修订" }).click(); await page.getByText("修订 2", { exact: true }).waitFor(); await page.getByRole("button", { name: "较新修订" }).click(); await page.getByText("修订 32", { exact: true }).waitFor();
    const output = path.resolve("state/browser/project-editing"); fs.mkdirSync(output, { recursive: true });
    for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `asset overflow at ${width}`); await page.screenshot({ path: path.join(output, `assets-${width}.png`), fullPage: true }); }
    await page.getByRole("button", { name: "编辑资产", exact: true }).click(); await page.getByRole("button", { name: "移除关联", exact: true }).waitFor(); assert.equal(await page.getByLabel("有效期（可选）").inputValue(), "2027-01-01"); await page.getByRole("button", { name: "移除关联", exact: true }).click(); await page.getByText("已关联 0 条事项。", { exact: true }).waitFor(); await page.getByRole("button", { name: "取消", exact: true }).click();
    let releaseAsset, assetStarted;
    let assetPending = new Promise(resolve => { assetStarted = resolve; });
    await page.route('**/api/projects/p/assets*', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const input = route.request().postDataJSON(); writes.push({ pathname: new URL(route.request().url()).pathname, input });
      assetStarted(); await new Promise(resolve => { releaseAsset = resolve; });
      Object.assign(asset, input, { revision: asset.revision + 1 });
      await route.fulfill({ json: asset });
    });
    await page.route('**/api/projects/p/assets/a', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const input = route.request().postDataJSON(); writes.push({ pathname: new URL(route.request().url()).pathname, input });
      assetStarted(); await new Promise(resolve => { releaseAsset = resolve; });
      Object.assign(asset, input, { revision: asset.revision + 1 }); await route.fulfill({ json: asset });
    });
    await page.getByRole('button', { name: '编辑资产', exact: true }).click();
    await page.getByRole('button', { name: '保存资产', disabled: false }).waitFor();
    await page.getByLabel('内容', { exact: true }).fill('本次提交内容');
    await page.getByRole('button', { name: '保存资产' }).click(); await assetPending;
    await page.getByLabel('内容', { exact: true }).fill('等待保存期间的新草稿'); releaseAsset();
    await page.getByRole('button', { name: '保存资产', disabled: false }).waitFor();
    assert.equal(await page.getByLabel('内容', { exact: true }).inputValue(), '等待保存期间的新草稿');
    assetPending = new Promise(resolve => { assetStarted = resolve; });
    await page.getByRole('button', { name: '保存资产' }).click(); await assetPending;
    assert.equal(writes.at(-1).input.revision, 33); releaseAsset();
    await page.getByRole('button', { name: '编辑资产', exact: true }).waitFor();
    await page.getByRole("button", { name: "返回资产列表" }).click(); await page.getByRole("textbox", { name: "搜索资产" }).waitFor(); assert.equal(await page.getByRole("textbox", { name: "搜索资产" }).inputValue(), "测试"); assert.ok(!new URL(page.url()).searchParams.has("asset"));
    await page.getByRole('button', { name: '新增资产' }).click();
    await page.getByRole('button', { name: '保存资产', disabled: false }).waitFor();
    await page.getByLabel('标题', { exact: true }).fill('新建资产');
    assetPending = new Promise(resolve => { assetStarted = resolve; });
    await page.getByRole('button', { name: '保存资产' }).click(); await assetPending;
    await page.getByLabel('内容', { exact: true }).fill('新建成功之前继续输入'); releaseAsset();
    await page.waitForURL('**asset=a'); await page.getByRole('button', { name: '保存资产', disabled: false }).waitFor();
    assert.equal(await page.getByLabel('内容', { exact: true }).inputValue(), '新建成功之前继续输入');
    assetPending = new Promise(resolve => { assetStarted = resolve; });
    await page.getByRole('button', { name: '保存资产' }).click(); await assetPending;
    assert.ok(writes.at(-1).pathname.endsWith('/assets/a')); releaseAsset();
    await page.getByRole('button', { name: '编辑资产', exact: true }).waitFor();
    assert.deepEqual(errors, []); console.log("Project editing fake-API browser checks passed.");
  } finally { await browser?.close(); await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
