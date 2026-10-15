(function () {
  'use strict';
  const U = window.UI;
  const S = U.state;
  const {h,icon,btn,link,badge,field,banner,permissions} = U;
  const app=document.getElementById('app');
  const dialog=document.getElementById('dialog');
  let dialogTrigger=null;
  const nav=[['工作台','home','home'],['项目','projects','folder'],['事项','issues','issue'],['开发','tasks','code'],['交付','deliveries','box']];
  const groupFor=route=> ['home'].includes(route)?'home': ['projects','project','project-settings','releases','release','assets','asset','members','prompts'].includes(route)?'projects':['issues','issue','issue-new','bug-new','assignment','conflict','issue-history'].includes(route)?'issues':['tasks','task','prepare','start','manual','session','approval','changes','archive','cleanup','uncertain'].includes(route)?'tasks':['deliveries','delivery','publish'].includes(route)?'deliveries':['personal','git','tokens','mcp-guide','password'].includes(route)?'personal':'accounts';
  function shell(content) {
    const active=groupFor(S.route);
    return `<div class="shell"><button class="nav-overlay ${S.navOpen?'open':''}" data-action="close-nav" aria-label="关闭菜单"></button><aside class="sidebar ${S.navOpen?'open':''}" id="primary-nav" ${S.navOpen?'':'data-collapsed="true"'}><a class="brand" href="#home">${icon('logo')}<span>DevLoom</span></a><nav class="sidebar-nav" aria-label="主导航">${nav.map(([name,route,sym])=>`<a class="nav-link ${active===route?'active':''}" href="#${route}" aria-label="${name}" ${active===route?'aria-current="page"':''}>${icon(sym)}<span>${name}</span>${route==='issues'?'<span class="nav-count">'+S.issues.length+'</span>':''}</a>`).join('')}</nav><div class="sidebar-bottom"><a href="#personal" class="nav-link ${active==='personal'?'active':''}" aria-label="个人设置">${icon('user')}<span>个人设置</span></a><a href="#accounts" class="nav-link ${active==='accounts'?'active':''}" aria-label="管理中心">${icon('settings')}<span>管理中心</span></a><button class="nav-link" data-action="catalog" aria-label="界面目录">${icon('grid')}<span>界面目录</span></button><div class="prototype-tag"><i></i> B / 交互原型</div></div></aside><header class="topbar"><button class="icon-btn mobile-menu" data-action="toggle-nav" aria-label="打开导航" aria-controls="primary-nav" aria-expanded="${S.navOpen}">${icon('menu')}</button><label class="context-select">${icon('folder')}<span class="sr-only">当前项目</span><select name="project-context" aria-label="当前项目"><option value="all">全部项目</option>${U.projects.map(p=>`<option value="${p.id}" ${S.project===p.id?'selected':''}>${p.name}</option>`).join('')}</select></label><span class="topbar-divider">/</span><span class="breadcrumb">${h(U.routes.find(r=>r[0]===S.route)?.[1]||'事项历史')}</span><span class="topbar-spacer"></span><button class="global-search" data-action="global-search" aria-label="全局搜索">${icon('search')}<span>搜索项目、事项或页面</span><kbd>⌘ K</kbd></button><a href="#personal" class="avatar-button" aria-label="林晨的个人设置">${U.avatar()}</a></header>${content}<nav class="bottom-nav" aria-label="移动端导航">${nav.map(([name,route,sym])=>`<a href="#${route}" class="${active===route?'active':''}" ${active===route?'aria-current="page"':''}>${icon(sym)}${name}</a>`).join('')}</nav></div>`;
  }
  function toast(message) {
    const item=document.createElement('div');
    item.className='toast';
    item.innerHTML=icon('check')+`<span>${h(message)}</span>`;
    const host=dialog.open?dialog:document.getElementById('toasts');
    host.append(item);
    setTimeout(()=>item.remove(),4200);
  }
  function closeDialog() {
    if (dialog.open) dialog.close();
    dialog.innerHTML='';
    dialog.className='';
    if (dialogTrigger?.isConnected) dialogTrigger.focus();
  }
  function openDialog(title,content,actions='',kind='') {
    if (dialog.open) dialog.close();
    dialogTrigger=document.activeElement;
    dialog.className=kind;
    dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${h(title)}</h2><button class="icon-btn" data-action="close-dialog" aria-label="关闭弹窗">${icon('close')}</button></div><div class="dialog-content">${content}</div>${actions?`<div class="dialog-actions">${actions}</div>`:''}`;
    dialog.showModal();
  }
  function dialogForm(id,title,fields,label='保存',kind='') {
    openDialog(title,`<form data-form="${id}" id="dialog-form"><div class="form-error" role="alert"></div>${fields}</form>`,btn('取消','close-dialog','ghost')+`<button type="submit" class="btn primary" form="dialog-form">${label}</button>`,kind);
  }
  function navigate(route, options={}) {
    closeDialog();
    S.navOpen=false;
    if (!options.keepSearch) S.search='';
    if (location.hash==='#'+route) render();
    else location.hash=route;
  }
  function render(preserve=false) {
    const active=document.activeElement;
    const focusName=preserve?active?.getAttribute('name'):null;
    const selection=preserve&&active?.selectionStart!==null?active?.selectionStart:null;
    const position=window.scrollY;
    S.route=decodeURIComponent(location.hash.replace(/^#/,''))||'home';
    const special=['login','password','setup','setup-summary'].includes(S.route);
    let content=(U.views[S.route]||U.views.notfound)();
    if (!special&&S.scenario!=='default'&&S.scenario!=='readonly') {
      const title=U.routes.find(r=>r[0]===S.route)?.[1]||'当前页面';
      const body=S.scenario==='empty'?U.empty('还没有相关内容','这里会展示当前范围内的工作。可以先创建一个事项。',link('新建事项','issue-new','btn primary','plus')):S.scenario==='error'?U.empty('暂时无法获取内容','当前筛选条件已保留，请重试。',btn('重新加载','reset-scenario','primary','refresh'),'info'):S.scenario==='permission'?U.empty('当前内容不可访问','权限可能已经变化，受限信息已从页面移除。',btn('返回可访问内容','reset-scenario','primary','back'),'lock'):`<div class="panel" aria-busy="true">${[1,2,3,4].map(()=>'<div class="skeleton-row"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>').join('')}</div><div class="section">${btn('完成模拟加载','reset-scenario','small')}</div>`;
      content=U.page(title,'',body);
    }
    app.innerHTML=special?content:shell(content);
    if (S.scenario==='readonly'&&!special) {
      document.querySelector('main')?.insertAdjacentHTML('afterbegin',banner('当前为只读状态示例，内容可以查看，变更操作已禁用。'));
      app.querySelectorAll('form input,form textarea,form select,form button[type="submit"]').forEach(el=>el.disabled=true);
      app.querySelectorAll('[data-action]').forEach(el=>{if(mutations.has(el.dataset.action))el.disabled=true;});
    }
    document.title=`${U.routes.find(r=>r[0]===S.route)?.[1]||'DevLoom'} · B 方案原型`;
    if(preserve){
      const target=focusName?app.querySelector(`[name="${CSS.escape(focusName)}"]`):null;
      if(target){target.focus({preventScroll:true});if(typeof target.setSelectionRange==='function'&&selection!==null)try{target.setSelectionRange(selection,selection);}catch{/* Non-text controls have no selection. */}}
      window.scrollTo(0,position);
    }else window.scrollTo(0,0);
    if(S.route==='issues')applyIssueFilters();
    if(S.route==='assignment'&&S.scenario==='default')showAssign();
    if(S.route==='cleanup'&&S.scenario==='default')showCleanup();
  }
  function openIssue(id){ if(id)S.selectedIssue=id; S.checks=[false,false,false]; navigate('issue'); }
  function showAssign(){
    const i=U.currentIssue();
    dialogForm('assignment','分派事项',`<p class="muted small">选择参与者，建立待开发任务。</p><div class="confirmation-summary"><strong>${h(i.title)}</strong><p class="muted small">${i.id} · ${i.release}</p></div>${field('负责人','owner',i.owner==='待分派'?'林晨':i.owner,{select:['林晨','陈宇','张敏'],required:true})}<label class="form-check"><input type="checkbox" name="notify" checked>在事项讨论中记录分派结果</label>${banner('此次操作只安排负责人，不启动 Agent。')}`,'确认分派','drawer');
  }
  function showCleanup(name='已归档会话'){
    dialogForm('cleanup','删除历史与清理工作目录',`${banner('永久删除后无法从界面恢复，请明确选择影响范围。','warning')}<div class="confirmation-summary"><strong>${h(name)}</strong><p class="small muted">个人历史 · codex/search-experience</p></div><label class="form-check"><input type="checkbox" name="history" required>删除该会话历史</label><label class="form-check"><input type="checkbox" name="files">同时清理关联的工作目录与本地分支</label>${field('输入分支名称确认','branch','',{placeholder:'codex/search-experience',required:true,hint:'原型只模拟结果，不会删除磁盘文件。'})}`,'确认删除');
  }
  function catalog(){
    const groups=[...new Set(U.routes.map(r=>r[3]))];
    openDialog('界面目录',`<p class="muted small">46 个桌面页面与状态，移动端使用同一套响应式界面。所有操作仅影响演示数据。</p><div class="catalog-links"><a class="text-link" href="../../prd/ui-refactor.md" target="_blank" rel="noopener">PRD</a><a class="text-link" href="../../prd/assets/ui-refactor/index.html" target="_blank" rel="noopener">48 张参考图</a>${btn('重置演示','reset-demo','small ghost','refresh')}</div><div class="section">${field('页面状态演示','scenario',S.scenario,{select:[['default','正常内容'],['empty','空内容'],['loading','加载中'],['error','加载失败'],['permission','权限失效'],['readonly','只读状态']]})}</div><div class="catalog-grid">${groups.map(g=>`<section class="catalog-group"><h3>${g}</h3>${U.routes.filter(r=>r[3]===g).map(([route,title,sym])=>`<a class="catalog-link" href="#${route}" data-action="catalog-route" data-route="${route}">${icon(sym)}${title}<span>↗</span></a>`).join('')}</section>`).join('')}</div>`,'','catalog');
  }
  function globalSearch(){
    openDialog('搜索',`<label class="input-search">${icon('search')}<input type="search" name="global-query" aria-label="搜索项目、事项或页面" placeholder="搜索项目、事项或页面" autofocus></label><div id="global-results" class="section"><p class="small muted">输入关键字，搜索演示项目、事项或功能页面。</p></div>`);
    dialog.querySelector('input')?.focus();
  }
  function formError(form,message){
    let el=form.querySelector('.form-error');
    if(!el){el=document.createElement('div');el.className='form-error';el.setAttribute('role','alert');form.prepend(el);}
    el.textContent=message;
    el.scrollIntoView({block:'nearest'});
  }
  const mutations=new Set(['assign','claim','merge','approve','reject','stop','accept-delivery','return-delivery','new-project','new-release','new-token','revoke-token','save-permissions','publish-workflow','new-account','add-member','cleanup','cancel-task','save-scope','archive-release','add-asset','edit-asset']);
  const actions={
    'close-dialog':closeDialog,
    'catalog':catalog,
    'catalog-route':el=>{closeDialog();navigate(el.dataset.route);},
    'toggle-nav':()=>{S.navOpen=!S.navOpen;render(true);const side=document.getElementById('primary-nav');if(S.navOpen)side?.querySelector('a')?.focus();},
    'close-nav':()=>{S.navOpen=false;render(true);document.querySelector('[data-action="toggle-nav"]')?.focus();},
    'global-search':globalSearch,
    'quick-create':()=>openDialog('从这里开始',`<div class="settings-menu">${[['创建事项','issue-new','file'],['提交缺陷','bug-new','issue'],['新建独立开发','manual','code']].map(([name,route,sym])=>`<a href="#${route}" data-action="catalog-route" data-route="${route}">${icon(sym)}${name}</a>`).join('')}<button class="nav-link" data-action="new-project">${icon('folder')}新建项目</button></div>`),
    'open-project':el=>{S.project=el.dataset.id;navigate('project');},
    'open-issue':el=>openIssue(el.dataset.id),
    'open-task':el=>{S.selectedTask=el.dataset.id;navigate('task');},
    'open-session':el=>{if(el.dataset.id?.startsWith('DEV'))S.selectedTask=el.dataset.id;else if(el.dataset.id)S.selectedIssue=el.dataset.id;navigate('session');},
    'open-delivery':el=>{S.selectedIssue=el.dataset.id;S.checks=[false,false,false];navigate('delivery');},
    'open-asset':el=>{S.selectedAsset=el.dataset.name;navigate('asset');},
    'issue-filter':el=>{S.issueFilter=el.dataset.value;render(true);},
    'task-filter':el=>{S.taskFilter=el.dataset.value;render(true);},
    'issue-filters':()=>dialogForm('issue-filters','筛选事项',field('状态','status',S.saved.statusFilter||'全部',{select:['全部','规划中','开发中','待验证','已实现']})+field('负责人','owner',S.saved.ownerFilter||'全部',{select:['全部','林晨','陈宇','待分派']}),'应用筛选'),
    'assign':el=>{if(el.dataset.id)S.selectedIssue=el.dataset.id;showAssign();},
    'claim':el=>{const i=S.issues.find(i=>i.id===el.dataset.id)||U.currentIssue();if(i.owner!=='待分派'){toast('该事项已经有负责人。');return;}i.owner='林晨';S.tasks.push({id:'DEV-'+(40+S.tasks.length),title:i.title,status:'待开发',project:i.project,release:i.release,owner:'林晨',issues:[i.id]});render(true);toast('已认领并建立待开发任务，尚未启动执行。');},
    'edit-issue':()=>{const i=U.currentIssue();S.formDraft={title:i.title,content:i.description,project:i.project,criteria:i.criteria,release:i.release,priority:i.priority,editing:i.id};navigate(i.type==='缺陷'?'bug-new':'issue-new');},
    'editor-mode':el=>{saveIssueDraft();S.editorMode=el.dataset.value;render(true);},
    'editor-format':el=>{const area=document.getElementById('issue-content');if(!area||area.hidden){toast('请先切换到编辑模式。');return;}const pos=area.selectionStart;area.setRangeText(el.dataset.value+'\n',pos,area.selectionEnd,'end');saveIssueDraft();area.focus();},
    'new-project':()=>dialogForm('new-project','新建项目',field('项目名称','name','',{required:true,placeholder:'例如：Web Console'})+field('项目说明','description','',{textarea:true})+field('Git 仓库地址','repo','',{required:true,type:'url',placeholder:'https://git.example.com/team/repo.git'}),'创建项目'),
    'new-release':()=>dialogForm('new-release','新建版本',field('版本号','version','',{required:true,placeholder:'v0.3'})+field('版本主题','title','',{required:true})+field('目标日期','date','2026-10-30',{type:'date',required:true}),'创建版本'),
    'show-archived':()=>openDialog('已归档版本',`<div class="setting-row"><div class="row-main"><strong>v0.0 · 最初的探索</strong><p>2026年9月30日归档 · 只读</p></div>${badge('已归档','neutral')}</div>`,btn('关闭','close-dialog')),
    'add-scope':()=>dialogForm('add-scope','添加版本事项',S.issues.filter(i=>i.project==='console').map(i=>`<label class="form-check"><input type="checkbox" name="scope" value="${i.id}">${h(i.title)}</label>`).join(''),'加入版本'),
    'save-scope':()=>{const ids=[...app.querySelectorAll('[name="scope-issue"]:checked')].map(x=>x.value);S.saved.scope=ids;toast(`已保存版本范围：${ids.length} 个事项。`);},
    'archive-release':()=>openDialog('版本暂时不能归档',banner('还有未结束的事项与开发任务，请先完成或移出此版本。','warning')+'<p class="small muted">业务事项和开发任务都结束后，版本才会成为只读历史。</p>',btn('继续处理','close-dialog','primary')),
    'clear-selection':()=>{S.selectedTasks=[];render(true);},
    'merge':()=>{
      const candidates=S.tasks.filter(t=>t.status==='待开发'&&t.owner==='林晨');
      dialogForm('merge','合并开发范围',banner('仅合并本人、同项目、同版本的待开发任务；不会启动执行。')+field('合并后的标题','title','统一搜索与资料体验',{required:true})+candidates.map(t=>`<label class="form-check"><input type="checkbox" name="tasks" value="${t.id}" ${S.selectedTasks.includes(t.id)?'checked':''}><span>${h(t.title)}<small class="muted"> · ${h(t.release)}</small></span></label>`).join(''),'合并任务');
    },
    'cancel-task':()=>{if(S.running){toast('请先停止运行，再取消任务。');return;}dialogForm('cancel-task','取消开发任务',banner('取消会释放关联事项的认领。历史上下文继续保留。','warning')+field('取消原因','reason','',{textarea:true,required:true}),'确认取消');},
    'code-file':el=>{S.codeFile=el.dataset.name;render(true);},
    'git-status':()=>openDialog('Git 状态',`<div class="confirmation-summary"><p>当前分支：<code>codex/search-experience</code></p><p>2 个变更文件 · +20 / −1</p><p class="muted small">此为演示数据，不执行提交、合并或推送。</p></div>`,btn('完成','close-dialog','primary')),
    'approve':()=>{S.approvalStatus='approved';S.running=false;render(true);toast('已批准本次模拟操作，检查完成。');},
    'reject':()=>{S.approvalStatus='rejected';S.running=false;render(true);toast('已拒绝，本次模拟操作未执行。');},
    'stop':()=>{S.running=false;S.messages.push({author:'Codex',text:'当前模拟轮次已停止，已有内容保留。'});render(true);toast('已停止当前轮次。');},
    'accept-delivery':()=>{if(!S.checks.every(Boolean))return;const i=U.currentIssue();i.status='已实现';S.activity.push('通过验收：'+i.id);navigate('deliveries');toast('验收已通过，事项标记为已实现。');},
    'return-delivery':()=>dialogForm('return-delivery','退回处理',field('需要调整的内容','reason',document.getElementById('verification-note')?.value||'',{textarea:true,required:true,hint:'填写原因，帮助参与者明确下一步。'}),'确认退回'),
    'delivery-filter':el=>{const done=el.dataset.value==='done';const items=U.scopedIssues().filter(i=>i.status===(done?'已实现':'待验证'));app.querySelectorAll('[data-action="delivery-filter"]').forEach(b=>b.classList.toggle('active',b===el));document.getElementById('delivery-results').innerHTML=items.length?`<div class="panel">${items.map(i=>`<div class="work-row"><div class="row-main"><strong>${h(i.title)}</strong><div class="row-meta">${i.id}</div></div>${U.status(i.status)}${btn('查看','open-delivery','small','',`data-id="${i.id}"`)}</div>`).join('')}</div>`:U.empty('暂无'+(done?'已验证':'待验证')+'的交付','后续结果会出现在这里。');},
    'restore-session':el=>{S.saved.restored=el.dataset.name;el.closest('.work-row')?.remove();toast('会话已恢复到开发列表，没有自动开始执行。');},
    'cleanup':el=>showCleanup(el.dataset.name),
    'preview-attachment':el=>openDialog(el.dataset.name||'参考资料',`<div class="prose"><h3>参考资料预览</h3><p>这份演示资料说明了项目目标、布局与验收方式。</p><ul><li>保持同一套导航和协作上下文。</li><li>在 1080P、2K 与移动端完成相同核心操作。</li><li>区分准备、执行与业务验收。</li></ul></div>`,btn('关闭','close-dialog','primary')),
    'add-asset':()=>dialogForm('asset','添加项目资料',field('标题','title','',{required:true})+field('内容说明','description','',{textarea:true,required:true})+field('类型','type','文档',{select:['文档','链接','受保护配置']}),'保存资料'),
    'edit-asset':()=>dialogForm('asset','编辑资料',field('标题','title',S.selectedAsset,{required:true})+field('内容说明','description','更新项目资料与使用约定。',{textarea:true,required:true}),'保存修改'),
    'reveal-secret':()=>{S.securityVisible=!S.securityVisible;render(true);},
    'member-permissions':el=>openDialog('调整 '+el.dataset.name+' 的授权',`<p class="field-hint">授权组合来自部门功能上限，不创建岗位角色。</p><div id="permission-region">${permissions()}</div>`,btn('取消','close-dialog','ghost')+btn('保存授权','save-permissions','primary'),'drawer'),
    'add-member':()=>dialogForm('member','添加项目成员',field('成员','name','张敏',{select:['张敏','李澄','陈宇'],required:true})+banner('加入项目后，再按部门功能上限分配工作权限。'),'添加成员'),
    'insert-placeholder':()=>{const area=app.querySelector('[name="prompt"]');if(area){area.value+='\n验收标准：{{acceptanceCriteria}}';area.focus();}},
    'toggle-notify':el=>{S.saved.notify=el.getAttribute('aria-checked')!=='true';el.setAttribute('aria-checked',String(S.saved.notify));},
    'test-git':()=>{S.gitConnected=true;document.getElementById('connection-result').innerHTML=banner('模拟连接检查通过。','success','check');toast('演示连接已验证，未访问真实主机。');},
    'copy-mcp':async()=>{try{await navigator.clipboard.writeText('https://coding.example.com/mcp');toast('已复制示例 MCP 地址。');}catch{openDialog('复制示例地址',field('连接地址','copy','https://coding.example.com/mcp',{readonly:true}));}},
    'new-token':()=>dialogForm('token','创建 MCP Token',field('名称','name','本机助手',{required:true})+field('操作范围','scope','只读',{select:['只读','读取与写入']})+field('项目范围','project','当前可访问项目',{select:['当前可访问项目','仅 Web Console']})+field('有效期','expires','30 天',{select:['7 天','30 天','90 天']}),'创建 Token','drawer'),
    'revoke-token':el=>{S.tokens[Number(el.dataset.index)].enabled=false;render(true);toast('演示 Token 已撤销。');},
    'mcp-example':()=>openDialog('上传返回示例','<pre>{\n  "attachment_id": "demo-attachment-id"\n}</pre><p class="field-hint section">示例字段只用于原型说明，请以真实 MCP 契约为准。</p>',btn('关闭','close-dialog')),
    'new-account':()=>dialogForm('account','新建账号',field('登录名','username','',{required:true})+field('显示名称','name','',{required:true})+field('部门','department','协作一组',{select:['协作一组','协作二组']})+field('系统身份','role','普通成员',{select:['普通成员','管理员']})+field('临时密码','password','',{type:'password',required:true,attrs:'minlength="6"',hint:'仅输入演示值；不持久化。'}),'创建账号','drawer'),
    'edit-account':el=>dialogForm('edit-account','管理账号',field('显示名称','name',el.dataset.name,{required:true})+field('部门','department','协作一组',{select:['协作一组','协作二组']})+field('状态','status','启用',{select:['启用','停用']}),'保存账号'),
    'permission-category':el=>{S.selectedPermission=el.dataset.name;if(dialog.open){document.getElementById('permission-region').innerHTML=permissions();}else render(true);},
    'save-permissions':()=>{closeDialog();toast('已保存演示权限，不影响实际账号。');},
    'new-department':()=>dialogForm('department','新建部门',field('部门名称','name','',{required:true}),'创建部门'),
    'workflow-type':el=>{S.saved.workflowType=el.dataset.value;render(true);},
    'workflow-node':el=>dialogForm('workflow-node','状态配置',field('名称','name',el.dataset.name,{required:true})+field('类型','kind','进行中',{select:['初始状态','进行中','完成状态','取消状态']})+'<label class="form-check"><input type="checkbox" name="development" checked>在此状态允许开始开发</label>','保存节点','drawer'),
    'validate-workflow':()=>toast('模拟校验通过：初始状态唯一，所有节点可达。'),
    'publish-workflow':()=>openDialog('发布流程',banner('发布为新版本，仅供之后创建的事项使用。在途事项保持当前流程。')+'<p class="muted small">本原型仅模拟发布状态。</p>',btn('取消','close-dialog','ghost')+btn('确认发布','confirm-workflow','primary')),
    'confirm-workflow':()=>{S.saved.workflowPublished=true;closeDialog();render(true);toast('流程演示版本已发布。');},
    'test-supplier':()=>{S.supplierConnected=true;toast('模拟连接成功；未发送真实网络请求。');},
    'check-environment':()=>{S.saved.environmentChecked=true;render(true);toast('模拟环境检测完成。');},
    'environment-detail':el=>openDialog(el.dataset.name+' 环境信息',banner('当前为原型模拟数据，不执行安装或升级。')+U.meta([['检查项',h(el.dataset.name)],['执行位置','应用服务所在机器'],['状态','已就绪（演示）']]),btn('关闭','close-dialog')),
    'browse-directory':()=>openDialog('选择目录',`<div class="settings-menu">${['D:/Workspace','D:/Projects','D:/Work'].map(p=>`<button class="nav-link" data-action="select-directory" data-path="${p}">${icon('folder')}${p}</button>`).join('')}</div>`),
    'select-directory':el=>{const path=el.dataset.path;closeDialog();app.querySelector('[name="path"]').value=path;},
    'setup-back':()=>{S.setupStep=Math.max(1,S.setupStep-1);render();},
    'finish-setup':()=>{navigate('home');toast('演示初始化完成，没有启动开发。');},
    'query-request':()=>{S.saved.requestChecked=true;render(true);toast('已查询到原任务，未重新派发。');},
    'reset-scenario':()=>{S.scenario='default';render();},
    'reset-demo':()=>{closeDialog();location.href=location.pathname+'#home';location.reload();},
  };
  function saveIssueDraft(){
    const form=app.querySelector('[data-form="issue-editor"]');
    if(!form)return;
    const data=new FormData(form);
    for(const key of ['project','title','content','criteria','release','priority'])S.formDraft[key]=data.get(key);
  }
  const submits={
    'issue-editor':(f,d)=>{
      const editing=S.formDraft.editing;
      let issue=editing?S.issues.find(i=>i.id===editing):null;
      if(!issue){const project=String(d.get('project'));issue={id:(project==='portal'?'PT-':project==='design'?'DS-':'WC-')+(130+S.issues.length),owner:'待分派',status:'规划中',date:'今天'};S.issues.unshift(issue);}
      Object.assign(issue,{title:String(d.get('title')),description:String(d.get('content')),criteria:String(d.get('criteria')),type:String(d.get('type')),project:String(d.get('project')),priority:String(d.get('priority')),release:String(d.get('release'))});
      S.selectedIssue=issue.id;S.formDraft={};navigate('issue');toast(editing?'事项已更新。':'事项已创建，尚未分派或启动开发。');
    },
    'comment':(f,d)=>{S.comments.push({issue:S.selectedIssue,text:String(d.get('comment'))});render(true);toast('讨论已发送。');},
    'assignment':(f,d)=>{
      const i=U.currentIssue(), owner=String(d.get('owner'));i.owner=owner;
      let task=S.tasks.find(t=>t.issues.includes(i.id)&&!['已完成','已取消','已合并'].includes(t.status));
      if(task)task.owner=owner;else{task={id:'DEV-'+(40+S.tasks.length),title:i.title,status:'待开发',project:i.project,release:i.release,owner,issues:[i.id]};S.tasks.unshift(task);}
      S.selectedTask=task.id;closeDialog();if(S.route==='assignment')navigate('issue');else render(true);toast('已分派给'+owner+'，任务保持待开发。');
    },
    'new-project':(f,d)=>{const p={id:'project-'+Date.now(),name:String(d.get('name')),description:String(d.get('description'))||'新的协作空间',initial:String(d.get('name')).slice(0,1),color:'violet',members:1};U.projects.push(p);S.project=p.id;closeDialog();navigate('project');toast('演示项目已创建。');},
    'new-release':(f,d)=>{const version=String(d.get('version'));if(!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/.test(version)){formError(f,'版本号应为 v0.3 或 v1.0.0，不包含空格或后缀。');return;}(S.saved.releases??=[]).push({version,title:String(d.get('title')),date:String(d.get('date'))});closeDialog();render(true);toast('版本已创建。');},
    'add-scope':(f,d)=>{const ids=d.getAll('scope');ids.forEach(id=>{const i=S.issues.find(x=>x.id===id);if(i)i.release='v0.2';});closeDialog();render(true);toast(`已将 ${ids.length} 个事项加入版本。`);},
    'merge':(f,d)=>{const ids=d.getAll('tasks'),tasks=S.tasks.filter(t=>ids.includes(t.id));if(tasks.length<2){formError(f,'请至少选择两个待开发任务。');return;}if(tasks.some(t=>t.status!=='待开发'||t.owner!=='林晨'||t.release!==tasks[0].release||t.project!==tasks[0].project)){formError(f,'只能合并本人、同项目、同版本且未开始的任务。');return;}const merged={id:'DEV-'+(50+S.tasks.length),title:String(d.get('title')),status:'待开发',project:tasks[0].project,release:tasks[0].release,owner:'林晨',issues:[...new Set(tasks.flatMap(t=>t.issues))]};tasks.forEach(t=>t.status='已合并');S.tasks.unshift(merged);S.mergeHistory.push(ids);S.selectedTask=merged.id;S.selectedTasks=[];closeDialog();navigate('task');toast('范围已合并，尚未开始执行。');},
    'cancel-task':(f,d)=>{const t=U.currentTask();t.status='已取消';t.issues.forEach(id=>{const i=S.issues.find(x=>x.id===id);if(i)i.owner='待分派';});S.activity.push('取消：'+d.get('reason'));closeDialog();navigate('tasks');toast('任务已取消，认领已释放。');},
    'prepare':()=>{S.prepared=true;render(true);toast('个人环境已模拟准备完成，可以返回任务。');},
    'start':f=>startExecution(f,false),
    'manual-start':f=>startExecution(f,true),
    'message':(f,d)=>{if(S.running){formError(f,'当前轮次仍在运行，请先停止或完成审批。');return;}S.messages.push({author:'你',text:String(d.get('message'))});S.messages.push({author:'Codex',text:'已收到补充。我会保留当前上下文，并按你的说明继续检查相关界面。这是原型中的模拟回复。'});render(true);document.getElementById('conversation-log').scrollTop=1e6;},
    'publish':(f,d)=>{const id=String(d.get('issue'));S.deliveries.push({issue:id,title:String(d.get('title')),summary:String(d.get('summary'))});S.issues.find(i=>i.id===id).status='待验证';S.selectedIssue=id;S.checks=[false,false,false];navigate('delivery');toast('交付已发布到项目，私人会话未公开。');},
    'return-delivery':(f,d)=>{const i=U.currentIssue();i.status='开发中';S.comments.push({issue:i.id,text:'退回原因：'+String(d.get('reason'))});S.checks=[false,false,false];closeDialog();navigate('issue');toast('已退回处理，并记录原因。');},
    'cleanup':(f,d)=>{if(d.get('branch')!=='codex/search-experience'){formError(f,'分支名称不一致，请输入 codex/search-experience。');return;}closeDialog();navigate('archive');toast('已演示删除结果，没有删除任何真实文件。');},
    'asset':(f,d)=>{S.selectedAsset=String(d.get('title'));S.saved.assetDescription=String(d.get('description'));closeDialog();navigate('asset');toast('资料已保存到原型。');},
    'member':(f,d)=>{S.saved.member=String(d.get('name'));closeDialog();toast('成员已添加到演示项目，可继续分配权限。');},
    'project-settings':(f,d)=>{const p=U.project();p.name=String(d.get('name'));p.description=String(d.get('description'));S.saved.commands=String(d.get('commands'));toast('项目配置已保存到演示状态。');},
    'prompts':(f,d)=>{S.saved.prompt=String(d.get('prompt'));toast('已保存当前作用范围的提示词。');},
    'personal':(f,d)=>{S.saved.displayName=String(d.get('displayName'));toast('个人设置已保存，不影响已有任务。');},
    'git-account':f=>{f.querySelector('[name="token"]').value='';S.saved.gitAccount=true;toast('演示账号已保存，凭据输入已清除。');},
    'token':(f,d)=>{S.tokens.push({name:String(d.get('name')),scope:String(d.get('scope'))+' · '+String(d.get('project')),enabled:true});closeDialog();render(true);openDialog('Token 已创建',banner('演示字符串仅展示一次，关闭后不再显示。')+field('演示 Token','demo-token','DEMO-TOKEN-NOT-A-REAL-CREDENTIAL',{readonly:true})+'<p class="field-hint">这是无效占位符，不可用于任何真实服务。</p>',btn('已保存，关闭','close-dialog','primary'));},
    'account':(f,d)=>{(S.saved.accounts??=[]).push([String(d.get('name')),String(d.get('username')),String(d.get('department')),String(d.get('role'))]);f.querySelector('[name="password"]').value='';closeDialog();render(true);toast('演示账号已创建，临时密码已清除。');},
    'edit-account':()=>{closeDialog();toast('演示账号配置已保存。');},
    'department':(f,d)=>{S.saved.department=String(d.get('name'));closeDialog();toast('演示部门已创建，可按需配置功能上限。');},
    'workflow-node':(f,d)=>{S.saved.workflowNode=String(d.get('name'));closeDialog();toast('节点草稿已保存，发布后对新事项生效。');},
    'supplier':f=>{f.querySelector('[name="key"]').value='';toast('供应商演示配置已保存，密钥输入已清除。');},
    'storage':(f,d)=>{S.saved.storage=String(d.get('path'));toast('演示目录设置已保存，现有目录没有移动。');},
    'login':f=>{f.querySelector('[name="password"]').value='';navigate('home');toast('已进入原型工作台。');},
    'password':(f,d)=>{if(d.get('password')!==d.get('confirm')){formError(f,'两次输入的新密码不一致。');return;}f.querySelectorAll('[type="password"]').forEach(el=>el.value='');navigate('home');toast('密码表单校验通过；没有修改真实账号。');},
    'setup-step':(f,d)=>{if(S.setupStep===3)S.saved.setupPath=String(d.get('path'));if(S.setupStep===4)S.saved.setupProject=String(d.get('name'));f.querySelectorAll('[type="password"]').forEach(el=>el.value='');if(S.setupStep<4){S.setupStep++;render();}else navigate('setup-summary');},
    'conflict':(f,d)=>{U.currentIssue().description=String(d.get(d.get('choice')));navigate('issue');toast('已合并并保存选择的内容。');},
    'issue-filters':(f,d)=>{S.saved.statusFilter=String(d.get('status'));S.saved.ownerFilter=String(d.get('owner'));closeDialog();render(true);applyIssueFilters();},
  };
  function startExecution(form,manual){
    if(!S.prepared){formError(form,'个人环境尚未准备，请先打开“准备个人环境”。');return;}
    if(S.running){formError(form,'已有模拟轮次运行中，请进入原会话查看。');return;}
    if(manual){const d=new FormData(form);const t={id:'DEV-'+(60+S.tasks.length),title:String(d.get('title')),status:'开发中',project:U.project().id,release:'独立开发',owner:'林晨',issues:[]};S.tasks.unshift(t);S.selectedTask=t.id;}
    else U.currentTask().status='开发中';
    S.running=true;S.approvalStatus='pending';navigate('session');toast('已进入模拟执行，未调用真实 Agent。');
  }
  function applyIssueFilters(){
    const rows=app.querySelectorAll('.list-table tbody tr');
    rows.forEach(row=>{const text=row.textContent;row.hidden=Boolean((S.saved.statusFilter&&S.saved.statusFilter!=='全部'&&!text.includes(S.saved.statusFilter))||(S.saved.ownerFilter&&S.saved.ownerFilter!=='全部'&&!text.includes(S.saved.ownerFilter)));});
  }
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-action]');
    if(!el){
      if(event.target.closest('.skip-link')){event.preventDefault();document.getElementById('main')?.focus();return;}
      if(event.target.closest('a[href^="#"]')){saveIssueDraft();closeDialog();S.search='';S.navOpen=false;}
      return;
    }
    if(el.disabled)return;
    const handler=actions[el.dataset.action];
    if(handler){event.preventDefault();handler(el,event);}
    if(event.target.closest('a[href^="#"]')&&!handler){saveIssueDraft();closeDialog();S.search='';S.navOpen=false;}
  });
  document.addEventListener('submit',event=>{
    const form=event.target.closest('[data-form]');
    if(!form)return;
    event.preventDefault();
    if(!form.reportValidity())return;
    const handler=submits[form.dataset.form];
    if(handler)handler(form,new FormData(form));
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.name==='local-search'){S.search=el.value;render(true);}
    if(el.closest('[data-form="issue-editor"]')&&el.type!=='file')saveIssueDraft();
    if(el.id==='verification-note')S.saved.verificationNote=el.value;
    if(el.name==='global-query'){
      const q=el.value.trim().toLowerCase();
      const matches=U.routes.filter(r=>r[1].toLowerCase().includes(q)).slice(0,8);
      const issues=S.issues.filter(i=>(i.id+i.title).toLowerCase().includes(q)).slice(0,5);
      document.getElementById('global-results').innerHTML=q?`<div class="settings-menu">${issues.map(i=>`<button class="nav-link" data-action="open-issue" data-id="${i.id}">${icon('issue')}${h(i.title)}</button>`).join('')}${matches.map(([route,name,sym])=>`<a href="#${route}" data-action="catalog-route" data-route="${route}">${icon(sym)}${h(name)}</a>`).join('')}${!matches.length&&!issues.length?'<p class="muted small">没有匹配的结果。</p>':''}</div>`:'<p class="muted small">输入关键字，搜索项目、事项或页面。</p>';
    }
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.name==='project-context'){S.project=el.value;S.selectedTasks=[];render(true);}
    if(el.name==='scenario'){S.scenario=el.value;closeDialog();render();}
    if(el.name==='task-select'){S.selectedTasks=[...app.querySelectorAll('[name="task-select"]:checked')].map(x=>x.value);render(true);}
    if(el.name==='delivery-check'){S.checks[Number(el.value)]=el.checked;render(true);}
    if(el.name==='permission'){S.permissions=el.checked?[...new Set([...S.permissions,el.value])]:S.permissions.filter(p=>p!==el.value);}
    if(el.name==='attachments'){S.formDraft.attachments=[...el.files].map(f=>f.name);const host=document.getElementById('attachment-list');host.innerHTML=S.formDraft.attachments.map(n=>`<div class="attachment">${icon('file')}<span>${h(n)}</span><span class="faint small">仅演示文件名</span></div>`).join('');}
  });
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();globalSearch();}
    if(event.key==='Escape'&&S.navOpen){S.navOpen=false;render(true);document.querySelector('[data-action="toggle-nav"]')?.focus();}
    if(event.key==='Tab'&&S.navOpen){
      const items=[...document.querySelectorAll('.sidebar a,.sidebar button')];const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  dialog.addEventListener('cancel',()=>{setTimeout(closeDialog,0);});
  window.addEventListener('hashchange',()=>{closeDialog();S.navOpen=false;render();});
  window.addEventListener('pagehide',()=>{S.securityVisible=false;S.tokenCreated=false;document.querySelectorAll('[type="password"]').forEach(el=>el.value='');});
  render();
})();
