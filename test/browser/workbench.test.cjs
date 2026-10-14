/* global document, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectVisual } = require('../fixtures/project-visual.cjs');

async function verifyWorkbench(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const fixture = projectVisual('neutral-workspace'), projectId = fixture.projectId;
  const origin = 'http://127.0.0.1:49025', base = `/api/projects/${projectId}`;
  const output = path.resolve('state/browser/workbench'); fs.mkdirSync(output, {recursive:true});
  const project = fixture.response(new URL(origin + '/api/projects')).projects[0];
  const issue = { ...fixture.response(new URL(origin + base + '/issues/search')), dueDate: '2026-10-20', tags: ['体验', 'MVP'] };
  let delivery = { id: 'delivery-1', projectId, issueId: issue.id, title: '客户搜索交付', body: '功能说明与验证记录', status: 'pending', revision: 1, checklist: ['搜索结果符合筛选条件', '移动端可完成操作'], checkedItems: [], authorId: 'visual-admin', commit: 'abc123', createdAt: '2026-10-14T08:00:00Z' };
  const requests = [], errors = [];
  let reviewForbidden = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    if (endpoint.startsWith('/api/')) {
      const input = request.method() === 'POST' ? request.postDataJSON() : null;
      requests.push({endpoint, search:url.search, input});
      const send = (json,status=200)=>route.fulfill({status,json});
      if (endpoint === '/api/auth/session') return send({ user: {id:'visual-admin',username:'preview',displayName:'演示成员',role:'admin',status:'active',mustChangePassword:false}, token:'fixture', settings:{} });
      if (endpoint === '/api/bootstrap') return send({token:'fixture',workspaces:[]});
      if (endpoint.startsWith('/api/workbench/')) {
        const kind=endpoint.split('/').at(-1);
        const row={ ...issue, projectId, projectName:project.name, releaseName:'v0.2', ...(kind==='tasks'?{id:'task-1',title:'搜索开发任务',status:'planned'}:kind==='deliveries'?{...delivery}:{} ) };
        return send({items:[row],people:issue.people,total:1,nextOffset:null});
      }
      if (endpoint === base + '/issues') {
        const second=url.searchParams.get('offset')==='30';
        return send({items:[second ? {...issue,id:'issue-31',number:31,title:'第二页的事项'} : issue],nextOffset:second?null:30});
      }
      if (endpoint.endsWith('/deliverables') && input) { assert.equal(endpoint,base+'/issues/issue-31/deliverables'); return send({...delivery,id:'delivery-1',...input}); }
      if (endpoint === base + '/deliveries/delivery-1') return send({delivery,issue,permissions:fixture.permissions,people:issue.people});
      if (endpoint === base + '/deliveries/delivery-1/review') {
        if (reviewForbidden) return send({error:'Review permission revoked'},403);
        delivery={...delivery,...input,revision:2,reviewedById:'visual-admin',reviewedAt:'2026-10-14T09:00:00Z'};return send({delivery});
      }
      const result=fixture.response(url); return result ? send(result) : send({error:'Unexpected fixture API: '+endpoint},404);
    }
    const dist=path.resolve('web/dist'), file=endpoint.startsWith('/assets/')?path.resolve(dist,'.'+endpoint):path.join(dist,'index.html');
    assert.ok(file.startsWith(dist+path.sep));
    return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  try {
    await page.goto(origin);
    await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
    await page.locator('.ui-work-row').first().waitFor();
    for(const locale of ['zh-CN','en']) {
      await page.locator('.ui-locale').selectOption(locale);
      for(const [width,height] of [[2560,1440],[1920,1080],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
        await page.setViewportSize({width,height});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${locale} workbench overflow at ${width}`);
        await page.screenshot({path:path.join(output,`home-${locale}-${width}.png`),fullPage:true});
      }
    }
    await page.setViewportSize({width:1920,height:1080});
    await page.getByRole('button',{name:'Search everything',exact:true}).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('搜索');
    await page.getByRole('dialog').getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('dialog').getByText('客户搜索交付',{exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.goto(origin+`/deliveries?projectId=${projectId}`);
    await page.getByRole('button',{name:'Publish delivery',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Next',exact:true}).click();
    await dialog.getByLabel('Related issue',{exact:true}).selectOption('issue-31');
    await dialog.getByRole('button',{name:'Markdown source',exact:true}).click();
    await dialog.getByLabel('Delivery notes',{exact:true}).fill('发布内容保留原文 @ {name}');
    const publish=dialog.getByRole('button',{name:'Publish delivery',exact:true});
    assert.equal(await publish.isEnabled(),false,'sharing requires explicit confirmation');
    await dialog.getByRole('checkbox').check();
    await publish.click();
    await page.getByRole('heading',{name:'Acceptance checklist',exact:true}).waitFor();
    const accept=page.getByRole('button',{name:'Accept delivery',exact:true});
    assert.equal(await accept.isEnabled(),false);
    await page.getByRole('checkbox').nth(0).check();
    assert.equal(await accept.isEnabled(),false);
    await page.getByRole('checkbox').nth(1).check();
    await page.getByLabel('Review notes',{exact:true}).fill('核对完成');
    await accept.click();
    await page.getByRole('heading',{name:'Review record',exact:true}).waitFor();
    const review=requests.find(r=>r.endpoint.endsWith('/review'));
    assert.deepEqual(review.input,{revision:1,status:'accepted',checkedItems:[0,1],reviewNote:'核对完成'});
    assert.equal(requests.some(r=>r.input&&(r.endpoint.endsWith('/start')||r.endpoint.endsWith('/transition'))),false,'review never starts an Agent or silently transitions an issue');
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
    assert.deepEqual(errors,[]);
    console.log('Workbench browser checks passed: bilingual responsive home, search, paged issue selection, explicit sharing and complete acceptance checks.');
  } finally {await context.close();}
}
module.exports={verifyWorkbench};
