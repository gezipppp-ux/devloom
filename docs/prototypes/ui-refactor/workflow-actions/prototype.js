/* Standalone design review. All state stays in memory; no business API calls. */
(() => {
  'use strict';
  const root = document.getElementById('app');
  const dialog = document.getElementById('dialog');
  const proposals = {
    a: { name: '侧栏办理', description: '事项右侧集中操作，流程工具按需展开。保留阅读上下文，主次清晰。', fit: '日常协作 · 推荐' },
    b: { name: '页内办理', description: '事项内容与成果表单在页内切换，流程设计、预览、发布各占一个工作区。', fit: '完整阅读 · 大表单' },
    c: { name: '抽屉办理', description: '列表与详情同屏，线下处理在侧边抽屉完成；流程采用版本、画布、属性三栏。', fit: '高频操作 · 多事项' },
  };
  const examples = {
    image: { number: 128, title: '图生图保留图片文字设计并移除额外营销文案', description: '图生图需要保留原图中文字的字体、排版及视觉层级，生成结果不再额外添加营销口号。本次可通过配置调整与人工核验完成。', acceptance: ['保留原图中的文字内容、字体风格和排版关系。', '生成图片不额外添加营销标题、口号或促销文案。', '覆盖含文字与不含文字的图片样本，记录核验结果。'], file: '原图与结果对照.pdf', author: '林悦', owner: '陈宇' },
    video: { number: 127, title: '视频结果页支持当前页面直接下载视频', description: '视频结果页已完成下载功能。用户可以在当前页面下载生成的视频，保留现有预览与结果展示。本次补充已完成成果和验证结果后送验。', acceptance: ['在视频结果页直接下载视频。', '下载文件可正常播放，文件名和格式正确。', '下载失败时展示可理解的提示并支持重试。'], file: '视频下载验证记录.pdf', author: '林悦', owner: '陈宇' },
  };
  const tasks = [
    { id: 127, title: examples.video.title, status: '待开发', tone: 'current', date: '今天 10:24', owner: '陈宇' },
    { id: 129, title: '图片编辑器支持保存常用尺寸', status: '开发中', tone: '', date: '今天 09:36', owner: '陈宇' },
    { id: 125, title: '优化素材上传失败时的提示', status: '已完成', tone: 'success', date: '昨天 16:42', owner: '陈宇' },
    { id: 121, title: '批量导出增加文件命名规则', status: '待开发', tone: 'current', date: '昨天 15:20', owner: '陈宇' },
    { id: 118, title: '旧版营销文案自动扩写', status: '已取消', tone: '', date: '10 月 13 日', owner: '陈宇' },
  ];
  const state = { proposal: 'a', page: 'issue', scenario: 'image', assigned: false, submitted: false, executor: '陈宇', reviewer: '许宁', latest: false, issueTab: 'content', workflowTab: 'design', workflowType: 'requirement', selectedNode: 'ready', dirty: false, templateLoaded: false, published: false, taskFilter: 'not-cancelled', search: '', locale: 'zh', recordTab: 'discussion', notice: '' };
  let returnFocus = null, toastTimer;
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
    issue: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>',
    settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="9" cy="18" r="2" fill="white"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    circle: '<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M9 13h6M9 17h4"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    flow: '<rect x="8" y="2" width="8" height="5" rx="1"/><rect x="2" y="17" width="8" height="5" rx="1"/><rect x="14" y="17" width="8" height="5" rx="1"/><path d="M12 7v5H6v5m6-5h6v5"/>',
    play: '<path d="m8 4 12 8-12 8z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    edit: '<path d="m14 4 6 6M3 21l5-1L21 7l-5-5L3 15z"/>',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.issue}</svg>`;
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const sample = () => examples[state.scenario === 'video' ? 'video' : 'image'];
  const status = () => state.submitted ? '待验证' : state.scenario === 'review' ? '待评审' : '待开发';
  const eligible = () => !state.submitted && state.scenario !== 'review';
  const hasUpgrade = () => !state.latest && state.scenario !== 'latest' && !state.submitted;
  const pill = (text, tone = '') => `<span class="pill ${tone}"><span class="dot"></span>${text}</span>`;
  const button = (label, action, cls = '', extra = '') => `<button type="button" data-action="${action}" class="${cls}" ${extra}>${label}</button>`;
  const options = (items, selected) => items.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
  function route() {
    closeDialog();
    const match = /^#([abc])-(issue|development|workflow)$/.exec(location.hash);
    if (match) { state.proposal = match[1]; state.page = match[2]; }
    render();
  }
  function navigate(proposal = state.proposal, page = state.page) {
    closeDialog(); state.issueTab = 'content'; state.workflowTab = 'design';
    const hash = `#${proposal}-${page}`;
    if (location.hash === hash) render(); else location.hash = hash;
  }
  function render() {
    const p = proposals[state.proposal];
    root.className = `proposal-${state.proposal}`;
    root.innerHTML = `<header class="review-bar"><div class="review-title"><strong>DevLoom · 界面评审</strong><span>三个方案 / 同一业务流程</span></div><nav class="proposal-tabs" aria-label="选择设计方案">${Object.entries(proposals).map(([key, value]) => button(`${key.toUpperCase()} · ${value.name}${key === 'a' ? ' <span class="small">推荐</span>' : ''}`, 'proposal', '', `data-value="${key}" aria-pressed="${state.proposal === key}"`)).join('')}</nav><div class="review-tools">${button('方案对比', 'compare', 'quiet')}${button(state.locale === 'zh' ? 'EN' : '中文', 'locale', 'quiet', 'aria-label="切换语言"')}${button('重置演示', 'reset', 'quiet')}</div></header>
      <div class="review-note"><strong>${p.description}</strong><span>交互原型 · 模拟数据</span></div>
      <div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon('code')}</span><span>DevLoom</span></div><nav aria-label="主导航">${navButton('工作台', 'grid', 'home')}${navButton('项目', 'folder', 'projects')}${navButton('事项', 'issue', 'issue')}${navButton('开发', 'code', 'development')}${navButton('交付', 'box', 'deliveries')}<div class="nav-divider"></div>${navButton('管理中心', 'settings', 'workflow')}</nav><div class="account"><span class="avatar">陈</span><span>陈宇<br><span class="small">创意协作空间</span></span></div></aside><div class="workspace"><header class="topbar"><div class="crumbs"><span>${state.page === 'workflow' ? '管理中心' : '创意协作空间'}</span><span>/</span><b>${state.page === 'workflow' ? '流程编排' : state.page === 'development' ? '我的开发' : '事项详情'}</b></div><nav class="scene-tabs" aria-label="查看页面">${['issue', 'development', 'workflow'].map((key, i) => button(['事项处理', '开发列表', '流程编排'][i], 'page', state.page === key ? 'active' : '', `data-value="${key}"`)).join('')}</nav></header><main id="main" class="page">${state.page === 'issue' ? issuePage() : state.page === 'development' ? developmentPage() : workflowPage()}</main></div></div><nav class="mobile-nav" aria-label="移动导航">${navButton('工作台', 'grid', 'home')}${navButton('项目', 'folder', 'projects')}${navButton('事项', 'issue', 'issue')}${navButton('开发', 'code', 'development')}${navButton('交付', 'box', 'deliveries')}</nav>`;
    translate(root);
  }
  function navButton(label, glyph, page) { return button(`${icon(glyph)}<span class="nav-label">${label}</span>`, 'page', state.page === page ? 'active' : '', `data-value="${page}" aria-label="${label}"`); }
  function scenarioPicker() { return `<div class="scenario"><label for="scenario">演示场景</label><select id="scenario" data-change="scenario">${options([['image', '图生图 · 待开发'], ['video', '视频下载 · 已指派'], ['review', '待评审 · 尚未到待开发'], ['latest', '已是最新流程版本']], state.scenario)}</select><span>切换查看入口的显示条件</span></div>`; }
  function issueHeading() { return `<div class="issue-title"><div class="row"><span class="eyebrow">REQ-${sample().number}</span>${pill('需求')}${pill(status(), state.submitted ? 'success' : 'current')}</div><h1>${sample().title}</h1><div class="row muted small"><span>林悦创建</span><span>·</span><span>今天 10:24 更新</span><span>·</span><span>v0.8.2</span></div></div>`; }
  function upgrade(kind = 'aside') {
    if (!hasUpgrade()) return '';
    if (kind === 'banner') return `<div class="version-notice"><div><strong class="small">有新的已发布流程版本 v2</strong><p>当前事项使用 v1，可先查看版本变化。</p></div>${button('采用新流程版本', 'upgrade', 'link')}</div>`;
    return `<section class="upgrade"><div class="version-line"><span>流程版本 v1</span><span>新版本 v2</span></div>${button('采用新流程版本 '+icon('arrow'), 'upgrade', 'link')}</section>`;
  }
  function actionButtons() {
    if (state.submitted) return button('查看交付与验收', 'delivery', 'primary');
    if (!eligible()) return button('完成评审', 'review', 'primary');
    return `${button('线下处理', 'offline', 'primary')}<div class="secondary-actions">${button(state.assigned || state.scenario === 'video' ? '查看开发任务' : '指派', state.assigned || state.scenario === 'video' ? 'task' : 'assign')}${button('更多操作', 'more', 'quiet')}</div>`;
  }
  function processPanel(compact = false) {
    return `<section class="process-panel"><div class="status-line"><h3>当前处理</h3>${pill(status(), 'current')}</div><div class="owner"><span class="avatar">${(state.submitted ? state.reviewer : state.executor)[0]}</span><div><strong>${state.submitted ? state.reviewer : state.executor}</strong><small>${state.submitted ? '本轮验证人' : '当前处理人'}</small></div></div>${compact ? '<p class="hint">在下方操作栏继续处理事项。</p>' : actionButtons()}<p class="hint">${state.submitted ? '成果已送验，等待验证结果。' : eligible() ? '完成线下工作后，填写成果并提交验证。' : '评审通过并进入待开发后，可使用线下处理。'}</p>${state.notice ? `<p class="result-note" role="status">${state.notice}</p>` : ''}</section>`;
  }
  function facts() { return `<section class="facts"><h3>事项信息</h3><dl><dt>所属项目</dt><dd>创意协作平台</dd><dt>业务负责人</dt><dd>林悦</dd><dt>开发负责人</dt><dd>${state.assigned || state.scenario === 'video' ? state.executor : '待指派'}</dd><dt>测试负责人</dt><dd>许宁</dd><dt>优先级</dt><dd>P2 · 普通</dd><dt>目标版本</dt><dd>v0.8.2</dd><dt>流程版本</dt><dd>${state.latest || state.scenario === 'latest' ? 'v2' : 'v1'}</dd></dl></section>`; }
  function bodyContent() {
    return `<article class="paper issue-paper"><section><h2>需求描述</h2><p class="description">${sample().description}</p></section><section><h2>验收标准</h2><ul class="acceptance">${sample().acceptance.map(text => `<li>${icon('circle')}<span>${text}</span></li>`).join('')}</ul></section><section><h2>参考资料</h2><div class="attachment"><span class="file-icon">${icon('file')}</span><div>${sample().file}<br><small>PDF · 2.4 MB</small></div></div></section><nav class="subtabs" aria-label="事项记录">${[['discussion', '讨论'], ['delivery', '交付'], ['history', '历史']].map(([id, label]) => button(label, 'record-tab', state.recordTab === id ? 'active' : '', `data-value="${id}"`)).join('')}</nav>${recordContent()}</article>`;
  }
  function recordContent() {
    if (state.recordTab === 'history') return `<div class="comment"><span class="avatar">林</span><div><strong>林悦</strong><small>今天 10:24</small><p>将事项推进到待开发，当前处理人为陈宇。</p>${state.notice ? `<p>${state.notice}</p>` : ''}</div></div>`;
    if (state.recordTab === 'delivery') return state.submitted ? `<div class="comment"><span class="avatar">陈</span><div><strong>陈宇</strong><small>刚刚</small><p>已提交处理成果，${state.reviewer}负责本轮验证。</p>${button('查看交付与验收', 'delivery', 'link')}</div></div>` : `<p class="muted small">成果送验后，在这里查看交付和验收记录。</p>`;
    return `<div class="comment"><span class="avatar">林</span><div><strong>林悦</strong><small>今天 10:30</small><p>${state.scenario === 'video' ? '功能已经完成，请补充下载文件和播放验证结果，提交后由测试确认。' : '请按验收标准核对配置效果，并在送验时附上处理说明和检查结果。'}</p></div></div><div class="comment-composer">补充想法，或提出一个问题…<div class="row">${button('发送讨论', 'comment', 'quiet')}</div></div>`;
  }
  function issuePage() {
    const heading = issueHeading();
    if (state.proposal === 'b') return `${scenarioPicker()}<header class="page-head">${heading}${button(icon('edit')+'编辑事项', 'edit', 'quiet head-actions')}</header>${upgrade('banner')}<section class="handling-strip"><div><strong>${status()} · ${state.submitted ? state.reviewer : state.executor}</strong><p>${state.notice || (state.submitted ? '成果已送验，等待验证结果。' : '当前处理人负责推进，完成后交接给验证人。')}</p></div><div class="row">${state.submitted ? button('查看交付与验收', 'delivery', 'primary') : eligible() ? `${button(state.assigned ? '已指派 · '+state.executor : '指派', 'assign')}${button('线下处理', 'offline', 'primary')}` : button('完成评审', 'review', 'primary')}</div></section><nav class="subtabs inline-tabs" aria-label="事项工作区">${button('事项内容', 'issue-tab', state.issueTab === 'content' ? 'active' : '', 'data-value="content"')}${eligible() ? button('线下处理', 'issue-tab', state.issueTab === 'offline' ? 'active' : '', 'data-value="offline"') : ''}</nav>${state.issueTab === 'offline' ? `<div class="paper inline-offline"><h2>线下处理</h2>${offlineForm(false)}</div>` : `<div class="issue-grid">${bodyContent()}<aside>${facts()}</aside></div>`}`;
    if (state.proposal === 'c') return `${scenarioPicker()}<div class="list-detail"><aside class="issue-rail"><h3>待处理事项 <span class="muted">2</span></h3>${Object.entries(examples).map(([key, item]) => button(`<small>REQ-${item.number} · 待开发</small><span>${item.title}</span>`, 'sample', (state.scenario === 'video' ? key === 'video' : key === 'image') ? 'active' : '', `data-value="${key}"`)).join('')}</aside><div class="detail-body"><header class="page-head">${heading}</header>${upgrade('banner')}<div class="issue-grid">${bodyContent()}<aside class="detail-sidebar">${processPanel(true)}${facts()}</aside></div><footer class="context-actionbar"><div><strong>${status()} · ${state.submitted ? state.reviewer : state.executor}</strong><small>${state.notice || '当前处理人负责推进'}</small></div><div class="row">${eligible() ? button(state.assigned || state.scenario === 'video' ? '查看开发任务' : '指派', state.assigned || state.scenario === 'video' ? 'task' : 'assign') : ''}${state.submitted ? button('查看交付与验收', 'delivery', 'primary') : eligible() ? button('线下处理', 'offline', 'primary') : button('完成评审', 'review', 'primary')}</div></footer></div></div>`;
    return `${scenarioPicker()}<header class="page-head">${heading}${button(icon('edit')+'编辑事项', 'edit', 'quiet head-actions')}</header><div class="issue-grid">${bodyContent()}<aside class="detail-sidebar">${processPanel()}${facts()}${upgrade()}</aside></div>`;
  }
  function offlineForm(inDialog = true) {
    return `<div class="offline-context">${icon('issue')}<div><strong class="small">${sample().title}</strong><small>REQ-${sample().number} · ${status()} → 待验证</small></div></div><form id="offline-form" class="form offline-form" data-form="offline"><div class="offline-columns"><div class="form"><label>交付标题 <input name="title" maxlength="200" required value="${esc(sample().title)}"></label><label>交付说明 <span class="hint">填写已完成的工作、处理结果及相关证据。</span><textarea name="body" rows="5" required placeholder="例如：已调整图生图提示词配置，保留原图文字设计，关闭额外营销文案生成。"></textarea></label><label>验证结果<textarea name="verification" rows="3" placeholder="填写检查方法、结果与尚待确认的问题。"></textarea></label><label>提交标识（可选）<input name="commit" placeholder="提交号、版本号或其他成果标识"></label></div><aside class="offline-side"><h3>送验安排</h3><label>验证人 <select name="reviewer" required><option value="">选择验证人</option><option value="qa">许宁 · 测试负责人</option><option value="owner">林悦 · 业务验收人</option></select></label><div class="handoff-path"><span class="pill">${status()}</span>${icon('arrow')}<span class="pill current">待验证</span></div><div class="form-section"><h3>共享范围</h3><label class="check"><input type="checkbox" name="share" required><span>我确认将成果说明和验证结果共享给项目成员。</span></label><p>交付说明、验证结果和提交信息对有协作权限的项目成员可见。</p></div></aside></div>${inDialog ? '' : `<div class="form-actions">${button('返回事项', 'issue-tab', '', 'data-value="content"')}<button class="primary" type="submit">提交并送验</button></div>`}</form>`;
  }
  function developmentPage() {
    const filtered = tasks.filter(task => (state.taskFilter === 'all' || state.taskFilter === 'cancelled' ? state.taskFilter === 'all' || task.status === '已取消' : task.status !== '已取消') && task.title.includes(state.search));
    const filters = `<div class="filters"><label class="search">${icon('search')}<input id="task-search" aria-label="搜索开发任务" data-change="search" placeholder="搜索开发任务" value="${esc(state.search)}"></label><select data-change="task-filter" aria-label="开发任务状态">${options([['not-cancelled', '未取消 · 默认'], ['all', '全部状态'], ['cancelled', '已取消']], state.taskFilter)}</select><span class="muted small">${state.taskFilter === 'not-cancelled' ? '已隐藏已取消任务' : '按所选状态展示任务'}</span></div>`;
    const table = `<table class="task-table"><thead><tr><th>开发任务</th><th>状态</th><th>执行人</th><th>更新于</th><th></th></tr></thead><tbody>${filtered.map(task => `<tr><td><strong>${task.title}</strong><small>DEV-${task.id} · 创意协作平台 · v0.8.2</small></td><td data-label="状态">${pill(task.status, task.tone)}</td><td data-label="执行人">${task.owner}</td><td data-label="更新于"><span class="muted small">${task.date}</span></td><td>${button('查看任务 '+icon('arrow'), 'task', 'link', `data-value="${task.id}"`)}</td></tr>`).join('')}</tbody></table>`;
    const list = `<div class="task-list">${filtered.map(task => `<article class="task-entry"><div><h3>${task.title}</h3><div class="meta"><span>DEV-${task.id}</span><span>v0.8.2</span><span>${task.owner}</span><span>${task.date}</span></div></div><div class="row">${pill(task.status, task.tone)}${button('查看任务', 'task', 'quiet', `data-value="${task.id}"`)}</div></article>`).join('')}</div>`;
    return `<header class="page-head"><div><div class="eyebrow">DEVELOPMENT</div><h1>我的开发</h1><p>查看已分配的任务，选择何时开始开发。</p></div>${button('＋ 独立开发', 'new-task', 'head-actions')}</header>${filters}${filtered.length ? (state.proposal === 'b' ? list : table) : '<div class="empty-hint">没有符合条件的任务。</div>'}<p class="task-count">共 ${filtered.length} 个任务${state.taskFilter === 'not-cancelled' ? ' · 1 个已取消任务已隐藏' : ''}</p>`;
  }
  const nodes = { review: ['待评审', '业务负责人', 'issue'], ready: ['待开发', '开发负责人', 'clock'], development: ['开发中', '开发负责人', 'code'], verify: ['待验证', '本轮验证人', 'circle'], done: ['已完成', '业务负责人', 'check'] };
  function node(id) { const value = nodes[id]; return button(`<span class="node-icon">${icon(value[2])}</span><span>${value[0]}<small>${value[1]}</small></span>`, 'node', `flow-node ${state.selectedNode === id ? 'active' : ''}`, `data-value="${id}" aria-label="选择${value[0]}节点"`); }
  function graph() { return `<section class="graph-area" aria-label="流程画布"><div class="graph-caption"><span>${state.workflowType === 'bug' ? 'Bug' : '需求'}流程 · 草稿</span><span>点击状态查看属性</span></div><div class="flow">${node('review')}<div class="connector"><span>评审通过</span></div>${node('ready')}<div class="branch-flow"><div class="branch-path">${node('development')}<small>开始开发 → 提交交付</small></div><div class="branch-path"><div class="flow-action">线下处理<small>提交已有成果并送验</small></div><small>复用已有成果送验流程</small></div></div>${node('verify')}<div class="connector"><span>验证通过</span></div>${node('done')}</div><div class="graph-legend"><span><i class="legend-node"></i>事项状态</span><span><i class="legend-action"></i>处理操作</span></div></section>`; }
  function inspector() {
    const n = nodes[state.selectedNode];
    return `<aside class="inspector"><header><div class="row between"><h2>状态属性</h2><span class="pill">草稿</span></div><p>选中状态 · ${n[0]}</p></header><div class="form"><label>状态名称<input value="${n[0]}" data-change="node-name" aria-label="状态名称"></label><label>处理职责<select data-change="node-setting">${options([['developer', '开发负责人'], ['business', '业务负责人'], ['qa', '测试负责人'], ['reviewer', '本轮验证人']], state.selectedNode === 'review' || state.selectedNode === 'done' ? 'business' : state.selectedNode === 'verify' ? 'reviewer' : 'developer')}</select></label><label>工作类别<select data-change="node-setting">${options([['development', '开发'], ['review', '规划与评审'], ['verification', '测试与验收']], state.selectedNode === 'review' ? 'review' : state.selectedNode === 'verify' ? 'verification' : 'development')}</select></label><div class="form-section"><h3>可用操作</h3><label class="check"><input type="checkbox" ${state.selectedNode === 'ready' ? 'checked' : ''} data-change="node-setting">允许认领或指派</label><label class="check"><input type="checkbox" ${state.selectedNode === 'ready' ? 'checked' : ''} data-change="node-setting">允许开始开发</label></div><div class="form-section"><h3>交接规则</h3><p class="hint">${state.selectedNode === 'ready' ? '提交已有成果后，进入待验证并交给本轮验证人。' : '流转时按照目标节点职责确定下一处理人。'}</p>${button('预览交接 '+icon('arrow'), 'preview', 'link')}</div></div></aside>`;
  }
  function workflowTools() { return `<div class="toolbar"><div class="row"><div class="segmented">${button('需求流程', 'workflow-type', state.workflowType === 'requirement' ? 'active' : '', 'data-value="requirement"')}${button('Bug 流程', 'workflow-type', state.workflowType === 'bug' ? 'active' : '', 'data-value="bug"')}</div><span class="pill">${state.published ? '已发布 v3' : '已发布 v2'}</span></div><div class="row">${button(icon('folder')+'流程模板', 'template', 'quiet')}${button(icon('play')+'交接预览', 'preview', 'quiet')}</div></div>`; }
  function workflowPage() {
    const header = `<header class="page-head"><div><div class="eyebrow">WORKFLOW</div><h1>流程编排</h1><p>定义事项的状态、操作与交接规则。</p></div><div class="row head-actions"><span class="muted small" data-draft-label>${state.dirty ? '有未保存修改' : '草稿已保存'}</span>${button('保存草稿', 'save')}${button('发布版本', 'publish', 'primary')}</div></header>`;
    const footer = `<footer class="workflow-foot"><span>新事项使用最新已发布版本。</span><span>已有事项可在符合条件时采用新版本。</span></footer>`;
    if (state.proposal === 'b') return `${header}<nav class="stage-tabs" aria-label="流程工作区">${[['design', '流程设计'], ['preview', '交接预览'], ['publish', '版本发布']].map(([key, label], index) => button(`<span class="step-number">${index + 1}</span>${label}`, 'workflow-tab', state.workflowTab === key ? 'active' : '', `data-value="${key}"`)).join('')}</nav>${state.workflowTab === 'design' ? `${workflowTools()}<div class="workflow-body">${graph()}${inspector()}</div>` : `<div class="paper" style="max-width:920px;margin:auto">${state.workflowTab === 'preview' ? `<h2>交接预览</h2><p class="muted small">选择状态与操作，核对下一步的状态和处理人。</p>${previewForm()}` : `<h2>版本发布</h2>${publishContent(false)}`}</div>`}${footer}`;
    if (state.proposal === 'c') return `${header}<div class="workflow-workbench"><aside class="workflow-library"><h3>流程与版本</h3><div class="library-items">${button('需求流程', 'workflow-type', state.workflowType === 'requirement' ? 'active' : '', 'data-value="requirement"')}${button('Bug 流程', 'workflow-type', state.workflowType === 'bug' ? 'active' : '', 'data-value="bug"')}</div><div class="divider"></div><h3>版本</h3><div class="library-items">${button('当前草稿', 'draft', 'active')}${button('v2 · 已发布', 'version', '', 'data-value="v2"')}${button('v1 · 历史版本', 'version', '', 'data-value="v1"')}</div><div class="divider"></div>${button(icon('folder')+'流程模板', 'template', 'quiet')}</aside><div style="min-width:0"><div class="toolbar"><span class="muted small">当前草稿 · ${state.workflowType === 'bug' ? 'Bug' : '需求'}流程</span>${button(icon('play')+'交接预览', 'preview')}</div><div class="workflow-body">${graph()}${inspector()}</div></div></div>${footer}`;
    return `${header}${workflowTools()}<div class="workflow-body">${graph()}${inspector()}</div>${footer}`;
  }
  function previewForm() { return `<form class="form" style="margin-top:24px" data-form="preview"><label>当前状态<select name="from" data-change="preview">${options([['ready', '待开发'], ['review', '待评审'], ['verify', '待验证']], 'ready')}</select></label><label>处理操作<select name="event" data-change="preview">${options([['offline', '线下处理 · 提交并送验'], ['start', '开始开发'], ['accept', '验证通过']], 'offline')}</select></label><div id="preview-result">${previewResult('ready', 'offline')}</div><p class="hint">这是规则预览；实际提交时还会核对资料和人员权限。</p></form>`; }
  function previewResult(from, event) {
    const matches = { 'ready-offline': ['待开发', '待验证', '许宁', '本轮验证人', '交付说明、验证人、共享确认'], 'ready-start': ['待开发', '开发中', '陈宇', '当前开发执行人', '开发空间与启动确认'], 'verify-accept': ['待验证', '已完成', '林悦', '业务负责人', '验证结论'] };
    const value = matches[`${from}-${event}`];
    if (!value) return '<div class="preview-card"><h3>这个状态没有配置所选操作</h3><p class="hint">请选择其他状态或处理操作。</p></div>';
    return `<div class="preview-card"><div class="handoff-path"><span class="pill">${value[0]}</span>${icon('arrow')}<span class="pill current">${value[1]}</span></div><p class="hint">提交时需要：${value[4]}</p><div class="handoff-person"><span class="avatar">${value[2][0]}</span><div><strong>${value[2]}</strong><p class="hint">下一处理人 · ${value[3]}</p></div></div></div>`;
  }
  function publishContent(inDialog = true) { return `<div class="publish-summary"><div class="row between"><strong>将发布 v${state.published ? '4' : '3'}</strong><span class="pill current">${state.workflowType === 'bug' ? 'Bug' : '需求'}流程</span></div><ul class="check-list"><li>${icon('circle')}<span>状态与交接规则已检查</span></li><li>${icon('circle')}<span>待开发支持线下处理并提交验证</span></li><li>${icon('circle')}<span>验证和退回沿用现有规则</span></li></ul></div><p class="hint" style="margin:18px 0">发布后，新事项使用此版本；已有事项保留当前版本，可按条件主动采用新版本。</p><form id="publish-form" data-form="publish" class="form"><label class="check"><input type="checkbox" required name="confirm"><span>我已核对本次流程变更及影响范围。</span></label>${inDialog ? '' : '<div class="form-actions"><button class="primary" type="submit">确认发布版本</button></div>'}</form>`; }
  function openDialog(title, content, footer = '', { wide = false, sheet = false, subtitle = '' } = {}) {
    returnFocus = document.activeElement;
    if (dialog.open) dialog.close();
    dialog.className = [wide ? 'wide' : '', sheet ? 'sheet' : ''].join(' ');
    dialog.innerHTML = `<header class="dialog-heading"><div><h2 id="dialog-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${button(icon('close'), 'close', 'icon-button quiet', 'aria-label="关闭弹窗"')}</header><div class="dialog-content">${content}</div>${footer ? `<footer class="dialog-footer">${footer}</footer>` : ''}`;
    translate(dialog); dialog.showModal();
  }
  function closeDialog() { if (!dialog.open) return; dialog.close(); if (returnFocus?.isConnected) returnFocus.focus(); }
  function toast(message) { const el = document.getElementById('toast'); el.textContent = translated(message); el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4200); }
  function showOffline() {
    if (!eligible()) return;
    if (state.proposal === 'b') { state.issueTab = 'offline'; render(); document.getElementById('offline-form').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    openDialog('线下处理', offlineForm(), `${button('取消', 'close')}<button type="submit" form="offline-form" class="primary">提交并送验</button>`, { wide: true, sheet: state.proposal === 'c', subtitle: '填写已完成的成果，选择验证人后送验。' });
  }
  function showUpgrade() {
    if (!hasUpgrade()) return;
    openDialog('采用新流程版本', `<p>核对版本变化后，将当前事项切换至新版本。</p><div class="comparison"><div><small>当前版本</small><b>v1</b><span class="small">${status()}</span></div>${icon('arrow')}<div class="target"><small>新版本</small><b>v2</b><span class="small">${status()}</span></div></div><div class="publish-summary"><h3>本次变化</h3><p class="hint">待开发支持线下处理送验，验证和退回规则保持一致。</p><div class="divider"></div><p class="hint">当前处理人 · 陈宇<br>原事项、关联任务和历史记录会保留。</p></div><form id="upgrade-form" class="form" data-form="upgrade" style="margin-top:20px"><label>采用原因<textarea name="reason" rows="2" required placeholder="说明本次采用新流程的原因"></textarea></label><label class="check"><input type="checkbox" required><span>我已核对版本变化和当前处理人。</span></label></form>`, `${button('取消', 'close')}<button class="primary" type="submit" form="upgrade-form">确认采用新版本</button>`);
  }
  function showTemplate() { openDialog('流程模板', `<p>选择模板，预览对当前草稿的影响。</p><div class="template-option"><div class="row between"><strong>标准协作流程</strong><span class="pill current">推荐</span></div><p>覆盖评审、待开发、开发、验证与完成。待开发支持线下处理送验。</p></div><h3>应用范围</h3><ul class="check-list"><li>${icon('check')}<span>替换当前草稿中的状态与交接规则</span></li><li>${icon('check')}<span>载入后仍可编辑，再保存或发布</span></li></ul><p class="hint">当前未保存的草稿内容会被替换，已发布版本继续保留。</p>`, `${button('取消', 'close')}${button('载入到草稿', 'apply-template', 'primary')}`, { sheet: state.proposal === 'c' }); }
  function showPreview() { if (state.proposal === 'b') { state.workflowTab = 'preview'; render(); return; } openDialog('交接预览', previewForm(), button('完成预览', 'close'), { sheet: true, subtitle: '核对状态变化、交接资料与下一处理人。' }); }
  function showPublish() { if (state.proposal === 'b') { state.workflowTab = 'publish'; render(); return; } openDialog('发布流程版本', publishContent(), `${button('返回编辑', 'close')}<button class="primary" type="submit" form="publish-form">确认发布版本</button>`); }
  function compare() { openDialog('三种界面方案', `<div class="compare-grid">${Object.entries(proposals).map(([key, value]) => `<article class="${key === 'a' ? 'recommended' : ''}"><span class="eyebrow">方案 ${key.toUpperCase()}${key === 'a' ? ' · 推荐' : ''}</span><h2>${value.name}</h2><p>${value.description}</p><ul>${(key === 'a' ? ['事项：右侧处理区＋集中送验弹窗', '流程：主画布＋按需展开工具', '优点：上下文完整、学习成本低', '取舍：小屏时处理区上下排列'] : key === 'b' ? ['事项：页内切换同一份送验表单', '流程：设计、预览、发布分区', '优点：长内容和大表单更舒展', '取舍：切换工作区的次数更多'] : ['事项：列表详情同屏＋侧边表单', '流程：版本、画布、属性并列', '优点：便于连续处理多个事项', '取舍：桌面信息密度更高']).map(text => `<li>${text}</li>`).join('')}</ul>${button('查看方案 '+key.toUpperCase(), 'proposal', key === 'a' ? 'primary' : '', `data-value="${key}"`)}</article>`).join('')}</div><p class="hint" style="margin-top:20px">三个方案使用同一业务流程。“线下处理”沿用已有成果的送验流程，不新增事项状态。开发默认排除已取消任务。</p>`, button('返回原型', 'close'), { wide: true }); }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]'); if (!target) return;
    const { action, value } = target.dataset;
    switch (action) {
      case 'proposal': navigate(value); break;
      case 'page': if (['issue', 'development', 'workflow'].includes(value)) navigate(state.proposal, value); else toast('此原型重点展示事项、开发与流程编排。'); break;
      case 'compare': compare(); break;
      case 'locale': state.locale = state.locale === 'zh' ? 'en' : 'zh'; closeDialog(); render(); break;
      case 'reset': Object.assign(state, { scenario: 'image', assigned: false, submitted: false, executor: '陈宇', reviewer: '许宁', latest: false, issueTab: 'content', workflowTab: 'design', selectedNode: 'ready', dirty: false, templateLoaded: false, published: false, taskFilter: 'not-cancelled', search: '', notice: '', recordTab: 'discussion' }); render(); toast('演示已重置。'); break;
      case 'close': closeDialog(); break;
      case 'offline': showOffline(); break;
      case 'upgrade': showUpgrade(); break;
      case 'assign': openDialog('指派开发负责人', `<p>${sample().title}</p><form id="assign-form" class="form" data-form="assign" style="margin-top:24px"><label>开发负责人<select name="executor" required><option value="chen">陈宇</option><option value="zhou">周辰</option></select></label><p class="hint">指派后加入负责人的待开发任务。你将继续留在当前事项。</p></form>`, `${button('取消', 'close')}<button class="primary" form="assign-form" type="submit">确认指派</button>`); break;
      case 'issue-tab': state.issueTab = value; render(); break;
      case 'record-tab': state.recordTab = value; render(); break;
      case 'sample': state.scenario = value; state.submitted = false; state.assigned = value === 'video'; state.notice = ''; state.issueTab = 'content'; render(); break;
      case 'review': state.scenario = 'image'; state.notice = '评审已完成，事项进入待开发。'; render(); toast(state.notice); break;
      case 'more': openDialog('更多操作', `<div class="stack">${button('指派开发负责人', 'assign')}${button('查看流程版本', 'workflow-info')}${button('查看处理历史', 'history')}</div>`, button('返回事项', 'close')); break;
      case 'history': closeDialog(); state.recordTab = 'history'; render(); break;
      case 'workflow-info': openDialog('流程版本', `<p>当前事项使用 ${state.latest || state.scenario === 'latest' ? 'v2' : 'v1'}。</p>${hasUpgrade() ? upgrade('banner') : '<p class="hint">已采用最新的已发布版本。</p>'}`, button('关闭', 'close')); break;
      case 'task': { const task = tasks.find(item => item.id === Number(value)) || tasks[0]; openDialog('开发任务', `<span class="pill ${task.tone}">${task.status}</span><h2 style="margin-top:16px">${task.title}</h2><p class="hint" style="margin-top:16px">执行人 · ${task.owner}<br>此原型仅展示任务入口，正式开发需在任务页面明确启动。</p>`, button('返回', 'close')); break; }
      case 'delivery': openDialog('交付与验收', `<span class="pill current">待验证</span><h2 style="margin:16px 0">${sample().title}</h2><p>成果已提交，${state.reviewer}为本轮验证人。</p><p class="hint" style="margin-top:14px">验证通过或退回后，会继续按原流程更新事项。</p>`, button('关闭', 'close')); break;
      case 'edit': toast('当前展示阅读与处理布局；编辑表单沿用现有界面。'); break;
      case 'comment': toast('讨论入口演示：正式实现保留现有讨论功能。'); break;
      case 'new-task': toast('独立开发沿用现有创建流程。'); break;
      case 'workflow-type': state.workflowType = value; state.selectedNode = 'ready'; render(); break;
      case 'workflow-tab': state.workflowTab = value; render(); break;
      case 'node': state.selectedNode = value; render(); break;
      case 'template': showTemplate(); break;
      case 'apply-template': state.templateLoaded = true; state.dirty = true; state.selectedNode = 'ready'; state.workflowTab = 'design'; closeDialog(); render(); toast('模板已载入草稿，可继续编辑。'); break;
      case 'preview': showPreview(); break;
      case 'save': state.dirty = false; render(); toast('流程草稿已保存。'); break;
      case 'publish': showPublish(); break;
      case 'draft': state.workflowTab = 'design'; render(); break;
      case 'version': openDialog(value+' · 已发布流程', `<p>此版本包含评审、待开发、开发、验证和完成状态。</p><p class="hint" style="margin-top:14px">已发布版本用于历史追溯；继续编辑请返回当前草稿。</p>`, button('返回草稿', 'close')); break;
    }
  });
  document.addEventListener('change', event => {
    const target = event.target, kind = target.dataset.change;
    if (kind === 'scenario') { state.scenario = target.value; state.executor = '陈宇'; state.reviewer = '许宁'; state.assigned = target.value === 'video'; state.submitted = false; state.latest = false; state.notice = ''; state.issueTab = 'content'; render(); }
    if (kind === 'task-filter') { state.taskFilter = target.value; render(); }
    if (kind === 'search') { state.search = target.value; render(); }
    if (kind === 'node-setting' || kind === 'node-name') { state.dirty = true; const label = root.querySelector('[data-draft-label]'); if (label) label.textContent = translated('有未保存修改'); }
    if (kind === 'preview') { const form = target.closest('form'); form.querySelector('#preview-result').innerHTML = previewResult(form.elements.from.value, form.elements.event.value); translate(form); }
  });
  document.addEventListener('submit', event => {
    const kind = event.target.dataset.form; if (!kind) return; event.preventDefault();
    if (!event.target.reportValidity()) return;
    const data = new FormData(event.target);
    if (kind === 'assign') { state.assigned = true; state.executor = data.get('executor') === 'zhou' ? '周辰' : '陈宇'; state.notice = `已指派给${state.executor}，已加入其待开发任务。`; closeDialog(); render(); toast(state.notice); }
    if (kind === 'offline') { state.submitted = true; state.reviewer = data.get('reviewer') === 'owner' ? '林悦' : '许宁'; state.issueTab = 'content'; state.notice = '成果已送验，待办已交接给验证人。'; closeDialog(); render(); toast(state.notice); }
    if (kind === 'upgrade') { state.latest = true; closeDialog(); render(); toast('事项已采用新流程版本。'); }
    if (kind === 'publish') { state.dirty = false; state.published = true; state.workflowTab = 'design'; closeDialog(); render(); toast('新流程版本已发布。'); }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); });
  const english = {
    'DevLoom · 界面评审': 'DevLoom · Design review', '三个方案 / 同一业务流程': 'Three layouts / One workflow', '推荐': 'Recommended',
    'A · 侧栏办理': 'A · Context panel', 'B · 页内办理': 'B · In-page form', 'C · 抽屉办理': 'C · Side drawer',
    '方案对比': 'Compare', '重置演示': 'Reset demo', '交互原型 · 模拟数据': 'Interactive prototype · Sample data',
    '事项右侧集中操作，流程工具按需展开。保留阅读上下文，主次清晰。': 'Actions stay beside the issue. Workflow tools open when needed.',
    '事项内容与成果表单在页内切换，流程设计、预览、发布各占一个工作区。': 'Switch between issue content and the delivery form. Separate workflow design, preview and publishing.',
    '列表与详情同屏，线下处理在侧边抽屉完成；流程采用版本、画布、属性三栏。': 'Read issues beside the list and submit in a drawer. Versions, canvas and properties share one workspace.',
    '工作台': 'Workbench', '项目': 'Projects', '事项': 'Issues', '开发': 'Development', '交付': 'Deliveries', '管理中心': 'Administration',
    '创意协作空间': 'Creative workspace', '事项详情': 'Issue details', '我的开发': 'My development', '流程编排': 'Workflow editor',
    '事项处理': 'Issue actions', '开发列表': 'Development list', '演示场景': 'Demo scenario', '切换查看入口的显示条件': 'Explore when actions are available',
    '图生图 · 待开发': 'Image generation · Ready', '视频下载 · 已指派': 'Video download · Assigned', '待评审 · 尚未到待开发': 'Awaiting review · Not ready', '已是最新流程版本': 'Latest workflow version',
    '需求': 'Requirement', '需求描述': 'Description', '验收标准': 'Acceptance criteria', '参考资料': 'References', '讨论': 'Discussion', '历史': 'History', '发送讨论': 'Send',
    '编辑事项': 'Edit issue', '当前处理': 'Current work', '当前处理人': 'Current handler', '待开发': 'Ready for development', '待评审': 'Awaiting review', '待验证': 'Awaiting verification',
    '开发中': 'In development', '已完成': 'Completed', '已取消': 'Cancelled', '线下处理': 'Offline handling', '查看开发任务': 'View development task', '指派': 'Assign', '更多操作': 'More actions',
    '完成线下工作后，填写成果并提交验证。': 'Record completed work and submit it for verification.', '评审通过并进入待开发后，可使用线下处理。': 'Offline handling becomes available after review, when development is ready.',
    '事项信息': 'Issue information', '所属项目': 'Project', '业务负责人': 'Business owner', '开发负责人': 'Developer', '测试负责人': 'QA owner', '待指派': 'Unassigned', '优先级': 'Priority',
    '目标版本': 'Release', '流程版本': 'Workflow version', '流程版本 v1': 'Workflow v1', '新版本 v2': 'New version v2', '采用新流程版本': 'Adopt new workflow version',
    '当前事项使用 v1，可先查看版本变化。': 'This issue uses v1. Review the changes before adopting v2.', '有新的已发布流程版本 v2': 'Published workflow v2 is available',
    '完成评审': 'Complete review', '事项内容': 'Issue content', '返回事项': 'Back to issue', '当前处理人负责推进': 'The current handler owns the next action',
    '填写已完成的成果，选择验证人后送验。': 'Describe completed work and select a verifier.', '交付标题': 'Delivery title', '交付说明': 'Delivery description',
    '填写已完成的工作、处理结果及相关证据。': 'Describe completed work, results and supporting evidence.', '验证结果': 'Verification results', '提交标识（可选）': 'Reference (optional)',
    '填写检查方法、结果与尚待确认的问题。': 'Record checks, outcomes and open questions.', '提交号、版本号或其他成果标识': 'Commit, version or another result reference',
    '送验安排': 'Verification', '验证人': 'Verifier', '选择验证人': 'Select verifier', '共享范围': 'Sharing', '我确认将成果说明和验证结果共享给项目成员。': 'I confirm sharing the description and verification results with project members.',
    '交付说明、验证结果和提交信息对有协作权限的项目成员可见。': 'Members with collaboration access can view the description, results and references.', '取消': 'Cancel', '提交并送验': 'Submit for verification',
    '指派开发负责人': 'Assign developer', '指派后加入负责人的待开发任务。你将继续留在当前事项。': 'Assignment adds a planned task for the developer. You stay on this issue.', '确认指派': 'Confirm assignment',
    '查看已分配的任务，选择何时开始开发。': 'Review assigned tasks and decide when to start.', '＋ 独立开发': '+ Independent task', '搜索开发任务': 'Search development tasks',
    '未取消 · 默认': 'Not cancelled · Default', '全部状态': 'All statuses', '已隐藏已取消任务': 'Cancelled tasks are hidden', '按所选状态展示任务': 'Showing the selected statuses',
    '开发任务': 'Development task', '状态': 'Status', '执行人': 'Executor', '更新于': 'Updated', '查看任务': 'View task', '没有符合条件的任务。': 'No matching tasks.',
    '定义事项的状态、操作与交接规则。': 'Define issue states, actions and handoff rules.', '有未保存修改': 'Unsaved changes', '草稿已保存': 'Draft saved', '保存草稿': 'Save draft', '发布版本': 'Publish version',
    '需求流程': 'Requirement workflow', 'Bug 流程': 'Bug workflow', '已发布 v2': 'Published v2', '已发布 v3': 'Published v3', '流程模板': 'Templates', '交接预览': 'Handoff preview',
    '点击状态查看属性': 'Select a state to inspect it', '需求流程 · 草稿': 'Requirement workflow · Draft', '状态属性': 'State properties', '草稿': 'Draft', '状态名称': 'State name',
    '处理职责': 'Handler role', '工作类别': 'Work category', '规划与评审': 'Planning & review', '测试与验收': 'Testing & acceptance', '可用操作': 'Available actions',
    '允许认领或指派': 'Allow claiming and assignment', '允许开始开发': 'Allow starting development', '交接规则': 'Handoff rules', '预览交接': 'Preview handoff',
    '提交已有成果后，进入待验证并交给本轮验证人。': 'Submitting existing results moves the issue to verification and assigns the verifier.',
    '流转时按照目标节点职责确定下一处理人。': 'The target state role determines the next handler.', '提交已有成果并送验': 'Submit existing results', '复用已有成果送验流程': 'Existing results workflow',
    '事项状态': 'Issue state', '处理操作': 'Action', '评审通过': 'Review approved', '验证通过': 'Verification passed', '本轮验证人': 'Current verifier', '开始开发 → 提交交付': 'Start development → Deliver',
    '新事项使用最新已发布版本。': 'New issues use the latest published version.', '已有事项可在符合条件时采用新版本。': 'Eligible existing issues can adopt a newer version.',
    '流程设计': 'Workflow design', '版本发布': 'Publishing', '当前草稿': 'Current draft', '流程与版本': 'Workflows & versions', '版本': 'Versions',
    '选择状态与操作，核对下一步的状态和处理人。': 'Choose a state and action to review the next state and handler.', '核对状态变化、交接资料与下一处理人。': 'Review state changes, required information and the next handler.',
    '当前状态': 'Current state', '线下处理 · 提交并送验': 'Offline handling · Submit', '开始开发': 'Start development', '完成预览': 'Close preview',
    '这是规则预览；实际提交时还会核对资料和人员权限。': 'This previews the rules. Submissions also validate information and permissions.',
    '这个状态没有配置所选操作': 'This action is not configured for the state', '请选择其他状态或处理操作。': 'Choose another state or action.',
    '选择模板，预览对当前草稿的影响。': 'Choose a template and review its effect on the draft.', '标准协作流程': 'Standard collaboration workflow',
    '覆盖评审、待开发、开发、验证与完成。待开发支持线下处理送验。': 'Includes review, preparation, development, verification and completion. Supports offline submissions when ready.',
    '应用范围': 'Scope', '替换当前草稿中的状态与交接规则': 'Replace the draft states and handoff rules', '载入后仍可编辑，再保存或发布': 'Edit the loaded draft, then save or publish',
    '当前未保存的草稿内容会被替换，已发布版本继续保留。': 'Unsaved draft contents will be replaced. Published versions remain available.', '载入到草稿': 'Load into draft',
    '发布流程版本': 'Publish workflow version', '状态与交接规则已检查': 'States and handoff rules checked', '待开发支持线下处理并提交验证': 'Ready issues support offline handling and verification',
    '验证和退回沿用现有规则': 'Verification and returns use existing rules', '发布后，新事项使用此版本；已有事项保留当前版本，可按条件主动采用新版本。': 'New issues will use this version. Existing issues keep their current version and may adopt the new version when eligible.',
    '我已核对本次流程变更及影响范围。': 'I have reviewed the changes and their scope.', '确认发布版本': 'Confirm publication', '返回编辑': 'Back to editing',
    '核对版本变化后，将当前事项切换至新版本。': 'Review the changes before adopting the new version.', '当前版本': 'Current version', '新版本': 'New version', '本次变化': 'Changes',
    '采用原因': 'Reason', '说明本次采用新流程的原因': 'Explain why this issue should adopt the new workflow', '我已核对版本变化和当前处理人。': 'I have reviewed the version changes and current handler.',
    '确认采用新版本': 'Adopt version', '查看交付与验收': 'View delivery & verification', '成果已送验，等待验证结果。': 'Submitted and awaiting verification.', '关闭': 'Close', '返回': 'Back',
  };
  function translated(text) { return state.locale === 'en' ? (english[text] || text) : text; }
  function translate(scope) {
    document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN';
    if (state.locale !== 'en') return;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) { const original = text.nodeValue.trim(); if (english[original]) text.nodeValue = text.nodeValue.replace(original, english[original]); }
    scope.querySelectorAll('[placeholder], [aria-label], [data-label]').forEach(el => { for (const attr of ['placeholder', 'aria-label', 'data-label']) { const value = el.getAttribute(attr); if (english[value]) el.setAttribute(attr, english[value]); } });
  }
  window.addEventListener('hashchange', route);
  route();
})();
