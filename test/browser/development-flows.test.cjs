const { selectOption, selectOptions } = require("../support/select.cjs");
const { openSessionList } = require("../support/browser-navigation.cjs");
/* global window, document */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { agentDescriptor } = require('../fixtures/agent-descriptor.cjs');
const { projectVisual } = require('../../test/fixtures/project-visual.cjs');
const { verifyReleaseNameForm } = require('./project-releases.test.cjs');
const { verifyWorkflowCanvas } = require('./workflow-canvas.test.cjs');
const { verifyDevelopmentTaskDetail } = require('./development-task-detail.test.cjs');
const { verifyManualDevelopment } = require('./manual-development.test.cjs');

async function main() {
  const fixture = projectVisual('ux-workspace');
  const projectPath = `/projects/${fixture.projectId}`;
  const origin = 'http://127.0.0.1:49019';
  const output = path.resolve(__dirname, '../../state/browser/development-flows');
  fs.mkdirSync(output, { recursive: true });
  const dist = path.resolve(__dirname, '../../web/dist');
  const requests = [], errors = [];
  let runs = [], taskStatus = 'running';
  const browser = await chromium.launch({ ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  try {
    const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1000 }, hasTouch: true });
    await page.addInitScript(() => {
      window.EventSource = class {
        constructor() { this.timer = setTimeout(() => this.onopen?.({}), 0); }
        addEventListener() {}
        close() { clearTimeout(this.timer); }
      };
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
      if (endpoint.startsWith('/api/')) {
        requests.push({ endpoint, method: request.method(), input: request.postDataJSON() });
        const send = (json, status = 200) => route.fulfill({ status, json });
        if (endpoint === '/api/auth/session') return send({ user: { id:'visual-admin', username:'visual-admin', displayName: '交互审查夹具', role:'admin', status:'active', mustChangePassword:false }, token:'fixture', settings:{ permissionMode:'ask', notificationsEnabled:false } });
        if (endpoint === '/api/bootstrap') return send({token:'fixture',workspaces:[{id:'ux-workspace',name:'交互审查空间',projectId:fixture.projectId,permissions:fixture.permissions}]});
        if (endpoint.endsWith('/events')) return route.fulfill({ status:204, body:'' });
        if (endpoint.endsWith('/account/preferences')) return send({preferences:{unreadRunKeys:[]}});
        if (endpoint === '/api/account/git-accounts') return send({accounts:[]});
        if (endpoint === `/api${projectPath}`) {
          if (request.method() === 'POST') return send({error:'资料已变更，请刷新后重试。'},409);
          const result=fixture.response(url);return send(result);
        }
        if (endpoint.startsWith(`/api${projectPath}/`) && (endpoint.endsWith('/tasks') || endpoint.endsWith('/tasks/search-task'))) {
          const result=fixture.response(url);
          if(result.task)result.task.execution.status=taskStatus;else for(const task of result.tasks)task.execution.status=taskStatus;
          if (result.tasks) result.nextOffset = url.searchParams.get('offset') === '30' ? null : 30;
          return send(result);
        }
        const result=fixture.response(url);if(result)return send(result);
        const scoped=endpoint.replace('/api/workspaces/ux-workspace','');
        if(scoped==='/bootstrap')return send({token:'fixture',channels:[{id:'manual',label:'手动输入',capabilities:{manualInput:true}}]});
        if(scoped==='/runs')return send({runs});
        if(scoped==='/runs/archived-task-b')return send({key:'archived-task-b',title:'指定的归档任务 B',status:'completed',archivedAt:'2026-10-10T00:00:00Z',readOnlyReason:'会话已归档，只能查看历史。',source:{channel:'manual'},agent:agentDescriptor,sessionId:'archived-session',items:[],requests:[],executionSettings:{model:'',reasoningEffort:'',permissionMode:'ask'},nextCursor:null});
        if(scoped==='/runs/1-1')return send({key:'1-1',title:'不应被替代打开的任务 A',status:'completed',source:{channel:'manual',scope:'fixture',id:'one'},agent:agentDescriptor,sessionId:'fixture-session',items:[],requests:[],pendingRequests:[],execution:{status:'completed'},executionSettings:{model:'',reasoningEffort:'',permissionMode:'ask'},nextCursor:null});
        if(scoped==='/runs/2-2')return send({key:'2-2',title:'侧栏切换任务 B',status:'completed',source:{channel:'manual'},agent:agentDescriptor,sessionId:'fixture-session-b',items:[],requests:[],executionSettings:{model:'',reasoningEffort:'',permissionMode:'ask'},nextCursor:null});
        if(scoped==='/settings')return send({repository:'C:/fixture/repository',worktreeRoot:'C:/fixture/worktree',baseBranch:'main',initCommands:[],platform:'win32'});
        if(scoped==='/settings/branches')return send({branches:[{value:'main',label:'main'}]});
        if(scoped==='/models')return send({models:[]});
        if(scoped==='/execution-options')return send({agent:agentDescriptor,permissionModes:require('../../shared/agent-permissions.json').map(mode=>({...mode,available:true}))});
        if(scoped==='/settings/tapd'||scoped==='/settings/prompts')return send({error:'当前账号没有此项目操作权限。'},403);
        return send({error:'Fixture does not implement '+endpoint},404);
      }
      if(endpoint.startsWith('/assets/')){
        const file=path.resolve(dist,'.'+endpoint);assert.ok(file.startsWith(dist+path.sep));
        return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':'text/css'});
      }
      return route.fulfill({body:fs.readFileSync(path.join(dist,'index.html')),contentType:'text/html'});
    });

    await require('./merge-development-dialog.test.cjs').verifyMergeDevelopmentDialog({ page, origin, fixture, output });
    const projectName = fixture.response(new URL(origin + '/api/projects')).projects[0].name;
    await page.goto(origin + '/development');
    assert.equal(await page.getByRole('button', { name: '项目全部任务', exact: true }).isDisabled(), true, 'all project tasks requires a specific top-navigation project');
    await selectOption(page.getByRole('combobox', { name: '当前项目', exact: true }), fixture.projectId);
    await page.getByRole('link', { name: '项目全部任务', exact: true }).click();
    await page.waitForURL(url => url.pathname === projectPath && url.searchParams.get('taskScope') === 'all');
    await page.getByRole('button', { name: '项目全部任务', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'the top-navigation project does not require another chooser');
    await page.goto(origin + '/development');
    await page.getByRole('button', { name: '查看已归档会话', exact: true }).click();
    let chooser = page.getByRole('dialog', { name: '选择要查看已归档会话的项目', exact: true });
    await chooser.getByRole('button').filter({ hasText: projectName }).click();
    const archived = page.getByRole('dialog', { name: '已归档会话', exact: true });
    await archived.getByText('暂无已归档会话。', { exact: true }).waitFor();
    assert.ok(requests.some(request => request.endpoint === '/api/workspaces/ux-workspace/runs'), 'history uses the selected personal workspace');
    await page.keyboard.press('Escape');
    await archived.waitFor({ state: 'hidden' });
    await page.goto(origin + '/development');
    await page.getByRole('button', { name: '独立开发', exact: true }).click();
    chooser = page.getByRole('dialog', { name: '选择独立开发项目', exact: true });
    await chooser.getByRole('button').filter({ hasText: projectName }).click();
    await page.getByRole('heading', { name: '独立开发', exact: true }).waitFor();
    assert.equal(requests.filter(request => request.method === 'POST' && (request.endpoint.endsWith('/start') || request.endpoint.endsWith('/manual-development'))).length, 0, 'development shortcuts only open existing views');
    await page.goto(origin + projectPath + '?tab=releases');
    await page.getByRole('button', { name: '新建版本', exact: true }).click();
    await verifyReleaseNameForm({ page, output, endpoint: origin + '/api' + projectPath + '/releases' });
    await page.getByRole('button', { name: '取消', exact: true }).click();

    const pendingProject = async route => {
      const result = fixture.response(new URL(route.request().url()));
      return route.fulfill({ json: { ...result, project: { ...result.project, remoteUrl: 'https://gitee.com/fixture/customer.git' }, space: { status: 'awaiting_credentials' } } });
    };
    const fixtureAccounts = async route => route.fulfill({ json: { accounts: [
      { id: 'fixture-ssh', name: '演示 Gitee SSH', host: 'gitee.com', authType: 'ssh' },
      { id: 'fixture-http', name: '演示 Gitee HTTPS', host: 'https://gitee.com', authType: 'http' },
    ] } });
    await page.route(`**/api${projectPath}`, pendingProject);
    await page.route('**/api/account/git-accounts', fixtureAccounts);
    await page.goto(origin+projectPath+'?tab=development');
    const gitAccounts = page.getByRole('combobox', { name: '个人 Git 账号', exact: true });
    assert.deepEqual((await selectOptions(gitAccounts)).map(option => option.label), [
      '选择 Git 账号', '演示 Gitee SSH · gitee.com · SSH 密钥', '演示 Gitee HTTPS · https://gitee.com · HTTP/HTTPS 凭据',
    ]);
    await page.getByText('使用此账号验证仓库访问并下载项目代码。', { exact: true }).waitFor();
    const prepare = page.getByRole('button', { name: '创建工作空间', exact: true });
    assert.equal(await prepare.isDisabled(), true);
    await selectOption(gitAccounts, 'fixture-ssh');
    assert.equal(await prepare.isEnabled(), true);
    for (const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({path:path.join(output,`git-account-choice-${width}.png`),fullPage:true});
    }
    assert.equal(requests.some(request => request.endpoint.endsWith('/space/prepare')), false, 'selecting a Git account cannot prepare a repository');
    await page.unroute(`**/api${projectPath}`, pendingProject);
    await page.unroute('**/api/account/git-accounts', fixtureAccounts);
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(origin+projectPath+'?tab=tasks');
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.get('taskOffset'),'30');
    await page.getByRole('button',{name:"客户搜索与空结果提示",exact:true}).click();
    await page.getByRole('heading',{name:'客户搜索与空结果提示',exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('task'), 'search-task');
    await page.reload();
    await page.getByRole('heading',{name:'客户搜索与空结果提示',exact:true}).waitFor();
    await page.getByRole('button', { name: '追加关联事项', exact: true }).click();
    await page.getByLabel('搜索追加事项').fill('保留搜索');
    await page.getByRole('button',{name:'搜索事项',exact:true}).click();
    await page.locator('.permission-choice input').first().check();
    taskStatus='completed';
    let releaseDetail;
    const heldDetail = new Promise(resolve => { releaseDetail = resolve; });
    await page.route('**/tasks/search-task', async route => {
      await heldDetail;
      await route.fallback();
    }, { times: 1 });
    const detailResponse=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/tasks/search-task'));
    await page.getByRole('button',{name:'刷新状态',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'保存追加资料（暂不发送）',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'发送资料并继续 Codex',exact:true}).isDisabled(),true);
    releaseDetail();
    await detailResponse;
    await page.getByText('Codex：本轮结束',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('搜索追加事项').inputValue(), '保留搜索');
    assert.equal(await page.locator('.permission-choice input').first().isChecked(),true);
    await page.getByRole('button',{name:'返回任务列表',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.has('task'), false);
    assert.equal(new URL(page.url()).searchParams.get('taskOffset'),'30');
    assert.equal(await page.getByRole('button',{name:'上一页',exact:true}).count(),1);
    await page.goBack();
    await page.getByRole('heading',{name:'客户搜索与空结果提示',exact:true}).waitFor();
    await page.goto(origin+'/?workspace=ux-workspace');
    await page.getByRole('heading',{name:'尚无开发任务',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:/工作区设置/}).count(),0);
    for (const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:900});
      await page.screenshot({path:path.join(output,`empty-${width}.png`),fullPage:true});
    }
    runs=[{key:'1-1',title:'不应被替代打开的任务 A',status:'completed'}];
    for (const key of ['missing-task-b']) {
      await page.goto(origin+'/?workspace=ux-workspace&task='+key);
      await page.getByRole('heading',{name:'指定会话暂时无法打开',exact:true}).waitFor();
      assert.equal(await page.locator('.session-composer').count(),0);
      assert.ok(requests.some(r=>r.endpoint.endsWith('/runs/'+key)));
      assert.equal(requests.filter(r=>r.endpoint.endsWith('/runs/1-1')).length,0);
    }
    await page.goto(origin+'/?workspace=ux-workspace&task=archived-task-b');
    await page.getByRole('heading',{name:'指定的归档任务 B',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.endpoint.endsWith('/runs/1-1')).length,0);
    await page.getByText('会话已归档，只能查看历史。',{exact:true}).first().waitFor();
    runs.push({key:'2-2',title:'侧栏切换任务 B',status:'completed'});
    await page.goto(origin+'/?workspace=ux-workspace&task=1-1');
    await page.getByRole('heading',{name:'不应被替代打开的任务 A',exact:true}).waitFor();
    const bootstrapCount = requests.filter(r => r.endpoint.endsWith('/bootstrap')).length;
    await openSessionList(page);
    await page.getByRole('navigation',{name:'会话列表'}).getByRole('button',{name:/侧栏切换任务 B/}).click();
    await page.getByRole('heading',{name:'侧栏切换任务 B',exact:true}).waitFor();
    await page.waitForURL('**task=2-2');
    assert.equal(requests.filter(r => r.endpoint.endsWith('/bootstrap')).length, bootstrapCount, 'task URL changes must not remount the workspace');
    assert.equal(requests.filter(r => r.endpoint.endsWith('/runs/2-2')).length, 1, 'URL synchronization must not reopen the selected task');
    const composer = page.locator('.session-composer textarea');
    await composer.fill('URL 同步后保留的草稿');
    // Reading the URL must not remount the console or issue another open.
    assert.equal(await composer.inputValue(), 'URL 同步后保留的草稿');
    await page.goBack();
    await page.getByRole('heading',{name:'不应被替代打开的任务 A',exact:true}).waitFor();
    await page.goForward();
    await page.getByRole('heading',{name:'侧栏切换任务 B',exact:true}).waitFor();
    await page.reload();
    await page.getByRole('heading',{name:'侧栏切换任务 B',exact:true}).waitFor();
    let releaseInitialTask, initialTaskStarted;
    const initialTaskPending = new Promise(resolve => { initialTaskStarted = resolve; });
    await page.route('**/api/workspaces/ux-workspace/runs/2-2', async route => {
      initialTaskStarted(); await new Promise(resolve => { releaseInitialTask = resolve; }); await route.fallback();
    }, { times: 1 });
    await page.reload(); await initialTaskPending;
    await page.goBack(); await page.waitForURL('**task=1-1');
    releaseInitialTask();
    await page.getByRole('heading',{name:'不应被替代打开的任务 A',exact:true}).waitFor();
    await verifyManualDevelopment({ page, origin, projectId: fixture.projectId, output });
    await require("./independent-delivery.test.cjs").verifyIndependentDelivery({ page, origin, projectId: fixture.projectId, output });
    await verifyWorkflowCanvas({ page, origin, output });
    await verifyDevelopmentTaskDetail({ browser, output });
    await require("./development-archive.test.cjs").verifyDevelopmentArchive({ page, origin, projectId: fixture.projectId, output });
    await require("./project-space-progress.test.cjs").verifyProjectSpaceProgress({ browser, output });
    assert.deepEqual(errors,[]);
    process.stdout.write('Development flow regression passed.\n');
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
