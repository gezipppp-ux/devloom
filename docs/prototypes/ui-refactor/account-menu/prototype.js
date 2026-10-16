/* Standalone proposal. All data and actions are local, with no business API calls. */
const paths = {
  code: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 8 4 4-4 4m6 0h4"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
  folder: '<path d="M3 6h7l2 3h9v11H3z"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M9 13h6M9 17h6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  settings: '<path d="m9 3 1-1h4l1 3 3 1 3 1v4l-2 2-1 3-1 3h-4l-2-2-3-1-3-1v-4l2-2 1-3z"/><circle cx="12" cy="11" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  exit: '<path d="M9 4H4v16h5m6-13 5 5-5 5M8 12h12"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  bell: '<path d="M6 10a6 6 0 0 1 12 0c0 7 2 7 2 8H4c0-1 2-1 2-8m4 11h4"/>',
  down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  git: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10M18 8v2a6 6 0 0 1-6 6H6"/>',
  plug: '<path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const labels = {
  '工作台': 'Overview', '项目': 'Projects', '事项': 'Issues', '开发': 'Development', '交付': 'Deliveries',
  '管理中心': 'Administration', '全部项目': 'All projects', '搜索项目、事项': 'Search projects or issues',
  '个人中心': 'Personal center', '退出登录': 'Sign out', '我的账号': 'My account', '系统管理员': 'Administrator',
  '账号与个人设置': 'Account and personal settings', '查看资料和个人设置': 'Profile and personal settings',
  'Git 账号': 'Git accounts', '个人代码仓库身份': 'Your repository identities', 'MCP 接入': 'MCP access', '管理个人 Token 与接入配置': 'Personal tokens and connections',
  '偏好设置': 'Preferences', '语言': 'Language', '外观': 'Appearance', '浅色': 'Light', '暗色': 'Dark', '跟随系统': 'System',
  '当前浏览器生效': 'Applies to this browser', '关闭': 'Close', '通知': 'Notifications', '打开导航': 'Open navigation',
  '需求、缺陷与交付，在这里推进。': 'Keep requirements, bugs, and delivery moving.', '新建事项': 'New issue',
  '全部事项': 'All issues', '由我创建': 'Created by me', '待我处理': 'My actions', '搜索标题或描述': 'Search title or description',
  '全部状态': 'All statuses', '全部版本': 'All releases', '共 4 条': '4 issues', '标题': 'Title', '状态': 'Status', '优先级': 'Priority', '负责人': 'Owner',
  '需求': 'Requirement', '缺陷': 'Bug', '待开发': 'Planned', '开发中': 'In development', '待验证': 'To verify', '已完成': 'Completed',
  '高': 'High', '中': 'Medium', '第 1–4 条，共 4 条': 'Showing 1–4 of 4', '上一页': 'Previous page', '下一页': 'Next page',
  '取消': 'Cancel', '完成': 'Done', '演示退出': 'Preview sign out',
};
let locale = 'zh-CN';
let scheme = ['a', 'b', 'c'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'a';
let longName = false;
let theme = 'system';
let opened = false;
let toastTimer;
const t = value => locale === 'en' ? labels[value] || value : value;
const app = document.querySelector('#app');
const menu = document.querySelector('#account-menu');
const accountDialog = document.querySelector('#account-dialog');
const previewDialog = document.querySelector('#preview-dialog');
const descriptions = {
  a: 'A · 保留现有顶栏。点击右上角头像，展开个人中心与退出；管理中心留在侧栏低频区。',
  b: 'B · 语言、外观一并收进头像卡片，顶栏更清爽；手机端改为底部账号面板。',
  c: 'C · 点击头像打开右侧个人面板，直接进入资料、Git 与 MCP；手机端展开为整页。',
};
function identity() {
  const name = longName ? 'Alexandra Chen · 跨项目协作与开发负责人' : '林舟';
  const handle = longName ? '@alexandra.chen.platform.engineering' : '@linzhou';
  return `<div class="identity"><span class="avatar">${longName ? 'A' : '林'}</span><div class="identity-copy"><strong>${name}</strong><small>${handle}</small><small>${t('系统管理员')}</small></div></div>`;
}
function nav() {
  return [['home', '工作台'], ['folder', '项目'], ['file', '事项'], ['code', '开发'], ['check', '交付']].map(([i, s]) => `<button class="${s === '事项' ? 'active' : ''}" data-preview="${s}">${icon(i)}<span>${t(s)}</span></button>`).join('');
}
function action(name, i, secondary = '') {
  return `<button class="menu-action ${name === '退出登录' ? 'danger' : ''}" data-action="${name}">${icon(i)}<span class="action-copy">${t(name)}${secondary ? `<small>${t(secondary)}</small>` : ''}</span>${name === '退出登录' ? '' : icon('right').replace('<svg ', '<svg class="end" ')}</button>`;
}
function preferences() {
  return `<section class="preference-group"><h3 class="group-title">${t('偏好设置')}</h3><label class="preference-row"><span>${icon('globe')}${t('语言')}</span><select data-preference="locale" aria-label="${t('语言')}"><option value="zh-CN" ${locale === 'zh-CN' ? 'selected' : ''}>简体中文</option><option value="en" ${locale === 'en' ? 'selected' : ''}>English</option></select></label><label class="preference-row"><span>${icon('monitor')}${t('外观')}</span><select data-preference="theme" aria-label="${t('外观')}">${['system', 'light', 'dark'].map((v, i) => `<option value="${v}" ${theme === v ? 'selected' : ''}>${t(['跟随系统', '浅色', '暗色'][i])}</option>`).join('')}</select></label><p class="menu-footnote">${t('当前浏览器生效')}</p></section>`;
}
function render() {
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-scheme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scheme === scheme)));
  document.querySelector('#proposal-description').textContent = descriptions[scheme];
  document.querySelector('#review-locale').textContent = locale === 'en' ? '中文' : 'EN';
  document.querySelector('#long-name').setAttribute('aria-pressed', String(longName));
  const issues = [
    ['优化客户搜索体验与空结果提示', '需求', '待开发', 'accent', '林舟', '高'],
    ['修复导出文件中中文字段显示异常', '缺陷', '开发中', '', '陈一', '高'],
    ['支持在项目资料中查看最近更新记录', '需求', '待验证', 'success', '林舟', '中'],
    ['完善移动端事项详情与验收操作', '需求', '已完成', '', '苏禾', '中'],
  ];
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon('code')}</span><strong>DevLoom</strong></div><nav class="nav" aria-label="主导航">${nav()}</nav><nav class="nav sidebar-footer"><button data-preview="管理中心">${icon('settings')}<span>${t('管理中心')}</span></button></nav></aside><div class="shell-body"><header class="topbar"><button class="mobile-menu icon-button" data-preview="打开导航" aria-label="${t('打开导航')}">${icon('menu')}</button><div class="context">${icon('folder')}<button data-preview="全部项目">${t('全部项目')}${icon('down')}</button><span class="slash">/</span><span class="breadcrumb">${t('事项')}</span></div><div class="header-actions"><button class="global-search" data-preview="搜索项目、事项">${icon('search')}<span>${t('搜索项目、事项')}</span><kbd>Ctrl K</kbd></button><button class="icon-button notification" data-preview="通知" aria-label="${t('通知')}">${icon('bell')}</button>${scheme === 'a' ? `<button class="top-preference" data-top-locale>${locale === 'en' ? 'English' : '简体中文'}${icon('down')}</button><button class="top-preference icon-button" data-top-theme aria-label="${t('外观')}">${icon('monitor')}</button>` : ''}<button id="avatar-trigger" class="avatar-button" aria-label="${t('账号与个人设置')}" aria-expanded="false" aria-haspopup="dialog"> <span class="avatar">${longName ? 'A' : '林'}</span>${icon('down')}</button></div></header><main id="main" tabindex="-1"><div class="page-heading"><div><h1>${t('事项')}</h1><p>${t('需求、缺陷与交付，在这里推进。')}</p></div><button class="primary" data-preview="新建事项">${icon('plus')}${t('新建事项')}</button></div><div class="page-tabs">${['全部事项', '由我创建', '待我处理'].map((s, i) => `<button class="${i === 0 ? 'active' : ''}" data-preview="${s}">${t(s)}<span>${[4, 2, 1][i]}</span></button>`).join('')}</div><div class="filters"><label class="search-field">${icon('search')}<input aria-label="${t('搜索标题或描述')}" placeholder="${t('搜索标题或描述')}" id="issue-search"></label><button data-preview="全部状态">${t('全部状态')}${icon('down')}</button><button data-preview="全部版本">${t('全部版本')}${icon('down')}</button><span class="count">${t('共 4 条')}</span></div><section class="issue-list" aria-label="${t('事项')}"><div class="issue-row list-header"><span></span><span>${t('标题')}</span><span>${t('状态')}</span><span>${t('优先级')}</span><span class="owner-label">${t('负责人')}</span><span class="arrow-label"></span></div>${issues.map(([title, type, status, cls, owner, priority], i) => `<article class="issue-row" data-title="${title}"><input type="checkbox" aria-label="${title}"><div class="issue-copy"><div class="issue-title">${title}</div><div class="issue-subtitle">${t(type)} · #${128 - i} &nbsp; / &nbsp; DevLoom · v0.2</div></div><span class="status ${cls}">${t(status)}</span><span class="priority">${t(priority)}</span><span class="owner"><span class="avatar">${owner.slice(0, 1)}</span>${owner}</span><span class="row-arrow">${icon('right')}</span></article>`).join('')}</section><div class="pagination"><span>${t('第 1–4 条，共 4 条')}</span><div><button disabled aria-label="${t('上一页')}">‹</button><button class="current" aria-current="page">1</button><button disabled aria-label="${t('下一页')}">›</button></div></div></main></div></div><nav class="bottom-nav" aria-label="移动主导航">${nav()}</nav>`;
}
function closeAccount(returnFocus = true) {
  opened = false;
  menu.hidden = true;
  if (accountDialog.open) accountDialog.close();
  const trigger = document.querySelector('#avatar-trigger');
  trigger?.setAttribute('aria-expanded', 'false');
  if (returnFocus) trigger?.focus({ preventScroll: true });
}
function openAccount() {
  closeAccount(false);
  opened = true;
  const trigger = document.querySelector('#avatar-trigger');
  trigger.setAttribute('aria-expanded', 'true');
  const mobile = matchMedia('(max-width: 767px)').matches;
  if (scheme === 'c' || (scheme === 'b' && mobile)) {
    accountDialog.className = scheme === 'c' ? 'drawer' : 'sheet';
    accountDialog.innerHTML = `<header class="drawer-heading"><h2 id="account-title">${t('我的账号')}</h2><button class="icon-button" data-close-account aria-label="${t('关闭')}">${icon('close')}</button></header><div class="drawer-body">${identity()}${action('个人中心', 'user', scheme === 'c' ? '查看资料和个人设置' : '')}${scheme === 'c' ? action('Git 账号', 'git', '个人代码仓库身份') + action('MCP 接入', 'plug', '管理个人 Token 与接入配置') : ''}${preferences()}</div><footer class="drawer-footer">${action('退出登录', 'exit')}</footer>`;
    accountDialog.showModal();
  } else {
    menu.className = `account-surface ${scheme === 'b' ? 'card' : ''}`;
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', t('我的账号'));
    menu.innerHTML = `${identity()}<hr class="menu-rule">${action('个人中心', 'user')}${scheme === 'b' ? `<hr class="menu-rule">${preferences()}` : `<div class="mobile-preferences">${preferences()}</div>`}<hr class="menu-rule">${action('退出登录', 'exit')}`;
    menu.hidden = false;
    const rect = trigger.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - menu.offsetWidth - 12, Math.max(12, rect.right - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - menu.offsetHeight - 12))}px`;
    menu.querySelector('button')?.focus({ preventScroll: true });
  }
}
function rerender() {
  const wasOpen = opened;
  const search = document.querySelector('#issue-search')?.value || '';
  const selected = [...document.querySelectorAll('.issue-row input:checked')].map(input => input.closest('[data-title]').dataset.title);
  closeAccount(false); render();
  document.querySelector('#issue-search').value = search;
  document.querySelectorAll('[data-title]').forEach(row => {
    row.hidden = !row.dataset.title.includes(search.trim());
    row.querySelector('input').checked = selected.includes(row.dataset.title);
  });
  if (wasOpen) openAccount();
}
function notify(message) {
  clearTimeout(toastTimer);
  const toast = document.querySelector('#toast');
  toast.textContent = message; toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}
