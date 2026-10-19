/* Standalone review prototype. All state is simulated in memory. No API calls. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const paths = {
    code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-17-2 20"/>',
    home: '<path d="m3 10 9-7 9 7v11H3Zm6 11v-8h6v8"/>',
    folder: '<path d="M3 6h7l2 3h9v12H3Z"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
    send: '<path d="m3 11 18-8-8 18-2-8Zm8 2L21 3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    down: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Zm-4 9 3 3 5-5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    bell: '<path d="M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3Zm4 11h4"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    refresh: '<path d="M20 9a8 8 0 1 0 0 7m0-13v6h-6"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.folder}</svg>`;
  const params = new URLSearchParams(location.search);
  const validModes = ['a', 'b', 'c'];
  const validStates = ['form', 'empty', 'submitting', 'connecting', 'receiving', 'checkout', 'slow', 'offline', 'failed', 'ready'];
  let mode = validModes.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'a';
  let state = validStates.includes(params.get('state')) ? params.get('state') : 'receiving';
  let language = params.get('lang') === 'en' ? 'en' : 'zh';
  let longContent = params.has('long');
  let drawerOpen = mode === 'c' && !['form', 'empty'].includes(state);
  let destination = '';
  let account = 'personal';
  let timers = [];
  let playing = false;
  let toastTimer;
  const t = (zh, en) => language === 'en' ? en : zh;
  const projectName = () => longContent ? 'DevLoom 企业级研发协作平台 · 多区域交付与客户服务工作空间' : 'DevLoom Web Console';
  const repository = () => longContent ? 'platform/enterprise-development-collaboration-and-customer-services' : 'devloom/web-console';
  const stateNames = () => [
    t('创建前', 'Before creation'), t('未配置 Git 账号', 'No Git account'), t('提交中', 'Submitting'),
    t('连接仓库', 'Connecting'), t('下载中 · 64%', 'Downloading · 64%'), t('整理文件', 'Preparing files'),
    t('长时间无更新', 'No recent updates'), t('连接中断', 'Connection lost'), t('创建失败', 'Failed'), t('创建完成', 'Ready'),
  ];
  const isForm = () => ['form', 'empty'].includes(state);
  const isRunning = () => ['submitting', 'connecting', 'receiving', 'checkout', 'slow', 'offline'].includes(state);
  const stageIndex = () => ({ form: -1, empty: -1, submitting: -1, connecting: 0, receiving: 1, slow: 1, offline: 1, checkout: 2, failed: -1, ready: 4 })[state];
  const status = () => ({
    form: [t('创建你的工作空间', 'Create your workspace'), t('选择个人 Git 账号，为这个项目准备一份属于你的代码副本。', 'Choose your Git account to prepare your own copy of this project.')],
    empty: [t('先连接你的 Git 账号', 'Connect your Git account'), t('添加账号后，回到这里创建工作空间。', 'Add an account, then return here to create your workspace.')],
    submitting: [t('正在提交创建请求', 'Submitting your request'), t('正在确认请求是否受理，请稍候。', 'Checking that your request has been accepted. Please wait.')],
    connecting: [t('正在验证仓库访问', 'Checking repository access'), t('正在连接仓库并验证所选 Git 账号，暂时还没有可显示的百分比。', 'Connecting to the repository with your Git account. Progress is not available yet.')],
    receiving: [t('正在下载项目代码', 'Downloading project code'), t('首次使用需要准备仓库副本，耗时取决于仓库大小和网络情况。', 'Your first workspace needs a repository copy. Time depends on its size and your connection.')],
    checkout: [t('正在整理项目文件', 'Preparing project files'), t('代码已下载，正在整理文件并检查工作空间是否可用。', 'Code has been downloaded. Preparing files and checking that your workspace is ready.')],
    slow: [t('暂未收到新的进度', 'No recent progress updates'), t('正在查询最新状态。等待较久并不代表创建失败，无需重复提交。', 'Checking the latest status. A longer wait does not mean creation failed. No need to submit again.')],
    offline: [t('暂时无法获取进度', 'Progress is temporarily unavailable'), t('连接中断，创建结果尚未确认。重新连接后将继续查询这次创建。', 'The connection was lost, so the result is not yet confirmed. Reconnect to check this same request.')],
    failed: [t('仓库访问未通过', 'Repository access was denied'), t('所选 Git 账号没有该仓库的访问权限，请检查账号授权后重试。', 'Your Git account cannot access this repository. Check its permissions, then try again.')],
    ready: [t('工作空间准备好了', 'Your workspace is ready'), t('项目代码已准备完成，现在可以进入工作台。', 'Your project code is ready. You can now open your workbench.')],
  })[state];
  function badge() {
    const text = isForm() ? t('尚未创建', 'Not created') : state === 'ready' ? t('已就绪', 'Ready') : state === 'failed' ? t('创建失败', 'Failed') : ['slow', 'offline'].includes(state) ? t('状态待确认', 'Checking status') : state === 'submitting' ? t('正在提交', 'Submitting') : t('准备中', 'Preparing');
    return `<span class="badge ${state === 'ready' ? 'green' : state === 'failed' ? 'red' : !isForm() ? 'purple' : ''}">${text}</span>`;
  }
  function steps() {
    return `<ol class="steps" aria-label="${t('工作空间创建阶段', 'Workspace creation stages')}">${[
      t('验证访问', 'Verify access'), t('下载代码', 'Download code'), t('整理文件', 'Prepare files'), t('空间就绪', 'Ready'),
    ].map((name, i) => `<li class="${i < stageIndex() ? 'done' : i === stageIndex() ? 'active' : ''}" ${i === stageIndex() ? 'aria-current="step"' : ''}><span class="marker">${i < stageIndex() ? icon('check') : i + 1}</span><strong>${name}</strong></li>`).join('')}</ol>`;
  }
  function info() {
    const accountLabel = state === 'empty' ? t('尚未配置个人 Git 账号', 'No personal Git account yet') : account === 'team' ? t('团队 GitHub 账号', 'Team GitHub account') : t('我的 GitHub 账号', 'My GitHub account');
    return `<div class="workspace-info"><div class="repo-icon">${icon('folder')}</div><div><strong>${repository()}</strong><small>${accountLabel}${state === 'empty' ? '' : ' · HTTPS'}</small></div></div>`;
  }
  function progress(hero = false) {
    if (!isRunning()) return '';
    const percent = ['receiving','slow','offline'].includes(state) ? 64 : null;
    const label = state === 'submitting' ? t('等待受理', 'Waiting for acceptance') : state === 'connecting' ? t('连接仓库', 'Connecting to repository') : state === 'checkout' ? t('检出与校验', 'Checkout and validation') : ['slow', 'offline'].includes(state) ? t('上次收到的下载进度', 'Last reported download progress') : t('当前阶段 · 下载代码', 'Current stage · Download code');
    return `${hero && state === 'receiving' ? '' : `<div class="progress-label"><span>${label}</span>${percent === null ? `<span class="muted">${t('处理中', 'In progress')}</span>` : `<strong>${percent}%</strong>`}</div>`}
      ${percent === null ? `<div class="indeterminate" role="progressbar" aria-label="${label}"></div>` : `<progress value="${percent}" max="100" aria-label="${label}">${percent}%</progress>`}
      <div class="telemetry"><span>${t('已用时', 'Elapsed')} ${state === 'submitting' ? '00:01' : state === 'connecting' ? '00:08' : ['slow','offline'].includes(state) ? '03:38' : '02:18'}</span><span>${t('最近更新', 'Last update')} ${state === 'submitting' ? t('刚刚', 'Just now') : ['slow','offline'].includes(state) ? t('1 分 20 秒前', '1m 20s ago') : t('3 秒前', '3s ago')}</span></div>
      ${percent === null ? '' : `<p class="stage-note">${t('百分比仅代表下载阶段，完成后还需整理文件。', 'This percentage covers downloading only. File preparation follows.')}</p>`}`;
  }
  function notice() {
    if (state === 'slow') return `<div class="notice">${icon('clock')}<p>${t('暂时没有新的进度数据。你可以先浏览项目，稍后回来查看。', 'No new progress data yet. You can browse the project and check back later.')}</p></div>`;
    if (state === 'offline') return `<div class="notice neutral">${icon('info')}<p>${t('已保留本次创建记录。请先重新连接，避免重复创建。', 'This creation request has been retained. Reconnect before trying to create again.')}</p></div>`;
    if (state === 'failed') return `<div class="notice danger">${icon('info')}<p>${t('账号选择已保留。检查仓库权限后，可以重新尝试。', 'Your account selection has been kept. After checking repository access, you can retry.')}</p></div>`;
    return '';
  }
  function actions() {
    if (state === 'submitting') return `<div class="actions"><button class="button primary" disabled><span class="spinner"></span>${t('正在提交…', 'Submitting…')}</button></div>`;
    if (state === 'offline') return `<div class="actions"><button class="button primary" data-action="reconnect">${icon('refresh')}${t('重新连接', 'Reconnect')}</button><button class="button link" data-action="browse">${t('先浏览项目', 'Browse project')}</button></div>`;
    if (state === 'failed') return `<div class="actions"><button class="button primary" data-action="configure">${t('检查 Git 账号', 'Check Git account')}</button><button class="button" data-action="retry">${t('重新尝试', 'Try again')}</button></div>`;
    if (state === 'ready') return `<div class="actions"><button class="button primary" data-action="workbench">${t('打开开发工作台', 'Open development workbench')}${icon('arrow')}</button><button class="button link" data-action="tasks">${t('返回开发任务', 'Back to tasks')}</button></div><p class="footer-note">${t('开始开发时，再选择任务与分支。', 'Choose a task and branch when you are ready to start development.')}</p>`;
    return `<div class="actions"><button class="button" data-action="${mode === 'c' ? 'collapse' : 'browse'}">${t(mode === 'c' ? '收起，后台继续' : '先浏览项目', mode === 'c' ? 'Minimize and continue' : 'Browse project')}</button></div><p class="footer-note">${t('离开此页不会停止准备，可从项目「代码与环境」返回查看。', 'Preparation continues when you leave. Return through Code & environment.')}</p>`;
  }
  function details() {
    if (isForm() || state === 'submitting') return '';
    return `<details class="details"><summary>${t('查看准备详情', 'View preparation details')}</summary><p>00:00　${t('创建请求已受理', 'Creation request accepted')}</p>${state === 'failed' ? `<p>00:08　${t('仓库访问验证失败', 'Repository access check failed')}</p>` : `<p>00:08　${t(state === 'connecting' ? '正在连接仓库' : '仓库访问已通过', state === 'connecting' ? 'Connecting to repository' : 'Repository access verified')}</p>${['receiving','slow','offline','checkout','ready'].includes(state) ? `<p>00:12　${t('开始下载项目代码', 'Project download started')}</p>` : ''}${['checkout','ready'].includes(state) ? `<p>02:18　${t('下载完成，整理文件', 'Download complete, preparing files')}</p>` : ''}${state === 'ready' ? `<p>02:34　${t('工作空间就绪', 'Workspace ready')}</p>` : ''}`}</details>`;
  }
  function form() {
    return `<div class="draft-form"><div class="status-title"><h2>${status()[0]}</h2></div><p class="description">${status()[1]}</p>
      <label class="field">${t('个人 Git 账号', 'Personal Git account')}<select id="git-account" ${state === 'empty' ? 'disabled' : ''}>${state === 'empty' ? `<option>${t('暂无可用账号', 'No accounts available')}</option>` : `<option value="personal" ${account === 'personal' ? 'selected' : ''}>${t('我的 GitHub 账号', 'My GitHub account')} · github.com</option><option value="team" ${account === 'team' ? 'selected' : ''}>${t('团队 GitHub 账号', 'Team GitHub account')} · github.com</option>`}</select></label>
      <div class="actions">${state === 'empty' ? `<button class="button primary" data-action="add-account">${t('添加 Git 账号', 'Add Git account')}</button>` : `<button class="button primary" data-action="start">${t('创建工作空间', 'Create workspace')}${icon('arrow')}</button>`}</div><p class="footer-note">${t('首次创建需要下载项目代码，提交后会显示准备进度。', 'First-time setup downloads project code. Progress appears after submitting.')}</p></div>`;
  }
  function progressContent(wizard = false) {
    const glyph = state === 'ready' ? icon('check') : ['failed','offline','slow'].includes(state) ? icon('info') : '<span class="spinner"></span>';
    return `<div class="progress-content"><div class="status-title"><span class="status-icon" ${state === 'ready' ? 'style="color:var(--ui-success)"' : state === 'failed' ? 'style="color:var(--ui-danger)"' : ''}>${glyph}</span><h2>${status()[0]}</h2></div><p class="description">${status()[1]}</p>
      ${wizard ? state === 'receiving' ? `<div class="hero-number">64<span>%</span><small>${t('当前下载阶段', 'Current download stage')}</small></div>` : `<div class="hero-symbol">${icon(state === 'ready' ? 'check' : state === 'failed' || state === 'offline' ? 'info' : 'down')}</div>` : steps()}
      ${progress(wizard)}${notice()}${actions()}${details()}</div>`;
  }
  function asideNote() {
    return `<aside class="aside-note">${icon('shield')}<h3>${t('你的个人开发环境', 'Your personal development environment')}</h3><p>${t('使用你的 Git 账号准备独立的仓库副本，与其他成员的代码空间分开。', 'Uses your Git account to prepare a repository copy separate from other members.')}</p><div class="aside-line"></div><h3>${t('准备好之后', 'Once it is ready')}</h3><p>${t('打开开发工作台，选择任务和起始分支，再开始开发。', 'Open the workbench, choose a task and starting branch, then begin development.')}</p></aside>`;
  }
  function projectHeader() {
    return `<div class="page-heading"><div><h1>${projectName()}</h1><p>${t('连接团队协作与日常开发。', 'Bring team collaboration and everyday development together.')}</p></div><button class="button" data-action="new-issue">＋ ${t('新建事项', 'New issue')}</button></div>
      <div class="page-tabs"><span>${t('概览', 'Overview')}</span><span>${t('版本', 'Releases')}</span><span class="desktop-tab">${t('资产', 'Assets')}</span><span class="desktop-tab">${t('成员', 'Members')}</span><span class="desktop-tab">${t('设置', 'Settings')}</span><span class="desktop-tab">${t('提示词', 'Prompts')}</span><span class="selected">${t('代码与环境', 'Code & environment')}⌄</span></div>`;
  }
  function inlinePage() {
    return `${projectHeader()}<div class="content-grid"><section class="environment"><header class="environment-top"><h2>${t('我的代码与环境', 'My code & environment')}</h2>${badge()}</header>${info()}${isForm() ? form() : progressContent()}</section>${asideNote()}</div>`;
  }
  function wizardPage() {
    return `<section class="wizard"><header class="wizard-heading"><div class="eyebrow">${t('首次使用 / 个人工作空间', 'FIRST-TIME SETUP / PERSONAL WORKSPACE')}</div><h1>${state === 'ready' ? t('一切就绪，开始你的开发之旅', 'You are ready for your next project') : t('为你准备第一个工作空间', 'Preparing your first workspace')}</h1><p>${t('完成一次准备，之后即可直接进入这个项目的开发工作台。', 'Set up once, then access this project’s development workbench directly.')}</p></header><div class="wizard-body"><aside class="wizard-rail">${steps()}<p>${t('使用你的 Git 账号，准备独立的项目代码副本。', 'Prepare your own project code with your Git account.')}</p></aside><div class="wizard-content">${info()}${isForm() ? form() : progressContent(true)}</div></div><footer class="wizard-footer">${icon('shield')}<span>${t('工作空间属于你，准备完成后由你决定何时开始开发。', 'This workspace belongs to you. You decide when to start development.')}</span></footer></section>`;
  }
  function drawerPage() {
    return `${projectHeader()}<div class="content-grid"><section class="environment"><header class="environment-top"><h2>${t('我的代码与环境', 'My code & environment')}</h2>${badge()}</header>${info()}${isForm() ? form() : drawerOpen ? `<div class="compact-progress"><label class="field">${t('个人 Git 账号','Personal Git account')}<select disabled><option>${t('我的 GitHub 账号','My GitHub account')} · github.com</option></select></label><p class="description" style="margin-top:20px">${t('创建进度显示在右侧。你可以继续浏览项目，稍后回来查看。','Creation progress appears in the side panel. You can browse the project and check back later.')}</p><div class="actions"><button class="button" data-action="browse">${t('浏览项目','Browse project')}${icon('arrow')}</button></div></div>` : `<div class="compact-progress"><div class="status-title"><h2>${status()[0]}</h2></div>${progress()}<div class="actions"><button id="show-progress" class="button ${state === 'ready' ? 'primary' : ''}" data-action="${state === 'ready' ? 'workbench' : 'expand'}">${t(state === 'ready' ? '打开开发工作台' : '查看准备进度', state === 'ready' ? 'Open development workbench' : 'View preparation progress')}${icon('arrow')}</button></div></div>`}</section>${asideNote()}</div>`;
  }
  function otherPage() {
    return `${projectHeader()}<section class="project-overview"><h2>${destination === 'workbench' ? t('开发工作台', 'Development workbench') : destination === 'tasks' ? t('开发任务', 'Development tasks') : t('项目概览', 'Project overview')}</h2><p class="muted" style="margin:10px 0 16px">${destination === 'workbench' ? t('工作空间已就绪，选择任务后即可继续。', 'Your workspace is ready. Choose a task to continue.') : t('你可以继续浏览，工作空间会在后台准备。', 'You can continue browsing while your workspace is prepared.')}</p>${[['list', t('改进客户搜索体验', 'Improve customer search'), t('待开发 · v0.2', 'Planned · v0.2')],['folder',t('项目说明与参考资料', 'Project documentation'),t('查看团队共享的项目资料', 'View shared project resources')]].map(([glyph,title,desc]) => `<div class="overview-line">${icon(glyph)}<div><h3>${title}</h3><p>${desc}</p></div></div>`).join('')}<div class="actions"><button class="button" data-action="return">${t('返回代码与环境', 'Back to code & environment')}</button></div></section>`;
  }
  function reviewCaption() {
    const copy = {
      a: [t('A · 原位进度面板', 'A · Inline progress'), t('反馈留在原操作位置，当前阶段与离开入口清晰；最贴合现有使用路径。', 'Feedback stays where the action happened, with a clear current stage and way to leave.')],
      b: [t('B · 首次创建引导页', 'B · First-time guide'), t('把第一次准备作为独立体验，阶段清楚、注意力集中；适合新用户引导。', 'A dedicated first-time experience keeps attention on progress and the next step.')],
      c: [t('C · 可收起进度抽屉', 'C · Progress drawer'), t('侧边查看进度，收起后顶栏保留入口；适合等待时继续浏览项目。', 'Follow progress at the side and reopen it from the top bar while browsing the project.')],
    }[mode];
    return `<div class="review-caption"><b>${copy[0]}</b><span>${copy[1]}</span></div>`;
  }
  function renderReview() {
    $('#review').innerHTML = `<header class="review-bar"><div class="review-intro"><strong>${t('首次创建工作空间', 'First workspace creation')}</strong><small>${t('界面方案 · 模拟数据', 'UI proposals · Simulated data')}</small></div><nav class="variants" aria-label="${t('界面方案', 'UI proposals')}">${['a','b','c'].map((key,i) => `<button data-mode="${key}" aria-pressed="${mode === key}">${['A','B','C'][i]} · ${[t('原位面板', 'Inline'),t('首次引导', 'Guided'),t('进度抽屉', 'Drawer')][i]}</button>`).join('')}</nav><div class="review-tools"><select id="demo-state" aria-label="${t('演示状态', 'Demo state')}">${validStates.map((key,i) => `<option value="${key}" ${state === key ? 'selected' : ''}>${stateNames()[i]}</option>`).join('')}</select><button class="button" data-action="play">${icon(playing ? 'close' : 'play')}${playing ? t('停止演示', 'Stop demo') : t('播放创建过程', 'Play creation')}</button><button class="lang" data-action="language" aria-label="${t('切换为英文', 'Switch to Chinese')}">${language === 'zh' ? 'EN' : '中文'}</button></div></header>`;
  }
  function navItems() {
    return [['home',t('工作台','Home')],['folder',t('项目','Projects')],['list',t('事项','Issues')],['code',t('开发','Develop')],['send',t('交付','Delivery')]].map(([glyph,label]) => `<button class="nav-item ${glyph === 'folder' ? 'active' : ''}" data-action="nav" aria-label="${label}">${icon(glyph)}<span>${label}</span></button>`).join('');
  }
  function render() {
    const focusId = document.activeElement?.id;
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    renderReview();
    $('#app').innerHTML = `<div class="shell ${mode === 'c' && drawerOpen ? 'has-drawer' : ''}"><aside class="sidebar"><div class="brand">${icon('code')}<span>DevLoom</span></div><nav class="nav" aria-label="${t('主导航','Main navigation')}">${navItems()}</nav><div class="sidebar-foot">DevLoom<br>${t('让想法成为成果', 'Bring ideas to life')}</div></aside><div class="shell-body"><header class="topbar"><div class="context">${icon('folder')}<strong>${projectName()}</strong><span class="slash">/</span><span class="muted crumb">${t('代码与环境','Code & environment')}</span></div><div class="top-actions">${!isForm() && state !== 'submitting' ? `<button id="progress-trigger" class="task-chip" data-action="expand"><i class="dot"></i><span class="chip-text">${state === 'ready' ? t('空间已就绪','Workspace ready') : state === 'failed' ? t('准备失败','Setup failed') : ['slow','offline'].includes(state) ? t('查看空间状态','Check workspace') : t('空间准备中','Preparing workspace')}</span>${icon('down')}</button>` : ''}${icon('bell')}<div class="avatar" aria-label="${t('林晓的账号','Lin Xiao account')}">LX</div></div></header><main class="main">${destination ? otherPage() : mode === 'b' ? wizardPage() : mode === 'c' ? drawerPage() : inlinePage()}${reviewCaption()}</main></div></div><nav class="bottom-nav" aria-label="${t('移动端导航','Mobile navigation')}">${navItems()}</nav>`;
    const drawer = $('#drawer');
    if (drawer.open) drawer.close();
    if (mode === 'c' && drawerOpen && !isForm()) {
      drawer.innerHTML = `<header class="drawer-head"><h2 id="drawer-title">${t('工作空间准备进度','Workspace setup progress')}</h2><button data-action="collapse" aria-label="${t('收起进度面板','Minimize progress panel')}">${icon('close')}</button></header>${info()}${progressContent()}`;
      if (matchMedia('(max-width:767px)').matches) drawer.showModal(); else drawer.show();
    }
    if (focusId && document.getElementById(focusId) && !drawer.matches(':modal')) document.getElementById(focusId).focus({preventScroll:true});
    $('#announcement').textContent = status()[0];
  }
  function stop() { timers.forEach(clearTimeout); timers = []; playing = false; }
  function setState(next) {
    state = next;
    if (isForm()) drawerOpen = false;
    render();
  }
  function play() {
    stop(); playing = true; destination = ''; drawerOpen = mode === 'c';
    setState('submitting');
    [['connecting',1200],['receiving',3300],['checkout',6500],['ready',8500]].forEach(([next,delay]) => timers.push(setTimeout(() => { if (next === 'ready') playing = false; setState(next); },delay)));
  }
  function toast(message) {
    clearTimeout(toastTimer); $('.toast')?.remove();
    const node = document.createElement('div'); node.className = 'toast'; node.role = 'status'; node.textContent = message; document.body.append(node);
    toastTimer = setTimeout(() => node.remove(),3500);
  }
  document.addEventListener('click', (event) => {
    const variant = event.target.closest('[data-mode]');
    if (variant) {
      stop(); mode = variant.dataset.mode; destination = ''; drawerOpen = mode === 'c' && !isForm();
      history.replaceState(null,'',`${location.pathname}${location.search}#${mode}`); render();
      document.querySelector(`[data-mode="${mode}"]`).focus({preventScroll:true}); return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'play') { if (playing) { stop(); render(); } else play(); }
    if (action === 'language') { language = language === 'zh' ? 'en' : 'zh'; render(); }
    if (action === 'start' || action === 'retry') play();
    if (action === 'configure') { stop(); destination = ''; setState('form'); toast(t('已保留原账号，请检查或切换账号后再次创建。','Your account has been kept. Check or switch it, then create again.')); }
    if (action === 'add-account') { setState('form'); toast(t('演示：已添加 Git 账号，可以继续创建。','Demo: Git account added. You can now create the workspace.')); }
    if (action === 'reconnect') { setState('receiving'); toast(t('已重新连接，继续查看同一次创建。','Reconnected. Showing the same creation request.')); }
    if (action === 'collapse') { drawerOpen = false; render(); $('#progress-trigger')?.focus(); }
    if (action === 'expand') { destination = ''; drawerOpen = mode === 'c'; render(); }
    if (['browse','workbench','tasks'].includes(action)) { drawerOpen = false; destination = action; render(); window.scrollTo(0,0); }
    if (action === 'return') { destination = ''; render(); }
    if (action === 'nav' || action === 'new-issue') toast(t('此处用于展示页面上下文；可体验创建、收起和返回操作。','This shows the surrounding page. Try creating, minimizing, or returning.'));
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'demo-state') { stop(); destination = ''; drawerOpen = mode === 'c' && !['form','empty'].includes(event.target.value); setState(event.target.value); }
    if (event.target.id === 'git-account') { account = event.target.value; render(); }
  });
  $('#drawer').addEventListener('cancel', (event) => { event.preventDefault(); drawerOpen = false; render(); $('#progress-trigger')?.focus(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); drawerOpen = false; render(); $('#progress-trigger')?.focus(); }
    if (event.key === 'Tab' && $('#drawer').matches(':modal')) {
      const targets = [...$('#drawer').querySelectorAll('button:not(:disabled), summary, a[href], select:not(:disabled)')].filter(node => node.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  matchMedia('(max-width:767px)').addEventListener('change', () => { if (drawerOpen) render(); });
  window.addEventListener('hashchange', () => { if (validModes.includes(location.hash.slice(1))) { stop(); mode = location.hash.slice(1); destination = ''; drawerOpen = mode === 'c' && !isForm(); render(); } });
  render();
})();
