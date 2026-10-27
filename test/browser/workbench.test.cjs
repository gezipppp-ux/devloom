const { selectOption, selectPreference } = require("../support/select.cjs");
/* global document, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectVisual } = require('../fixtures/project-visual.cjs');

async function verifyWorkbench(browser) {
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const fixture = projectVisual('neutral-workspace'), projectId = fixture.projectId;
  const origin = 'http://127.0.0.1:49025', base = `/api/projects/${projectId}`;
  const output = path.resolve('state/browser/workbench'); fs.mkdirSync(output, {recursive:true});
  const project = fixture.response(new URL(origin + '/api/projects')).projects[0];
  const issue = { ...fixture.response(new URL(origin + base + '/issues/search')), dueDate: '2026-10-20', tags: ['体验', 'MVP'], deliverySubmission: { allowed: true, label: '提交配置成果' }, workflowActions: [{ trigger: 'delivery.submitted', name: '提交配置成果', allowed: true, statusName: '待验证' }, { trigger: 'verification.started', name: '开始质检', allowed: true, statusName: '验证中' }, { trigger: 'verification.accepted', name: '确认质检通过', allowed: true, statusName: '已实现' }, { trigger: 'verification.returned', name: '退回补充', allowed: true, statusName: '待返工' }] };
  let delivery = { id: 'delivery-1', projectId, issueId: issue.id, title: '客户搜索交付', body: '功能说明与验证记录', status: 'pending', revision: 1, checklist: ['搜索结果符合筛选条件', '移动端可完成操作'], checkedItems: [], authorId: 'visual-admin', reviewerId: 'visual-admin', commit: 'abc123', createdAt: '2026-10-14T08:00:00Z' };
  let resubmitted;
  const requests = [], errors = [];
  let reviewForbidden = false, executionStatus = 'running';
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    if (endpoint.startsWith('/api/')) {
      const input = request.method() === 'POST' ? request.postDataJSON() : null;
      requests.push({endpoint, search:url.search, input});
      const send = (json,status=200)=>route.fulfill({status,json});
      if (endpoint === '/api/auth/session') return send({ user: {id:'visual-admin',username:'preview',displayName:'演示成员',role:'admin',status:'active',mustChangePassword:false}, token:'fixture', settings:{} });
      if (endpoint === '/api/bootstrap') return send({token:'fixture',workspaces:[]});
      if (endpoint === '/api/account/models') return send({ models: [] });
      if (endpoint === '/api/account/execution-options') return send({ permissionModes: require('../../shared/agent-permissions.json').map(mode => ({ ...mode, available: true })), agent: { label: 'Codex' } });
      if (endpoint === '/api/account/preferences') return send({ preferences: { unreadRunKeys: [] } });
      if (endpoint === '/api/account/git-accounts') return send({ accounts: [{ id: 'git-fixture', name: '工作 Git', authType: 'http', host: 'https://git.example.test', username: 'preview', authorName: '演示成员', authorEmail: 'preview@example.test', revision: 1 }] });
      if (endpoint === '/api/account/mcp-tokens') return send({ tokens: [{ id: 'token-fixture', name: '本机助手', prefix: 'wc_mcp_fixture', status: 'active', allProjects: true, projectIds: [], scopes: ['read'], expiresAt: '2027-01-01T00:00:00Z', lastUsedAt: null }], scopes: require('../../shared/mcp-scopes.json'), projects: [{ id: projectId, name: project.name }] });
      if (endpoint === '/api/system/settings') return send({ memberStorageRoot: 'D:/Workspace', platform: 'win32', git: { installed: true, version: '2.47.0' } });
      if (['/api/workbench/attention', '/api/workbench/recent-projects', '/api/workbench/actions'].includes(endpoint)) return send(fixture.response(url));
      if (endpoint.startsWith('/api/workbench/')) {
        const kind=endpoint.split('/').at(-1);
        if (kind === 'tasks') {
          const task = fixture.response(new URL(origin + base + '/tasks/search-task')).task;
          const items = [
            { ...task, id: 'task-1', title: '统一搜索与项目筛选', status: 'planned', execution: null, canMerge: true, canOpenSession: false, runKey: null, issueIds: ['search'] },
            { ...task, id: 'task-2', title: '登录与首次使用体验优化', status: 'started', execution: { status: executionStatus }, canMerge: false, issueIds: ['search'] },
            { ...task, id: 'task-3', title: '修复移动端菜单遮挡', status: 'completed', execution: { status: 'completed' }, canMerge: false, issueIds: ['search'] },
            { ...task, id: 'task-4', title: '资产类型与目录整理', status: 'planned', execution: null, canMerge: true, canOpenSession: false, runKey: null, issueIds: ['export'] },
            { ...task, id: 'task-5', title: '完善项目成员权限与长标题的窄屏展示，保留现有流程和操作入口', status: 'started', execution: { status: 'failed' }, canMerge: false, issueIds: ['search'] },
            { ...task, id: 'task-6', title: '确认发布准备结果', status: 'unknown', execution: null, canMerge: false, issueIds: ['search'] },
            { ...task, id: 'task-7', title: '合并资料准备', status: 'merged', execution: null, canMerge: false, canOpenSession: false, runKey: null, issueIds: ['export'] },
            { ...task, id: 'task-8', title: '已取消的开发计划', status: 'cancelled', execution: null, canMerge: false, canOpenSession: false, runKey: null, issueIds: ['export'] },
          ].map(item => ({ ...item, projectId, projectName: project.name, kind: 'issues', releaseName: 'v0.2' })).filter(item => !url.searchParams.get('status') || url.searchParams.get('status') === 'not_cancelled' ? item.status !== 'cancelled' : url.searchParams.get('status') === 'all' || item.status === url.searchParams.get('status'));
          return send({ items, people: [], total: items.length, nextOffset: null });
        }
        const row={ ...issue, projectId, projectName:project.name, releaseName:'v0.2', ...(kind==='deliveries'?{...delivery}:{} ) };
        return send({items:[row],people:issue.people,total:1,nextOffset:null});
      }
      if (endpoint === base + '/issues') {
        const second=url.searchParams.get('offset')==='30';
        return send({items:[second ? {...issue,id:'issue-31',number:31,title:'第二页的事项'} : issue],nextOffset:second?null:30});
      }
      if (endpoint.startsWith(base + '/issues/') && !input) return send({ ...issue, id: endpoint.split('/').at(-1) });
      if (endpoint.endsWith('/deliveries') && input) { assert.equal(endpoint,base+'/deliveries'); if (input.supersedesId) { resubmitted = { ...delivery, ...input, id: 'delivery-2', status: 'pending', revision: 1, checkedItems: [], reviewedAt: null }; return send(resubmitted); } return send({...delivery,id:'delivery-1',...input}); }
      if (endpoint === base + '/deliveries/delivery-2') return send({delivery:resubmitted,issue,canReview:true,permissions:fixture.permissions,people:issue.people});
      if (endpoint === base + '/deliveries/delivery-1') return send({delivery,issue,canReview:true,canResubmit:delivery.status === 'returned',permissions:fixture.permissions,people:issue.people});
      if (endpoint === base + '/deliveries/delivery-1/start') { delivery = { ...delivery, verificationStartedAt: '2026-10-14T09:00:00Z', revision: delivery.revision + 1 }; return send(delivery); }
      if (endpoint === base + '/deliveries/delivery-1/review') {
        if (reviewForbidden) return send({error:'Review permission revoked'},403);
        delivery={...delivery,...input,revision:delivery.revision+1,reviewedById:'visual-admin',reviewedAt:'2026-10-14T09:00:00Z'};return send({delivery});
      }
      const result=fixture.response(url); return result ? send(result) : send({error:'Unexpected fixture API: '+endpoint},404);
    }
    const dist=path.resolve('web/dist'), file=endpoint.startsWith('/assets/')?path.resolve(dist,'.'+endpoint):path.join(dist,'index.html');
    assert.ok(file.startsWith(dist+path.sep));
    return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  try {
    await require('./relative-time.test.cjs').verifyRelativeTime(page, origin, projectId);
    await page.goto(origin);
    await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
    await page.locator('.work-action').first().waitFor();
    await page.locator('.ui-home-section').first().getByRole('link', { name: /查看全部/ }).click();
    await page.waitForURL(url => url.pathname === '/work' && url.searchParams.get('bucket') === 'todo');
    await page.locator('.work-action').first().waitFor();
    assert.equal(await page.locator('.work-action').count(), 1, 'home and full queue keep the same action scope');
    await page.goto(origin + '/development?status=all');
    const taskRow = title => page.locator('.development-data-table tbody tr').filter({ has: page.getByRole('button', { name: title, exact: true }) });
    const runningRow = taskRow('登录与首次使用体验优化');
    await runningRow.getByText('执行中', { exact: true }).waitFor();
    const taskColors = await page.locator('.development-data-table tbody tr td[data-label="任务状态"] .ui-badge').evaluateAll(elements => elements.map(element => window.getComputedStyle(element).color));
    assert.equal(new Set(taskColors).size, 6, 'all six task states have distinct colors');
    const executionColors = [];
    for (const label of ['未启动', '执行中', '本轮结束', '执行失败', '状态待确认']) {
      executionColors.push(await page.locator('.work-execution-status .ui-badge').getByText(label, { exact: true }).first().evaluate(element => window.getComputedStyle(element).color));
    }
    assert.equal(new Set(executionColors).size, 5, 'Agent state colors distinguish idle, running, finished, failed and uncertain');
    await taskRow('统一搜索与项目筛选').getByRole('checkbox').check();
    executionStatus = 'completed';
    await page.clock.fastForward(5000);
    await runningRow.getByText('本轮结束', { exact: true }).waitFor();
    assert.equal(await runningRow.getByText('已启动', { exact: true }).count(), 1);
    assert.equal(await taskRow('统一搜索与项目筛选').getByRole('checkbox').isChecked(), true, 'polling preserves task selection');
    executionStatus = 'running';
    for(const locale of ['zh-CN','en']) {
      await selectPreference(page, "locale", locale);
      for(const [name, location, ready] of [
        ['home', '/', '.work-action'], ['action-queue', '/work?bucket=verify', '.work-action'], ['projects', '/projects', '.project-card'],
        ['overview', `/projects/${projectId}`, '.project-overview-grid'],
        ['issues', '/issues', '.ui-data-table'], ['development', '/development', '.ui-data-table'],
        ['deliveries', '/deliveries', '.ui-data-table'], ['personal', '/personal', '.ui-profile-settings form'],
        ['administration', '/accounts', '.account-list-row'],
        ['prompts', `/projects/${projectId}?tab=prompts`, '.prompt-placeholders'],
        ['project-settings', `/projects/${projectId}?tab=settings`, '.project-config-actions'],
        ['personal-git', '/personal?tab=git', '.git-saved-accounts'],
        ['personal-mcp', '/personal?tab=mcp', '.mcp-token'],
        ['system-workflows', '/system?tab=workflows', '.workflow-node'],
        ['system-storage', '/system', '.storage-directory-preview'],
      ]) {
        await page.goto(origin + location);
        await page.locator(ready).first().waitFor();
        if (name === 'personal-git') await page.getByRole('button', { name: locale === 'en' ? 'Edit Git account: 工作 Git' : '编辑 Git 账号：工作 Git', exact: true }).click();
        for(const [width,height] of [[2560,1440],[1920,1080],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
          await page.setViewportSize({width,height});
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${locale} ${name} overflow at ${width}`);
          if (name === 'development') assert.ok(await page.locator('.development-data-table').evaluate(table => {
            const right = table.getBoundingClientRect().right;
            return [...table.querySelectorAll('.ui-table-action button')].every(button => button.getBoundingClientRect().right <= right);
          }), `${locale} development actions must not be clipped at ${width}`);
          await page.screenshot({path:path.join(output,`${name}-${locale}-${width}.png`),fullPage:true});
          if (locale === 'zh-CN' && [1920, 390].includes(width)) {
            await selectPreference(page, "theme", 'dark');
            await page.screenshot({path:path.join(output,`${name}-dark-${width}.png`),fullPage:true});
            await selectPreference(page, "theme", 'light');
          }
          if (name === 'administration') {
            const management = page.locator('.ui-account-manage').last();
            const trigger = management.locator('summary');
            await trigger.click();
            const menu = management.locator('.account-row-actions:popover-open');
            await menu.waitFor();
            const bounds = await menu.boundingBox();
            assert.ok(bounds.x >= 15 && bounds.x + bounds.width <= width - 15 && bounds.y >= 15 && bounds.y + bounds.height <= height - (width < 768 ? 79 : 15), `${locale} account actions stay within the viewport at ${width}`);
            assert.equal(await page.locator('.account-page-view').evaluate(el => window.getComputedStyle(el).overflowY), 'visible', 'settings use normal page scrolling without a clipping container');
            await page.screenshot({path:path.join(output,`administration-menu-${locale}-${width}.png`)});
            await page.keyboard.press('Escape');
            await menu.waitFor({state:'hidden'});
            assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Escape returns focus to the account action trigger');
          }
        }
      }
    }
    const enteredProject = () => page.waitForURL(url => url.pathname === `/projects/${projectId}` && url.searchParams.get('tab') === 'overview');
    for (const [width, height] of [[1920, 1080], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(origin + '/projects');
      await page.locator('.project-entry-card').first().click({ position: { x: 12, y: 12 } });
      await enteredProject();
      await page.locator('.project-overview-grid').waitFor();
    }
    await page.setViewportSize({width:1920,height:1080});
    await page.goto(origin + '/projects');
    const projectTitle = page.getByRole('button', { name: project.name, exact: true });
    await projectTitle.focus();
    await projectTitle.press('Enter');
    await enteredProject();
    await page.goto(origin + '/projects');
    await page.locator('.project-entry-card').first().getByRole('button', { name: `Open project ${project.name}`, exact: true }).click();
    await enteredProject();
    await page.goto(origin + '/development');
    await selectOption(page.getByLabel('Task status', { exact: true }), 'started');
    await page.waitForURL('**status=started**');
    await page.locator('.ui-data-table').waitFor();
    assert.ok(requests.some(request => request.endpoint === '/api/workbench/tasks' && new URLSearchParams(request.search).get('status') === 'started'));
    await page.goto(origin);
    await page.getByRole('button',{name:'Search everything',exact:true}).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('搜索');
    await page.getByRole('dialog').getByText('客户搜索交付',{exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.goto(origin+`/deliveries?projectId=${projectId}`);
    await page.getByRole('button',{name:'Publish delivery',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Next',exact:true}).click();
    await selectOption(dialog.getByLabel('Related issue',{exact:true}), 'issue-31');
    await dialog.getByLabel('Delivery notes',{exact:true}).fill('发布内容保留原文 @ {name}');
    await selectOption(dialog.getByLabel('Delivery reviewer',{exact:true}), 'visual-admin');
    const publish=dialog.getByRole('button',{name:'提交配置成果',exact:true});
    assert.equal(await publish.isEnabled(),false,'sharing requires explicit confirmation');
    await dialog.getByRole('checkbox').check();
    await publish.click();
    await page.getByRole('heading',{name:'Acceptance checklist',exact:true}).waitFor();
    const accept=page.getByRole('button',{name:'确认质检通过',exact:true});
    assert.equal(await accept.isEnabled(),false);
    await page.getByRole('checkbox').nth(0).check();
    assert.equal(await accept.isEnabled(),false);
    await page.getByRole('checkbox').nth(1).check();
    await page.getByLabel('Review notes',{exact:true}).fill('核对完成');
    await accept.click();
    await page.getByRole('heading',{name:'Review record',exact:true}).waitFor();
    const review=requests.find(r=>r.endpoint.endsWith('/review'));
    assert.deepEqual(review.input,{revision:1,status:'accepted',checkedItems:[0,1],reviewNote:'核对完成'});
    assert.equal(requests.some(r=>r.input&&(r.endpoint.endsWith('/start')||r.endpoint.endsWith('/transition'))),false,'review sends a single verdict; the server owns the configured issue handoff');
    delivery={...delivery,status:'pending',reviewedAt:null,checkedItems:[],reviewNote:'',revision:3};
    reviewForbidden=true;
    await page.reload();
    await page.getByLabel('Review notes',{exact:true}).fill('draft before access loss');
    await page.getByRole('checkbox').nth(0).check();
    await page.getByRole('checkbox').nth(1).check();
    await accept.click();
    await page.getByRole('button',{name:'Reload',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Review notes',{exact:true}).count(),0,'denied review clears restricted details');
    reviewForbidden=false;
    await page.getByRole('button',{name:'Reload',exact:true}).click();
    await page.getByLabel('Review notes',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Review notes',{exact:true}).inputValue(),'','access recovery cannot resurrect a revoked draft');
    assert.equal(await page.getByRole('checkbox').nth(0).isChecked(),false);
    await page.getByRole('button', { name: '开始质检', exact: true }).click();
    await page.getByText('Review progress：Review in progress', { exact: true }).waitFor();
    await page.getByLabel('Review notes', { exact: true }).fill('请补充移动端验证证据');
    await page.getByRole('button', { name: '退回补充', exact: true }).click();
    await page.getByRole('button', { name: '提交配置成果', exact: true }).click();
    const revisionDialog = page.getByRole('dialog');
    await revisionDialog.getByLabel('Delivery notes', { exact: true }).fill('已补充移动端验证证据');
    await revisionDialog.getByRole('checkbox').check();
    await revisionDialog.getByRole('button', { name: '提交配置成果', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('delivery') === 'delivery-2');
    assert.equal(resubmitted.supersedesId, 'delivery-1');
    assert.equal(resubmitted.reviewerId, 'visual-admin');
    assert.equal(resubmitted.previousRevision, delivery.revision);
    await page.getByRole('link', { name: 'View original delivery', exact: true }).waitFor();
    assert.deepEqual(errors,[]);
    console.log('Workbench browser checks passed: fourteen bilingual surfaces at seven viewports, whole-card and keyboard project entry, task filtering, search, paged issue selection, explicit sharing and complete acceptance checks.');
  } catch(error) { await page.screenshot({path:'state/browser/ui-refactor/workbench-failure.png'}); console.error(await page.locator('body').innerText()); throw error; } finally {await context.close();}
}
module.exports={verifyWorkbench};