function preview(name) {
  closeAccount(false);
  const signout = name === '退出登录';
  const description = signout
    ? (locale === 'en' ? 'This previews the sign-out entry only. Your actual account remains signed in.' : '此处仅演示退出入口，不会退出你的真实账号。')
    : (locale === 'en' ? `The selected entry opens “${t(name)}”. This prototype keeps the sample page in place.` : `所选入口将打开「${t(name)}」。本原型展示跳转反馈，保留当前模拟页面。`);
  previewDialog.innerHTML = `<h2 id="preview-title">${t(name)}</h2><p>${description}</p><div class="dialog-actions">${signout ? `<button data-close-preview>${t('取消')}</button>` : ''}<button class="${signout ? '' : 'primary'}" data-preview-done>${t(signout ? '演示退出' : '完成')}</button></div>`;
  previewDialog.showModal();
}
function applyTheme() {
  document.documentElement.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.scheme) {
    closeAccount(false); scheme = button.dataset.scheme; history.replaceState(null, '', `#${scheme}`); render(); openAccount();
  } else if (button.id === 'avatar-trigger') { opened ? closeAccount() : openAccount(); }
  else if (button.id === 'preview-open') openAccount();
  else if (button.id === 'long-name') { longName = !longName; rerender(); }
  else if (button.id === 'review-locale' || button.hasAttribute('data-top-locale')) { locale = locale === 'en' ? 'zh-CN' : 'en'; rerender(); }
  else if (button.hasAttribute('data-top-theme')) { theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); }
  else if (button.hasAttribute('data-close-account')) closeAccount();
  else if (button.dataset.action) preview(button.dataset.action);
  else if (button.hasAttribute('data-close-preview') || button.hasAttribute('data-preview-done')) {
    previewDialog.close(); document.querySelector('#avatar-trigger').focus();
    if (button.hasAttribute('data-preview-done')) notify(locale === 'en' ? 'Preview complete. No account data was changed.' : '演示完成，未修改账号数据。');
  } else if (button.dataset.preview) preview(button.dataset.preview);
});
document.addEventListener('pointerdown', event => {
  if (opened && !menu.hidden && !menu.contains(event.target) && !event.target.closest('#avatar-trigger')) closeAccount(false);
});
document.addEventListener('change', event => {
  if (event.target.dataset.preference === 'locale') { locale = event.target.value; rerender(); }
  if (event.target.dataset.preference === 'theme') { theme = event.target.value; applyTheme(); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'issue-search') document.querySelectorAll('[data-title]').forEach(row => { row.hidden = !row.dataset.title.includes(event.target.value.trim()); });
});
document.addEventListener('keydown', event => {
  if (!opened || menu.hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); closeAccount(); }
  if (event.target.tagName === 'SELECT') return;
  const focusable = [...menu.querySelectorAll('button, select')].filter(element => element.getClientRects().length);
  const index = focusable.indexOf(document.activeElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? focusable.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + focusable.length) % focusable.length;
    focusable[target]?.focus();
  }
});
menu.addEventListener('focusout', event => {
  if (opened && !menu.hidden && !menu.contains(event.relatedTarget) && event.relatedTarget?.id !== 'avatar-trigger') closeAccount(false);
});
accountDialog.addEventListener('cancel', event => { event.preventDefault(); closeAccount(); });
accountDialog.addEventListener('click', event => {
  if (event.target === accountDialog) {
    const rect = accountDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeAccount();
  }
});
previewDialog.addEventListener('close', () => document.querySelector('#avatar-trigger')?.focus());
window.addEventListener('resize', () => { if (opened) closeAccount(false); });
window.addEventListener('hashchange', () => { if (['a', 'b', 'c'].includes(location.hash.slice(1))) { closeAccount(false); scheme = location.hash.slice(1); render(); } });
new ResizeObserver(([entry]) => document.documentElement.style.setProperty('--review-height', `${entry.borderBoxSize[0].blockSize}px`)).observe(document.querySelector('.review'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'system') applyTheme(); });
render();
applyTheme();
