/* Standalone review prototype. All data is local; no business requests. */
(() => {
  const $ = (value) => document.querySelector(value);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const en = {
    '事项': 'Issues', '开发': 'Development', '交付': 'Deliveries', '工作台': 'Home', '项目': 'Projects',
    'A · 常驻筛选条': 'A · Filter bar', 'B · 条件标签': 'B · Filter chips', 'C · 侧边筛选': 'C · Side panel',
    '高频条件直接展开，适合日常快速查找。': 'Frequent filters stay visible for quick everyday searches.',
    '按需添加条件，让列表保留更多纵向空间。': 'Add only the filters you need and keep more room for the list.',
    '筛选与结果左右对照，适合反复调整多个条件。': 'Compare filters and results side by side while refining your search.',
    '从清晰的表达开始，一起把问题推进到完成。': 'Turn clear requirements into shared progress.',
    '继续已有任务，或开始新的开发。': 'Continue existing tasks or start new development.',
    '把完成的工作，变成可验证的结果。': 'Review completed work and verify the outcome.',
    '新建事项': 'New issue', '独立开发': 'Independent task', '发布交付': 'Publish delivery', '从事项开发': 'Develop an issue',
    '全部': 'All', '需求': 'Requirements', '缺陷': 'Bugs', '我的任务': 'My tasks', '项目全部任务': 'Project tasks',
    '待验证': 'Pending review', '已通过': 'Accepted', '已退回': 'Returned', '验证中': 'Under review',
    '版本': 'Release', '状态': 'Status', '事项状态': 'Issue status', '任务状态': 'Task status', '优先级': 'Priority',
    '负责人': 'Assignee', '提报人': 'Reporter', '提交人': 'Submitted by', '开发负责人': 'Development owner', '执行者': 'Executor',
    '全部版本': 'All releases', '全部状态': 'All statuses', '全部优先级': 'All priorities', '全部负责人': 'All assignees', '全部提报人': 'All reporters',
    '未排期': 'Unscheduled', '未取消': 'Not cancelled', '待分派': 'Unassigned', '无关联事项': 'No linked issues', '历史成员': 'Former member',
    '待开发': 'Planned', '开发中': 'In development', '已启动': 'Started', '已完成': 'Completed', '已合并': 'Merged', '已取消': 'Cancelled', '执行结果待确认': 'Execution unconfirmed',
    '规划中': 'Planning', '已关闭': 'Closed', '普通': 'Normal', '高': 'High', '紧急': 'Urgent', '低': 'Low',
    '筛选': 'Filters', '添加条件': 'Add filter', '清空筛选': 'Clear filters', '重置': 'Reset', '清除': 'Clear', '完成': 'Done',
    '收起': 'Hide', '搜索标题、编号': 'Search title or number', '搜索选项': 'Search options', '没有匹配的选项': 'No matching options',
    '不同条件同时满足，同一条件可多选。': 'Match every filter; select multiple values within each.',
    '默认排除已取消任务': 'Cancelled tasks excluded by default', '包含已取消任务': 'Include cancelled tasks',
    '按最近更新排序': 'Recently updated first', '条结果': 'results', '查看': 'View', '查看需求': 'View issue',
    '未关联事项': 'No linked issues', '关联': 'Linked', '条事项': 'issues', '最近更新': 'Updated',
    '上一页': 'Previous', '下一页': 'Next', '当前项目': 'Current project', '仅显示可访问的内容': 'Showing accessible content',
    '没有符合条件的内容': 'No matching results', '试试减少筛选条件，或使用其他关键词。': 'Remove a filter or try another keyword.',
    '无法读取列表': 'Unable to load the list', '筛选条件已保留，请重试。': 'Your filters are preserved. Please try again.', '重试': 'Retry',
    '正在读取列表…': 'Loading list…', '当前版本已归档，仅可查看。': 'This release is archived and read-only.',
    '关闭': 'Close', '开发范围': 'Development scope', '纳入任务时的事项内容': 'Issue content captured when added',
    '问题描述': 'Description', '目标与背景': 'Goal and background', '验收标准': 'Acceptance criteria', '来源事项': 'Source issue',
    '图片附件': 'Image attachment', '点击放大': 'Click to enlarge', '查看原图': 'View original', '图片暂时无法加载': 'Image unavailable',
    '请重试，或前往来源事项查看附件。': 'Retry or open the source issue to view its attachment.', '模拟图片失败': 'Simulate image error',
    '列表筛选 · 方案评审': 'List filters · Design review', '交互原型 / 模拟数据': 'Interactive prototype / Sample data',
    '常规内容': 'Standard', '长内容': 'Long content', '无结果': 'No results', '加载中': 'Loading', '读取失败': 'Load failure', '归档只读': 'Archived',
    '本轮原型范围': 'Prototype scope', '此入口沿用现有流程；本轮演示列表、筛选与需求图片查看。': 'This entry keeps the existing workflow. This prototype covers lists, filters, and issue images.',
    '返回列表': 'Back to list', '查看结果': 'Show results', '移除条件': 'Remove filter', '未选择': 'Not selected',
  };
  let lang = 'zh';
  const t = s => lang === 'en' ? en[s] || s : s;
  const names = { chen: '陈亦', lin: '林晓', zhou: '周宁', wang: '王悦', sun: '孙可', former: '历史成员' };
  const releases = { v041: 'v0.4.1', v042: 'v0.4.2', v050: 'v0.5.0 · 客户协作与交付体验优化', none: '未排期' };
  const iconPaths = {
    home: '<path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/>',
    projects: '<path d="M3 6h7l2 3h9v11H3z"/>',
    issues: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
    tasks: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    deliveries: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
    filter: '<path d="M3 6h18M6 12h12M9 18h6"/>',
  };
  const icon = key => `<svg ${key === 'filter' ? 'class="filter-icon"' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[key]}</svg>`;
  const base = [
    { id: 68, title: '平台模型配置：默认模型弹框提示条与选项间距不足', type: 'bug', status: 'doing', taskStatus: 'started', deliveryStatus: 'pending', priority: 'normal', version: 'v041', owner: 'chen', reporters: ['lin'], publisher: 'chen', count: 1, time: '今天 14:21' },
    { id: 72, title: '客户列表支持按手机号与姓名组合搜索', type: 'requirement', status: 'ready', taskStatus: 'planned', deliveryStatus: 'pending', priority: 'high', version: 'v041', owner: 'chen', reporters: ['wang'], publisher: 'chen', count: 1, time: '今天 13:48' },
    { id: 71, title: '交付验收与消息通知体验优化', type: 'requirement', status: 'verify', taskStatus: 'started', deliveryStatus: 'reviewing', priority: 'normal', version: 'v041', owner: 'chen', reporters: ['lin', 'zhou'], publisher: 'chen', count: 3, time: '今天 11:06' },
    { id: 69, title: '长标题在移动端遮挡底部操作按钮', type: 'bug', status: 'doing', taskStatus: 'planned', deliveryStatus: 'returned', priority: 'high', version: 'v042', owner: 'zhou', reporters: ['sun'], publisher: 'zhou', count: 1, time: '昨天 18:32' },
    { id: 66, title: '项目资料支持文件分类与批量下载', type: 'requirement', status: 'planning', taskStatus: 'planned', deliveryStatus: 'accepted', priority: 'low', version: 'none', owner: 'none', reporters: ['lin'], publisher: 'wang', count: 1, time: '昨天 16:40' },
    { id: 64, title: '统一项目成员显示名称与头像', type: 'requirement', status: 'closed', taskStatus: 'completed', deliveryStatus: 'accepted', priority: 'normal', version: 'v041', owner: 'chen', reporters: ['wang'], publisher: 'chen', count: 2, time: '10月24日' },
    { id: 63, title: '整理开发环境检查脚本', type: 'requirement', status: 'planning', taskStatus: 'planned', deliveryStatus: 'pending', priority: 'normal', version: 'none', owner: 'chen', reporters: [], publisher: 'chen', count: 0, time: '10月23日' },
    { id: 61, title: '旧版导出兼容性修复', type: 'bug', status: 'closed', taskStatus: 'cancelled', deliveryStatus: 'returned', priority: 'low', version: 'v042', owner: 'chen', reporters: ['former'], publisher: 'chen', count: 1, time: '10月22日' },
  ];
  const issueStates = { planning: '规划中', ready: '待开发', doing: '开发中', verify: '待验证', closed: '已关闭' };
  const taskStates = { planned: '待开发', started: '已启动', unknown: '执行结果待确认', completed: '已完成', merged: '已合并', cancelled: '已取消' };
  const deliveryStates = { pending: '待验证', reviewing: '验证中', accepted: '已通过', returned: '已退回' };
  const priorities = { urgent: '紧急', high: '高', normal: '普通', low: '低' };
  const variants = { a: ['A · 常驻筛选条', '高频条件直接展开，适合日常快速查找。'], b: ['B · 条件标签', '按需添加条件，让列表保留更多纵向空间。'], c: ['C · 侧边筛选', '筛选与结果左右对照，适合反复调整多个条件。'] };
  const configs = {
    issues: { title: '事项', description: '从清晰的表达开始，一起把问题推进到完成。', action: '新建事项', fields: ['version', 'status', 'priority', 'owner', 'reporter'], tabs: [['all', '全部'], ['requirement', '需求'], ['bug', '缺陷']] },
    tasks: { title: '开发', description: '继续已有任务，或开始新的开发。', action: '独立开发', fields: ['status', 'version', 'owner', 'reporter'], tabs: [['mine', '我的任务'], ['all', '项目全部任务']] },
    deliveries: { title: '交付', description: '把完成的工作，变成可验证的结果。', action: '发布交付', fields: ['version', 'reporter'], tabs: [['all', '全部'], ['pending', '待验证'], ['accepted', '已通过'], ['returned', '已退回']] },
  };
  const fieldLabels = { version: '版本', status: '状态', priority: '优先级', owner: '负责人', reporter: '提报人' };
  const allLabels = { version: '全部版本', status: '全部状态', priority: '全部优先级', owner: '全部负责人', reporter: '全部提报人' };
  const saved = {};
  let variant = 'a', kind = 'issues', scenario = 'normal', panelOpen = true, activeField = null, draft = [], pickerSearch = '', anchor = null, trigger = null, detailRow = null, imageError = false;
  function state() { return saved[kind] ||= { filters: {}, query: '', tab: kind === 'tasks' ? 'mine' : 'all', visible: configs[kind].fields.filter(f => ['version', 'status', 'reporter'].includes(f)) }; }
  function options(field) {
    if (field === 'version') return Object.entries(releases);
    if (field === 'status') return kind === 'tasks' ? [['all', '全部状态'], ...Object.entries(taskStates)] : Object.entries(issueStates);
    if (field === 'priority') return Object.entries(priorities);
    if (field === 'owner') return [...Object.entries(names).filter(([id]) => id !== 'former'), ['none', '待分派']];
    return [...Object.entries(names), ...(kind !== 'issues' ? [['none', '无关联事项']] : [])];
  }
  function labelFor(field, value) { return t(options(field).find(([id]) => id === value)?.[1] || value); }
  function displayName(id) { return scenario === 'long' && id === 'lin' ? '林晓 · 企业客户体验与业务协作负责人' : t(names[id] || '待分派'); }
  function records() {
    return base.filter(row => kind !== 'issues' || row.count).map(row => ({ ...row,
      title: scenario === 'long' && row.id === 68 ? '【客户反馈】跨项目协作管理：在 1080P、2K 与移动端统一筛选、提报人展示及包含多个来源事项的交付验证体验' : row.title,
      version: scenario === 'long' && row.id === 68 ? 'v050' : row.version,
      owner: kind === 'tasks' && row.owner === 'none' ? 'wang' : row.owner,
    }));
  }
  function filteredRows(filters = state().filters) {
    if (scenario === 'empty') return [];
    return records().filter(row => {
      if (kind === 'issues' && state().tab !== 'all' && row.type !== state().tab) return false;
      if (kind === 'tasks' && state().tab === 'mine' && row.owner !== 'chen') return false;
      if (kind === 'tasks' && !filters.status?.length && row.taskStatus === 'cancelled') return false;
      if (kind === 'deliveries' && state().tab !== 'all' && row.deliveryStatus !== state().tab) return false;
      if (state().query && !`${row.title} ${row.id}`.toLowerCase().includes(state().query.toLowerCase())) return false;
      return configs[kind].fields.every(field => {
        const selected = filters[field] || [];
        if (!selected.length || field === 'status' && selected.includes('all')) return true;
        const values = field === 'reporter' ? row.reporters.length ? row.reporters : ['none'] : [field === 'status' ? kind === 'tasks' ? row.taskStatus : row.status : row[field]];
        return selected.some(value => values.includes(value));
      });
    });
  }
  function selectedCount() { return Object.values(state().filters).filter(v => v.length).length; }
  function fieldSummary(field) {
    const values = state().filters[field] || [];
    if (!values.length) return t(field === 'status' && kind === 'tasks' ? '未取消' : allLabels[field]);
    return values.map(value => labelFor(field, value)).join('、');
  }
  function fieldControl(field) {
    return `<div class="filter-field"><span class="field-label">${t(field === 'status' ? kind === 'tasks' ? '任务状态' : '事项状态' : fieldLabels[field])}</span><button class="field-select ${state().filters[field]?.length ? 'selected' : ''}" data-field="${field}" aria-label="${t(fieldLabels[field])}：${escape(fieldSummary(field))}" aria-haspopup="dialog"><span>${escape(fieldSummary(field))}</span><span class="chevron">⌄</span></button></div>`;
  }
  function fields() { return `<div class="filter-fields">${configs[kind].fields.map(fieldControl).join('')}</div>`; }
  function chips(allVisible = false) {
    const visible = allVisible ? state().visible : configs[kind].fields.filter(field => state().filters[field]?.length);
    return visible.map(field => `<span class="filter-chip ${state().filters[field]?.length ? '' : 'inactive'}"><button data-field="${field}" aria-haspopup="dialog">${t(fieldLabels[field])}<span class="muted"> · </span>${escape(fieldSummary(field))}</button><button data-remove="${field}" aria-label="${t('移除条件')}：${t(fieldLabels[field])}">×</button></span>`).join('');
  }
  function filterArea() {
    if (variant === 'a') return `<section class="filter-area" aria-label="${t('筛选')}">${fields()}<div class="filter-bottom"><p class="filter-helper">${t('不同条件同时满足，同一条件可多选。')}</p>${selectedCount() ? `<button class="text-button" data-action="reset">${t('清空筛选')}</button>` : ''}</div></section>`;
    if (variant === 'b') return `<section class="chip-filter-area"><div class="active-filters">${chips(true)}<div class="add-wrapper"><button class="add-filter" data-action="add" aria-expanded="false">＋ ${t('添加条件')}</button></div>${selectedCount() ? `<button class="quiet" data-action="reset">${t('清空筛选')}</button>` : ''}</div></section>`;
    return selectedCount() ? `<section class="chip-filter-area"><div class="active-filters">${chips()}<button class="quiet" data-action="reset">${t('清空筛选')}</button></div></section>` : '';
  }
  function person(id) { return `<span class="person"><span class="avatar" aria-hidden="true">${escape(displayName(id).slice(0, 1))}</span><span>${escape(displayName(id))}</span></span>`; }
  function statusBadge(row) {
    const status = kind === 'issues' ? row.status : kind === 'tasks' ? row.taskStatus : row.deliveryStatus;
    const label = (kind === 'issues' ? issueStates : kind === 'tasks' ? taskStates : deliveryStates)[status];
    const tone = ['completed', 'closed', 'accepted'].includes(status) ? 'success' : ['doing', 'started', 'reviewing', 'verify'].includes(status) ? 'accent' : status === 'returned' ? 'warning' : '';
    return `<span class="badge ${tone}">${t(label)}</span>`;
  }
  function table(rows) {
    if (scenario === 'loading') return `<section class="empty" role="status"><h3>${t('正在读取列表…')}</h3>${[1,2,3].map(() => '<div class="skeleton"></div>').join('')}</section>`;
    if (scenario === 'error') return `<section class="empty" role="alert"><span class="empty-icon">↻</span><h3>${t('无法读取列表')}</h3><p>${t('筛选条件已保留，请重试。')}</p><button data-action="retry">${t('重试')}</button></section>`;
    if (!rows.length) return `<section class="empty"><span class="empty-icon">⌕</span><h3>${t('没有符合条件的内容')}</h3><p>${t('试试减少筛选条件，或使用其他关键词。')}</p><button data-action="reset">${t('清空筛选')}</button></section>`;
    const ownerLabel = kind === 'deliveries' ? '提交人' : '负责人';
    return `<table class="data-table"><colgroup><col class="title-col"/><col class="status-col"/>${kind === 'issues' ? '<col class="priority-col"/>' : ''}<col class="version-col"/><col class="people-col"/><col class="people-col"/><col class="action-col"/></colgroup><thead><tr><th>${t(configs[kind].title)}</th><th>${t(kind === 'tasks' ? '任务状态' : '状态')}</th>${kind === 'issues' ? `<th>${t('优先级')}</th>` : ''}<th>${t('版本')}</th><th>${t(ownerLabel)}</th><th>${t('提报人')}</th><th><span class="sr-only">${t('查看')}</span></th></tr></thead><tbody>${rows.map(row => `<tr data-row="${row.id}"><td class="title-cell"><button class="row-title" data-detail="${row.id}">${escape(row.title)}</button><p class="row-subtitle">#${row.id} · MY智营 · ${kind === 'issues' ? t(row.type === 'bug' ? '缺陷' : '需求') : row.count ? `${t('关联')} ${row.count} ${t('条事项')}` : t('独立开发')}<br/>${t('最近更新')} ${row.time}</p></td><td data-label="${t('状态')}">${statusBadge(row)}</td>${kind === 'issues' ? `<td data-label="${t('优先级')}"><span class="priority ${row.priority === 'high' ? 'high' : ''}"><span class="priority-dot"></span>${t(priorities[row.priority])}</span></td>` : ''}<td data-label="${t('版本')}"><span class="version-text">${escape(t(releases[row.version]))}</span></td><td data-label="${t(ownerLabel)}">${person(kind === 'deliveries' ? row.publisher : row.owner)}</td><td data-label="${t('提报人')}" class="reporter-cell">${row.reporters.length ? row.reporters.map(person).join('') : `<small>${t('无关联事项')}</small>`}</td><td class="action-cell"><button class="text-button" data-detail="${row.id}" aria-label="${t('查看')} #${row.id}">${t('查看')}</button></td></tr>`).join('')}</tbody></table>`;
  }
  function renderNavigation() {
    const nav = [['home', '工作台'], ['projects', '项目'], ['issues', '事项'], ['tasks', '开发'], ['deliveries', '交付']].map(([id, label]) => `<a class="nav-item ${kind === id ? 'active' : ''}" ${configs[id] ? `href="#${variant}-${id}"` : 'href="#" data-action="scope"'} ${kind === id ? 'aria-current="page"' : ''}>${icon(id)}<span class="nav-label">${t(label)}</span></a>`).join('');
    $('#main-nav').innerHTML = nav;
    $('#mobile-nav').innerHTML = nav;
    $('#breadcrumb').textContent = t(configs[kind].title);
    $('#variants').innerHTML = Object.entries(variants).map(([id, [label]]) => `<button data-variant="${id}" aria-pressed="${variant === id}">${t(label)}</button>`).join('');
    $('.review-brand strong').textContent = t('列表筛选 · 方案评审');
    $('.review-brand span').textContent = t('交互原型 / 模拟数据');
    const scenarios = ['常规内容', '长内容', '无结果', '加载中', '读取失败', '归档只读'];
    [...$('#scenario').options].forEach((option, i) => option.textContent = t(scenarios[i]));
    $('#language').textContent = lang === 'zh' ? 'EN' : '中文';
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }
  function resultSummary(rows) {
    if (['loading', 'error'].includes(scenario)) return '—';
    return `${rows.length} ${t('条结果')}`;
  }
  function render() {
    renderNavigation();
    const cfg = configs[kind], rows = filteredRows();
    const showPanel = variant === 'c' && panelOpen;
    $('#page').className = showPanel ? 'variant-c' : '';
    $('#page').innerHTML = `<div class="proposal-note"><strong>${t(variants[variant][0])}${variant === 'a' ? lang === 'zh' ? ' · 推荐' : ' · Recommended' : ''}</strong><span>${t(variants[variant][1])}</span></div><header class="page-heading"><div><h1>${t(cfg.title)}</h1><p>${t(cfg.description)}</p></div><div class="heading-actions">${kind === 'tasks' ? `<button class="quiet" data-action="from-issues">${t('从事项开发')}</button>` : ''}<button class="primary" data-action="scope" ${scenario === 'readonly' ? 'disabled' : ''}>＋ ${t(cfg.action)}</button></div></header>${scenario === 'readonly' ? `<div class="notice">${t('当前版本已归档，仅可查看。')}</div>` : ''}<div class="toolbar"><nav class="tabs" aria-label="${t(cfg.title)}">${cfg.tabs.map(([id, label]) => `<button data-tab="${id}" class="${state().tab === id ? 'active' : ''}" aria-pressed="${state().tab === id}">${t(label)}</button>`).join('')}</nav><div class="tools-right"><label class="search"><span aria-hidden="true">⌕</span><input id="query" type="search" placeholder="${t('搜索标题、编号')}" aria-label="${t('搜索标题、编号')}" value="${escape(state().query)}"/></label>${variant === 'c' ? `<button class="desktop-filter-button" data-action="panel" aria-expanded="${panelOpen}">${icon('filter')}${t('筛选')}${selectedCount() ? ` · ${selectedCount()}` : ''}</button>` : ''}<button class="mobile-filter-button" data-action="sheet">${icon('filter')}${t('筛选')}${selectedCount() ? ` · ${selectedCount()}` : ''}</button></div></div>${filterArea()}<div class="filter-workspace"><div class="filter-content"><div class="result-line"><span><strong>${resultSummary(rows)}</strong> · ${t('当前项目')}</span><span>${t(kind === 'tasks' && !state().filters.status?.length ? '默认排除已取消任务' : '按最近更新排序')}</span></div>${table(rows)}<footer class="footer"><span>${t('仅显示可访问的内容')}</span><div class="pagination"><button disabled>${t('上一页')}</button><span class="page-number">1</span><button disabled>${t('下一页')}</button></div></footer></div>${showPanel ? `<aside class="filter-panel"><header><h3>${icon('filter')}${t('筛选')}</h3><button class="quiet" data-action="reset">${t('重置')}</button></header>${fields()}<p class="filter-helper">${t('不同条件同时满足，同一条件可多选。')}</p></aside>` : ''}</div>`;
    $('#announcement').textContent = resultSummary(rows);
  }
  function showSheet() {
    $('#filter-sheet').innerHTML = `<header class="dialog-header"><h2 id="sheet-title">${t('筛选')}</h2><button class="icon-button quiet" data-close="filter-sheet" aria-label="${t('关闭')}">×</button></header><div class="sheet-body">${fields()}<p class="filter-helper" style="margin-top:24px">${t('不同条件同时满足，同一条件可多选。')}</p></div><footer class="sheet-footer"><button data-action="reset">${t('重置')}</button><button class="primary" data-close="filter-sheet">${t('查看结果')} · ${filteredRows().length}</button></footer>`;
    if (!$('#filter-sheet').open) $('#filter-sheet').showModal();
  }
  function pickerOptions() {
    const list = options(activeField).filter(([, name]) => t(name).toLowerCase().includes(pickerSearch.toLowerCase()));
    $('#picker-options').innerHTML = list.length ? list.map(([id, name]) => `<label class="option-row"><input type="checkbox" value="${id}" ${draft.includes(id) ? 'checked' : ''}/><span>${escape(t(name))}</span>${id === 'chen' ? `<small>${lang === 'zh' ? '我' : 'Me'}</small>` : ''}</label>`).join('') : `<p class="muted" style="padding:16px">${t('没有匹配的选项')}</p>`;
  }
  function openPicker(field, button) {
    activeField = field; draft = [...(state().filters[field] || [])]; pickerSearch = ''; trigger = button; anchor = button.getBoundingClientRect();
    $('#picker').innerHTML = `<header class="picker-heading"><h3 id="picker-title">${t(fieldLabels[field])}</h3><button class="icon-button quiet" data-close="picker" aria-label="${t('关闭')}">×</button></header><label class="search picker-search"><span aria-hidden="true">⌕</span><input id="picker-search" type="search" placeholder="${t('搜索选项')}" aria-label="${t('搜索选项')}"/></label><div id="picker-options" class="picker-options"></div><footer class="picker-footer"><button class="quiet" data-action="clear-draft">${t('清除')}</button><button class="primary" data-action="apply">${t('完成')}</button></footer>`;
    pickerOptions();
    $('#picker').showModal();
    positionPicker();
    $('#picker-search').focus();
  }
  function positionPicker() {
    if (!$('#picker').open) return;
    const rect = $('#picker').getBoundingClientRect();
    const left = innerWidth < 768 ? 12 : Math.max(12, Math.min(anchor.left, innerWidth - rect.width - 12));
    const top = innerWidth < 768 ? Math.max(12, (innerHeight - rect.height) / 2) : Math.max(12, Math.min(anchor.bottom + 8, innerHeight - rect.height - 12));
    Object.assign($('#picker').style, { left: `${left}px`, top: `${top}px` });
  }
  function focusField() { const buttons = [...document.querySelectorAll(`[data-field="${activeField}"]`)]; const candidate = $('#filter-sheet').open ? $('#filter-sheet').querySelector(`[data-field="${activeField}"]`) : buttons.find(b => b.getBoundingClientRect().width > 0); candidate?.focus(); }
  function applyPicker() {
    state().filters[activeField] = [...draft];
    if (!state().visible.includes(activeField)) state().visible.push(activeField);
    $('#picker').close(); render(); if ($('#filter-sheet').open) showSheet(); focusField();
  }
  function showDetail(row) {
    detailRow = row; imageError = false;
    renderDetail(); $('#detail').showModal();
  }
  function renderDetail() {
    const row = detailRow;
    $('#detail').innerHTML = `<header class="dialog-header"><div><small>${kind === 'tasks' ? `${t('开发范围')} · ${t('纳入任务时的事项内容')}` : t(configs[kind].title)}</small><h2 id="detail-title">${escape(row.title)}</h2><p class="row-subtitle">#${row.id} · MY智营</p></div><button class="icon-button quiet" data-close="detail" aria-label="${t('关闭')}">×</button></header><div class="detail-body"><article><h3>${t(row.type === 'bug' ? '问题描述' : '目标与背景')}</h3><p>${row.id === 68 ? '平台模型配置的“选择默认模型”弹框中，顶部提示条与首行模型选项紧贴，需要增加两者之间的垂直间距。' : escape(row.title)}</p>${row.count ? `<div id="attachment-slot">${attachment()}</div><h3>${t('验收标准')}</h3><ol><li>正文中的图片正常展示，点击图片可放大查看。</li><li>长标题和窄屏下，内容与操作均保持清晰可读。</li></ol>` : `<p class="muted">${t('无关联事项')}</p>`}</article><aside class="detail-aside"><h3>${t('来源事项')}</h3><dl><dt>${t('版本')}</dt><dd>${escape(t(releases[row.version]))}</dd><dt>${t('提报人')}</dt><dd>${row.reporters.map(person).join('') || t('无关联事项')}</dd><dt>${t(kind === 'tasks' ? '执行者' : '开发负责人')}</dt><dd>${person(row.owner)}</dd><dt>${t('状态')}</dt><dd>${statusBadge(row)}</dd></dl>${row.count ? `<button class="text-button" data-action="source">${t('查看需求')} ↗</button><br/><button class="quiet" data-action="image-failure">${t('模拟图片失败')}</button>` : ''}</aside></div>`;
  }
  function attachment() {
    if (imageError) return `<div class="attachment-failure"><strong>${t('图片暂时无法加载')}</strong><p>${t('请重试，或前往来源事项查看附件。')}</p><button data-action="image-retry">${t('重试')}</button></div>`;
    return `<button class="attachment" data-action="image" aria-label="${t('查看原图')}"><img src="model-selection.svg" alt="模型选择弹窗间距示例"/><span class="attachment-caption"><span>model-selection.svg · ${t('图片附件')}</span><span>⤢ ${t('点击放大')}</span></span></button>`;
  }
  function showImage() {
    $('#image-viewer').innerHTML = `<header class="dialog-header"><h3 id="image-title">model-selection.svg</h3><button class="icon-button quiet" data-close="image-viewer" aria-label="${t('关闭')}">×</button></header><img src="model-selection.svg" alt="模型选择弹窗间距示例原图"/>`;
    $('#image-viewer').showModal();
  }
  function reset() {
    state().filters = {}; state().query = ''; if (scenario === 'empty') { scenario = 'normal'; $('#scenario').value = scenario; }
    render(); if ($('#filter-sheet').open) showSheet();
  }
  function changeRoute() {
    const parts = location.hash.slice(1).split('-');
    variant = variants[parts[0]] ? parts[0] : 'a'; kind = configs[parts[1]] ? parts[1] : 'issues';
    document.querySelectorAll('dialog[open]').forEach(d => d.close()); panelOpen = true; render();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button,a'); if (!button) return;
    if (button.dataset.variant) { location.hash = `${button.dataset.variant}-${kind}`; return; }
    if (button.dataset.close) { $(`#${button.dataset.close}`).close(); return; }
    if (button.dataset.field) { $('.add-menu')?.remove(); openPicker(button.dataset.field, button); return; }
    if (button.dataset.remove) { delete state().filters[button.dataset.remove]; state().visible = state().visible.filter(field => field !== button.dataset.remove); render(); return; }
    if (button.dataset.tab) { state().tab = button.dataset.tab; render(); return; }
    if (button.dataset.detail) { showDetail(records().find(row => row.id === Number(button.dataset.detail))); return; }
    switch (button.dataset.action) {
      case 'apply': applyPicker(); break;
      case 'clear-draft': draft = []; pickerOptions(); break;
      case 'reset': reset(); break;
      case 'sheet': showSheet(); break;
      case 'panel': if (innerWidth < 1400) showSheet(); else { panelOpen = !panelOpen; render(); } break;
      case 'add': {
        const existing = $('.add-menu'); if (existing) { existing.remove(); button.setAttribute('aria-expanded', 'false'); break; }
        const missing = configs[kind].fields.filter(field => !state().visible.includes(field));
        button.insertAdjacentHTML('afterend', `<div class="add-menu">${(missing.length ? missing : configs[kind].fields).map(field => `<button data-field="${field}">${t(fieldLabels[field])}</button>`).join('')}</div>`); button.setAttribute('aria-expanded', 'true'); break;
      }
      case 'retry': scenario = 'normal'; $('#scenario').value = 'normal'; render(); break;
      case 'image': showImage(); break;
      case 'image-failure': imageError = true; renderDetail(); break;
      case 'image-retry': imageError = false; renderDetail(); break;
      case 'from-issues': location.hash = `${variant}-issues`; break;
      case 'source': {
        $('#detail').close(); kind = 'issues'; history.pushState({}, '', `#${variant}-issues`); render(); showDetail(detailRow); break;
      }
      case 'scope': {
        event.preventDefault();
        $('#detail').innerHTML = `<header class="dialog-header"><h2 id="detail-title">${t('本轮原型范围')}</h2><button class="icon-button quiet" data-close="detail" aria-label="${t('关闭')}">×</button></header><div style="padding:28px"><p>${t('此入口沿用现有流程；本轮演示列表、筛选与需求图片查看。')}</p><button data-close="detail">${t('返回列表')}</button></div>`;
        $('#detail').showModal(); break;
      }
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'picker-search') { pickerSearch = event.target.value; pickerOptions(); }
    if (event.target.id === 'query') {
      state().query = event.target.value;
      const caret = event.target.selectionStart; render(); $('#query').focus(); $('#query').setSelectionRange(caret, caret);
    }
  });
  $('#picker').addEventListener('change', event => {
    if (event.target.type !== 'checkbox') return;
    const value = event.target.value;
    draft = event.target.checked ? value === 'all' ? ['all'] : [...new Set([...draft.filter(id => id !== 'all'), value])] : draft.filter(id => id !== value);
    $('#picker').querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = draft.includes(input.value); });
  });
  $('#picker').addEventListener('close', () => { if (trigger?.isConnected) trigger.focus(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $('.add-menu')?.remove(); });
  $('#scenario').addEventListener('change', event => { scenario = event.target.value; render(); });
  $('#language').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; render(); });
  window.addEventListener('hashchange', changeRoute);
  window.addEventListener('popstate', changeRoute);
  window.addEventListener('resize', positionPicker);
  changeRoute();
})();
