/* Standalone review prototype. All activity and actions are in memory. */
const initial = new URLSearchParams(location.search);
const state = {
  variant: ['a', 'b', 'c'].includes(initial.get('v')) ? initial.get('v') : 'a',
  scene: ['running', 'complete', 'error', 'approval', 'empty', 'readonly', 'stopped'].includes(initial.get('state')) ? initial.get('state') : 'running',
  lang: initial.get('lang') === 'en' ? 'en' : 'zh', category: '', draft: '', sent: [],
};
const t = (zh, en) => state.lang === 'en' ? en : zh;
const esc = (value) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const paths = {
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/>',
  folder: '<path d="M3 7V5h6l2 3h10v12H3Z"/>',
  file: '<path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6m-6 4h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circleCheck: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  brain: '<path d="M12 4v16M12 6C10 1 4 3 5 8c-4 2-3 7 0 8-1 5 6 6 7 2M12 6c2-5 8-3 7 2 4 2 3 7 0 8 1 5-6 6-7 2M7 10l5 2 5-2M7 16l5-2 5 2"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10m0-3c7 0 12-1 12-6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  robot: '<rect x="4" y="6" width="16" height="14" rx="3"/><path d="M12 3v3M8 11h1m6 0h1m-8 5h8"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0v7l2 3H4l2-3Zm4 13h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4v.1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const spinner = '<i class="spinner" aria-hidden="true"></i>';
const scenes = () => [
  ['running', t('执行中', 'Running')], ['complete', t('已完成', 'Completed')],
  ['error', t('命令失败', 'Command failed')], ['approval', t('等待确认', 'Approval required')],
  ['empty', t('空会话', 'Empty session')], ['readonly', t('归档只读', 'Archived · read only')],
  ['stopped', t('已停止', 'Stopped')],
];
const variantNames = () => ({ a: t('单行摘要', 'Single line'), b: t('分类合并', 'Grouped'), c: t('底部状态条', 'Status bar') });
const descriptions = () => ({
  a: t('连续过程记录收成一行，点击就地展开；保留它在对话中的位置。', 'Collapse consecutive activity into one line. Expand in place without losing the conversation context.'),
  b: t('按思考、命令、文件归类；只展开你关心的一类。', 'Group reasoning, commands and files. Open only the category you need.'),
  c: t('过程集中到输入框上方；点击「过程详情」在侧边查看。', 'Keep activity above the composer. Open the side panel for the complete trail.'),
});
const activityEvents = () => [
  { kind: 'brain', category: 'reasoning', title: t('梳理注册与找回密码的校验逻辑', 'Review registration and password reset validation'), tag: '8s', content: '先检查注册与找回密码的表单和接口，再统一提交时的校验反馈。现有账号身份与登录流程保持不变。' },
  { kind: 'terminal', category: 'commands', title: 'rg -n "resetPassword|register" apps/', tag: '0.4s', content: '$ rg -n "resetPassword|register" apps/\napps/web/src/views/auth/register.vue:42\napps/web/src/views/auth/reset-password.vue:57\n\n' + t('退出码 0', 'Exit code 0') },
  { kind: 'terminal', category: 'commands', title: '读取表单组件与校验规则', tag: '0.2s', content: '$ sed -n \'1,180p\' apps/web/src/views/auth/register.vue\n\nconst passwordRule = { min: 8, message: "密码至少需要 8 位" };\nconst confirmPasswordRule = { validator: validateConfirmation };\n\n' + t('退出码 0', 'Exit code 0') },
  { kind: 'edit', category: 'files', title: 'register.vue · reset-password.vue', tag: '+42 −18', content: 'apps/web/src/views/auth/register.vue\n+ 提交时聚焦首个未通过校验的字段\n+ 密码强度提示与确认密码即时校验\n\napps/web/src/views/auth/reset-password.vue\n+ 邮箱输入保留，失败后支持重试\n- 删除重复的整页错误提示' },
  { kind: 'brain', category: 'reasoning', title: t('补充重复提交与验证码过期的边界检查', 'Check duplicate submissions and expired verification codes'), tag: '5s', content: '检查验证码过期和重复点击提交时的反馈，补充密码校验的边界用例。测试结束后再核对页面状态。' },
  { kind: 'edit', category: 'files', title: 'auth-validation.test.ts', tag: '+26 −4', content: 'apps/web/src/views/auth/__tests__/auth-validation.test.ts\n+ 短密码、密码不一致的校验用例\n+ 验证码过期、连续提交的反馈用例' },
  { kind: 'terminal', category: 'commands', title: 'pnpm --dir apps/web exec eslint src/views/auth', tag: '2.1s', content: '$ pnpm --dir apps/web exec eslint src/views/auth\n\n' + t('校验通过 · 退出码 0', 'Passed · Exit code 0') },
  { kind: 'terminal', category: 'commands', title: 'pnpm --dir apps/web test auth-validation --run', tag: state.scene === 'running' ? t('执行中', 'Running') : state.scene === 'error' ? t('失败', 'Failed') : state.scene === 'stopped' ? t('已停止', 'Stopped') : '4.8s', active: state.scene === 'running', failed: state.scene === 'error', content: '$ pnpm --dir apps/web test auth-validation --run\n\n' + (state.scene === 'error' ? 'FAIL auth-validation.test.ts\n验证码过期后再次提交\nExpected: "验证码已过期，请重新获取"\nReceived: "请求失败"\n\n' + t('退出码 1', 'Exit code 1') : state.scene === 'running' ? 'RUN auth-validation.test.ts\n✓ 密码长度与确认密码\n✓ 防止重复提交\n… 验证码过期与重新发送' : state.scene === 'stopped' ? t('测试已中断，结果不完整。', 'Interrupted. Test results are incomplete.') : 'PASS auth-validation.test.ts\nTests: 12 passed (12)\n\n' + t('退出码 0', 'Exit code 0')) },
];
function eventList(category = '') {
  return activityEvents().filter(event => !category || event.category === category).map(event => `<details class="event ${event.failed ? 'failed' : ''}">
    <summary><span class="event-icon">${event.active ? spinner : icon(event.kind)}</span><span class="event-name">${esc(event.title)}</span><span class="event-tag">${esc(event.tag)}</span>${icon('chevron', 'chevron')}</summary>
    <pre>${esc(event.content)}</pre></details>`).join('');
}
function activityLabel() {
  return ({ running: t('正在检查表单校验', 'Checking form validation'), complete: t('已完成 8 项活动', 'Completed 8 activities'), error: t('8 项活动 · 1 项失败', '8 activities · 1 failed'), approval: t('已完成 8 项活动', 'Completed 8 activities'), readonly: t('已完成 8 项活动', 'Completed 8 activities'), stopped: t('已停止 · 7 项完成', 'Stopped · 7 completed') })[state.scene] || '';
}
const statusIcon = () => state.scene === 'running' ? spinner : icon(state.scene === 'error' ? 'alert' : state.scene === 'stopped' ? 'clock' : 'check');
function activityBlock() {
  if (state.variant === 'c') return '';
  if (state.variant === 'a') return `<div class="activity" data-activity-region><details class="activity-disclosure"><summary class="summary-line">${statusIcon()}<span class="summary-title">${activityLabel()}</span><span class="summary-meta">${state.scene === 'running' ? t('8 项活动', '8 activities') : t('1 分 24 秒', '1m 24s')}</span>${icon('chevron', 'chevron')}</summary><div class="activity-panel"><div class="activity-intro">${t('思考 2 次 · 命令 4 条 · 修改 3 个文件', '2 reasoning summaries · 4 commands · 3 changed files')}</div>${eventList()}</div></details></div>`;
  const cats = [['reasoning', 'brain', t('思考', 'Reasoning'), 2], ['commands', 'terminal', t('命令', 'Commands'), 4], ['files', 'edit', t('文件', 'Files'), 3]];
  return `<div class="activity" data-activity-region><div class="group-bar">${cats.map(([key, name, label, count]) => `<button class="group-button" data-category="${key}" aria-expanded="${state.category === key}" aria-controls="category-panel">${icon(name)}${label}<b>${count}</b></button>`).join('')}</div><div class="group-current">${statusIcon()}<span>${activityLabel()}</span></div><div id="category-panel" ${state.category ? '' : 'hidden'}>${state.category ? `<div class="group-panel"><div class="group-panel-head"><strong>${cats.find(cat => cat[0] === state.category)[2]}</strong><button class="icon-button" data-action="close-category" aria-label="${t('收起分类详情', 'Collapse category')}">${icon('close')}</button></div>${eventList(state.category)}</div>` : ''}</div></div>`;
}
function notice() {
  if (state.scene === 'error') return `<div class="notice" role="alert">${icon('alert')}<span>${t('校验未通过：验证码过期后的错误提示不匹配。', 'Validation failed: the expired-code error message does not match.')}</span><button data-action="error-detail">${t('查看失败', 'View failure')}</button></div>`;
  if (state.scene === 'approval') return `<section class="approval-card"><div class="approval-title">${icon('lock')}${t('需要你确认后继续', 'Your approval is required')}</div><p>${t('启动本地页面预览，以检查表单的交互效果。', 'Start a local preview to inspect form interactions.')}</p><code>pnpm --dir apps/web dev --host 127.0.0.1 --port 5333</code><div class="approval-actions"><button class="button primary" data-action="allow">${t('允许本次', 'Allow once')}</button><button class="button" data-action="decline">${t('拒绝', 'Decline')}</button></div></section>`;
  return '';
}
function message(role, text, time = '') {
  return `<article class="message ${role}"><span class="message-mark">${icon(role === 'user' ? 'user' : 'robot')}</span><div class="message-role">${role === 'user' ? t('你', 'You') : 'Codex'}${time ? `<time>${time}</time>` : ''}</div><div class="message-text">${text}</div></article>`;
}
function conversation() {
  if (state.scene === 'empty') return `<div class="empty">${icon('terminal')}<h2>${t('从一条指令开始', 'Start with an instruction')}</h2><p>${t('告诉 Codex 你希望怎样优化注册与找回密码。', 'Tell Codex how you want to improve registration and password reset.')}</p></div>`;
  const complete = ['complete', 'readonly', 'approval'].includes(state.scene);
  return message('user', '优化注册与找回密码流程：统一表单校验，补充密码强度提示，让提交失败后的反馈更清楚。', '10:42')
    + message('agent', '<p>我会先检查现有表单和校验规则，再调整注册、找回密码的交互与错误提示。</p>')
    + activityBlock() + notice()
    + message('agent', complete ? '<p>已完成注册与找回密码流程的调整：</p><ul><li>统一字段校验，提交后定位到第一个需要修改的位置。</li><li>补充密码强度与确认密码提示。</li><li>保留失败后的输入，验证码过期时提供重新获取入口。</li></ul><p>相关校验测试已通过，共修改 3 个文件。</p>' : state.scene === 'stopped' ? '<p>已停止本轮执行。已完成的文件修改仍保留，表单校验测试尚未完成。</p>' : state.scene === 'error' ? '<p>表单调整已完成。检查时发现验证码过期的提示仍使用了通用错误文案，需要继续修正这一处。</p>' : '<p>注册与找回密码的表单已调整好，正在检查密码校验、重复提交和验证码过期的边界情况。</p>')
    + state.sent.map(text => message('user', esc(text))).join('');
}
function navigation() {
  return [['home', t('工作台', 'Overview')], ['folder', t('项目', 'Projects')], ['file', t('事项', 'Issues')], ['terminal', t('开发', 'Development')], ['circleCheck', t('交付', 'Deliveries')]].map(([name, label]) => `<div class="nav-item ${name === 'terminal' ? 'active' : ''}" ${name === 'terminal' ? 'aria-current="page"' : ''}>${icon(name)}<span>${label}</span></div>`).join('');
}
function renderReview() {
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';
  document.getElementById('review').innerHTML = `<header class="review-bar"><div class="review-title"><strong>${t('会话过程提示', 'Conversation activity')}</strong><small>${t('三方案评审 · 模拟数据', 'Design review · Demo data')}</small></div><div class="variants" aria-label="${t('选择设计方案', 'Choose a design')}">${Object.entries(variantNames()).map(([key, label]) => `<button data-variant="${key}" aria-pressed="${state.variant === key}"><b>${key.toUpperCase()}</b>${label}</button>`).join('')}</div><div class="review-options"><label><span>${t('演示状态', 'Preview state')}</span><select id="scene" aria-label="${t('演示状态', 'Preview state')}">${scenes().map(([value, label]) => `<option value="${value}" ${value === state.scene ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="language" data-action="language" aria-label="${t('Switch to English', '切换到中文')}">${t('EN', '中文')}</button></div></header>`;
}
function render() {
  renderReview();
  const status = scenes().find(scene => scene[0] === state.scene)[1];
  const readOnly = state.scene === 'readonly';
  const running = state.scene === 'running';
  document.getElementById('app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand">${icon('terminal')}<span>DevLoom</span></div><nav class="navigation">${navigation()}</nav><div class="sidebar-foot">${t('个人工作空间', 'Personal workspace')}</div></aside><div class="workspace"><header class="topbar"><div class="breadcrumbs">${icon('folder')}<span>MY智营</span><span>/</span><span>${t('个人会话', 'Private session')}</span></div><div class="top-actions"><span class="connected"><i></i>${t('已连接', 'Connected')}</span>${icon('bell')}<span class="avatar">L</span></div></header><div class="heading"><div><small>${t('开发 / 独立开发', 'Development / Independent task')}</small><h1>优化注册与找回密码流程</h1></div><div class="heading-actions"><span class="status ${state.scene}"><i class="status-dot"></i>${esc(status)}</span><button class="button" data-action="files">${icon('branch')}${t('代码变更', 'Code changes')}</button><button class="icon-button" data-action="context" aria-label="${t('会话信息', 'Session information')}">${icon('more')}</button></div></div><main class="session"><div class="messages" tabindex="0" aria-label="${t('对话内容', 'Conversation')}"><div class="conversation">${conversation()}</div></div><div class="composer-area">${state.variant === 'c' && state.scene !== 'empty' ? `<div class="activity-dock" data-activity-region><span>${statusIcon()}<span>${activityLabel()}</span></span><button class="dock-button" data-action="activity">${t('过程详情', 'Activity details')}<span class="dock-count">8</span>${icon('chevron')}</button></div>` : ''}<div class="composer"><textarea id="draft" aria-label="${t('补充指令', 'Add an instruction')}" placeholder="${readOnly ? t('已归档会话，仅可查看历史', 'Archived session. History is read only.') : t('补充指令，或调整当前执行方向…', 'Add an instruction or adjust the current direction…')}" ${readOnly || state.scene === 'approval' ? 'disabled' : ''}>${esc(state.draft)}</textarea><div class="composer-controls"><div class="composer-settings"><span>${icon('terminal')}${t('默认模型', 'Default model')}</span><span class="permission">${t('默认权限', 'Default permissions')}</span></div><button class="send" data-action="${running && !state.draft.trim() ? 'stop' : 'send'}" ${readOnly || state.scene === 'approval' || (!running && !state.draft.trim()) ? 'disabled' : ''} aria-label="${running && !state.draft.trim() ? t('停止执行', 'Stop execution') : t('发送指令', 'Send instruction')}">${running && !state.draft.trim() ? '<span class="stop-square"></span>' : icon('arrow')}</button></div></div><p class="composer-hint">${readOnly ? t('归档记录保留完整对话与执行过程', 'Archived records retain the conversation and activity') : t('Enter 发送 · Shift + Enter 换行', 'Enter to send · Shift + Enter for a new line')}</p></div></main><footer class="design-note"><b>${state.variant.toUpperCase()} · ${variantNames()[state.variant]}</b><span>${descriptions()[state.variant]}</span></footer></div></div><nav class="bottom-nav">${navigation()}</nav>`;
  const url = new URL(location.href);
  url.searchParams.set('v', state.variant); url.searchParams.set('state', state.scene); url.searchParams.set('lang', state.lang);
  history.replaceState(null, '', url);
}
let dialogTrigger = null;
function openDrawer(type) {
  const drawer = document.getElementById('drawer');
  dialogTrigger = document.activeElement;
  const title = type === 'files' ? t('代码变更', 'Code changes') : type === 'context' ? t('会话信息', 'Session information') : t('过程详情', 'Activity details');
  const body = type === 'files' ? `<p>${t('本轮修改 3 个文件', '3 files changed this turn')}</p>${['apps/web/src/views/auth/register.vue', 'apps/web/src/views/auth/reset-password.vue', 'apps/web/src/views/auth/__tests__/auth-validation.test.ts'].map((path, index) => `<div class="file-row">${icon('file')}<span>${path}</span><b>${['+24 −10', '+18 −8', '+26 −4'][index]}</b></div>`).join('')}` : type === 'context' ? `<p>${t('项目', 'Project')} · MY智营</p><p>${t('会话', 'Session')} · 优化注册与找回密码流程</p><p>${t('当前状态', 'Current state')} · ${scenes().find(scene => scene[0] === state.scene)[1]}</p>` : `<p>${t('本轮共 8 项活动 · 3 个文件有修改', '8 activities this turn · 3 files changed')}</p><div class="activity-panel">${eventList()}</div>`;
  drawer.innerHTML = `<div class="drawer-header"><div><small>${t('本轮会话', 'Current turn')}</small><h2 id="drawer-title">${title}</h2></div><button class="icon-button" data-action="close-drawer" aria-label="${t('关闭详情', 'Close details')}">${icon('close')}</button></div><div class="drawer-body">${body}</div><div class="drawer-footer">${t('原型演示 · 所有记录与操作均为模拟', 'Prototype preview · All records and actions are simulated')}</div>`;
  drawer.showModal();
  if (type === 'error-detail') { const failure = drawer.querySelector('.failed'); failure.open = true; failure.scrollIntoView({ block: 'center' }); }
}
document.getElementById('drawer').addEventListener('close', () => { if (dialogTrigger?.isConnected) dialogTrigger.focus(); });
function announce(text) { document.getElementById('announcement').textContent = text; }
function send() {
  if (!state.draft.trim() || ['readonly', 'approval'].includes(state.scene)) return;
  state.sent.push(state.draft); state.draft = ''; state.scene = 'running'; render();
  document.querySelector('.messages').scrollTop = document.querySelector('.messages').scrollHeight;
  announce(t('指令已加入本地演示', 'Instruction added to the local preview'));
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.variant) { state.variant = button.dataset.variant; state.category = ''; render(); document.querySelector(`[data-variant="${state.variant}"]`).focus(); return; }
  if (button.dataset.category) { const category = button.dataset.category; state.category = state.category === category ? '' : category; render(); document.querySelector(`[data-category="${category}"]`).focus(); return; }
  const action = button.dataset.action;
  if (['files', 'context', 'activity', 'error-detail'].includes(action)) { openDrawer(action); return; }
  if (action === 'close-drawer') { document.getElementById('drawer').close(); return; }
  if (action === 'send') { send(); return; }
  if (action === 'language') state.lang = state.lang === 'zh' ? 'en' : 'zh';
  if (action === 'close-category') state.category = '';
  if (action === 'stop' || action === 'decline') state.scene = 'stopped';
  if (action === 'allow') state.scene = 'running';
  render();
  if (action === 'language') document.querySelector('.language').focus();
  if (action === 'close-category') document.querySelector('.group-button').focus();
  if (['stop', 'allow', 'decline'].includes(action)) announce(t('演示状态已更新', 'Preview state updated'));
});
document.addEventListener('change', event => { if (event.target.id === 'scene') { state.scene = event.target.value; state.category = ''; render(); document.getElementById('scene').focus(); } });
document.addEventListener('input', event => {
  if (event.target.id !== 'draft') return;
  state.draft = event.target.value;
  const sendButton = document.querySelector('.send');
  const stop = state.scene === 'running' && !state.draft.trim();
  sendButton.dataset.action = stop ? 'stop' : 'send'; sendButton.disabled = !stop && !state.draft.trim();
  sendButton.innerHTML = stop ? '<span class="stop-square"></span>' : icon('arrow');
  sendButton.setAttribute('aria-label', stop ? t('停止执行', 'Stop execution') : t('发送指令', 'Send instruction'));
});
document.addEventListener('keydown', event => { if (event.target.id === 'draft' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } });
render();
