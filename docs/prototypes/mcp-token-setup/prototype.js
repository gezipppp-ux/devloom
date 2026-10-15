/* Prototype only: no API requests, real tokens or persistent credentials. */
const query = new URLSearchParams(window.location.search);
const variant = ['a', 'b', 'c', 'create'].includes(query.get('view')) ? query.get('view') : 'a';
const secret = 'wc_mcp_demo_only_7p4j9m2k6x8n3v5q';
const prompt = `请为当前 Agent 安装并配置 Web Coding MCP。

Skills 来源：https://web-coding.example/skills/SKILL.md
MCP 地址：https://web-coding.example/mcp
个人 Token：${secret}
到期时间：2026-11-14T18:00:00+08:00（北京时间）

1. 拉取并校验 Skills 的名称、版本和来源，安装或更新本地 web-coding-mcp/SKILL.md；之后每次使用前检查并拉取新版。
2. 根据当前客户端配置 Streamable HTTP MCP。将 Token 存入客户端凭据配置或本地环境变量，不写入项目、Skills 或日志，也不要在回复中复述 Token。
3. 配置后调用 whoami 和 tools/list，确认连接、有效权限及实际到期时间；如需重启或重新加载客户端，请明确告诉我。
4. 每次使用前检查到期时间，剩余不足 7 天时提醒我更新；已经过期时停止调用，提示创建新 Token。如支持定时提醒，请在到期前 3 天提醒一次；否则明确说明只能在使用时提醒。提醒内容不包含 Token。
5. 发布需求或 Bug 前，按 Skills 核实相关原型资料并与我确认完整草稿。本次只完成配置，不发布事项或启动开发。

请反馈安装版本、连接验证结果和提醒方式。`;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const copyIcon = '<svg class="copy-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 5V3.5A1.5 1.5 0 0 0 11.5 2h-8A1.5 1.5 0 0 0 2 3.5v8A1.5 1.5 0 0 0 3.5 13H5"/></svg>';
const button = (text = '复制配置提示词与 Token') => `<button class="primary" type="button" data-copy="prompt">${copyIcon}${text}</button>`;
const details = () => `<details><summary>查看完整配置提示词</summary><pre tabindex="0">${escape(prompt)}</pre></details>`;
const tokenField = () => `<div class="credential"><div class="credential-top"><h3>个人 Token</h3><small>仅在本次显示</small></div><input class="token-input" aria-label="新建 Token" value="${secret}" readonly spellcheck="false"></div>`;
const heading = (subtitle) => `<a href="?view=create" class="back">← 返回创建表单</a><header class="heading"><div class="heading-line"><span class="success-icon" aria-hidden="true">✓</span><h1>Token 已创建</h1></div><p>${subtitle}</p></header>`;
const expiry = () => `<div class="expiry"><span class="small muted">到期时间 · 北京时间</span><strong>2026-11-14 18:00</strong><p>提示词已包含到期时间和提醒要求。由 Agent 确认实际支持的提醒方式。</p></div>`;
const tokenList = () => `<div class="list-heading"><div><p class="eyebrow">PERSONAL SETTINGS</p><h1>MCP 接入</h1><p>连接你的 Agent，查询项目并发布需求或 Bug。</p></div><a class="button" href="?view=create">＋ 创建 Token</a></div><section class="panel connection"><h3>连接地址</h3><code>https://web-coding.example/mcp</code></section><h2>个人 Token <span class="tag">1</span></h2><section class="panel token-list"><div class="token-row"><span class="key-icon" aria-hidden="true">⌘</span><div class="row-title"><h3>工作电脑 Codex</h3><p>全部可访问项目 · 2026-11-14 18:00 到期</p></div><span class="tag">可用</span></div></section><p class="end-note">原型使用示例凭证，不会创建 Token 或连接真实服务。</p>`;
const screens = {
  a: () => `${heading('把下面这段内容发给 Agent，一次完成 Skills 安装与 MCP 配置。')}<div class="prompt-layout"><section class="panel"><div class="panel-head"><div><h2>发送给 Agent 的完整内容</h2><p>Skills 安装提示 + MCP 连接信息 + Token + 到期提醒</p></div><span class="tag">可直接粘贴</span></div><div class="prompt-body"><textarea class="prompt" aria-label="完整配置提示词" readonly spellcheck="false">${escape(prompt)}</textarea></div><div class="prompt-foot"><p class="notice"><span aria-hidden="true">ⓘ</span>此内容包含完整 Token，离开后无法再次查看。</p><div class="actions">${button()}<a class="button quiet" href="?view=c&list=1">已保存，返回列表</a></div></div></section><aside class="panel details-panel"><span class="small muted">本次创建</span><div class="token-name">工作电脑 Codex</div><div class="scope-tags"><span>读取项目</span><span>发布事项</span><span>上传附件</span></div><dl class="meta-list"><div><dt>项目范围</dt><dd>全部可访问项目</dd></div><div><dt>有效期</dt><dd>30 天</dd></div></dl>${expiry()}</aside></div><p class="end-note">发送后，由 Agent 返回安装版本、连接结果和提醒方式。复制内容不代表已完成配置。</p>`,
  b: () => `${heading('复制一次，发送一次。剩余配置交给 Agent。')}<div class="guide-layout"><ol class="steps"><li class="active"><span class="step-num">1</span><div><h3>复制配置内容</h3><p>已包含安装提示、完整 Token 和到期时间。</p></div></li><li><span class="step-num">2</span><div><h3>发送给 Agent</h3><p>粘贴到你正在使用的 Agent 对话中。</p></div></li><li><span class="step-num">3</span><div><h3>查看配置结果</h3><p>由 Agent 验证连接，并告知是否已设置到期提醒。</p></div></li></ol><section class="panel guide-card"><p class="eyebrow">READY TO CONNECT</p><h2>工作电脑 Codex</h2><p class="lead">下面的凭证与安装说明会一起复制。</p>${tokenField()}<div class="inline-meta"><span>全部可访问项目</span><span>到期：2026-11-14 18:00 · 北京时间</span></div><ul class="included"><li>安装并自动更新 Skills</li><li>自动配置 MCP 连接</li><li>验证身份与可用权限</li><li>检查有效期并提醒更新</li></ul>${button('复制全部，发送给 Agent')}${details()}<p class="notice" style="margin-top: 18px">ⓘ 完整 Token 仅在本次显示，请在离开前复制。</p></section></div><div class="actions"><a class="button quiet" href="?view=c&list=1">已保存，返回列表 →</a></div>`,
  c: tokenList,
  create: () => `<a href="?view=a" class="back">← 返回 MCP 接入</a><header class="heading"><p class="eyebrow">NEW CONNECTION</p><h1>创建 MCP Token</h1><p>设置名称、有效期和授权范围，创建后直接交给 Agent 配置。</p></header><form class="panel create-form" id="create-form"><div class="form-grid"><label class="field">Token 名称<input name="name" value="工作电脑 Codex" required maxlength="100"></label><label class="field">有效期<select name="expiry"><option>7 天</option><option selected>30 天</option><option>90 天</option><option>365 天</option></select></label></div><fieldset><legend>允许的操作</legend><div class="choices"><label><input type="checkbox" checked disabled>读取项目 <small class="muted">必选</small></label><label><input type="checkbox" checked>发布与编辑事项</label><label><input type="checkbox" checked>指派负责人</label><label><input type="checkbox" checked>管理版本</label><label><input type="checkbox" checked>上传附件</label></div></fieldset><fieldset><legend>项目范围</legend><div class="choices"><label><input type="radio" name="range" checked value="all">全部可访问项目</label><label><input type="radio" name="range" value="selected">指定项目</label></div><p class="muted small" style="margin-top: 10px" id="project-help">包含当前及以后可访问的项目，实际权限受项目授权限制。</p><div class="choices" id="project-choices" hidden><label><input type="checkbox" checked>Web Coding</label><label><input type="checkbox">客户管理系统</label></div></fieldset><footer class="form-footer"><p class="muted small">完整 Token 仅在创建成功时显示一次。</p><button class="primary" type="submit">创建 Token</button></footer></form><p class="end-note">三种方案共用此创建表单，已移除附件上传教程及与创建无关的说明。这里只模拟创建。</p>`
};
document.querySelectorAll('[data-view]').forEach(link => {
  if (link.dataset.view === variant) link.setAttribute('aria-current', 'page');
});
document.querySelector('#main').innerHTML = screens[variant]();
const dialog = document.querySelector('#handoff-dialog');
if (variant === 'c' && !query.has('list')) {
  dialog.innerHTML = `<header class="dialog-head"><span class="success-icon" aria-hidden="true">✓</span><button class="dialog-close" type="button" aria-label="关闭配置提示" data-close>×</button></header><div class="dialog-body"><h1 id="dialog-title">Token 已创建</h1><p>把安装提示与 Token 一起发给 Agent，<br>让它完成 Skills 安装和 MCP 配置。</p><div class="compact-meta"><div><strong>工作电脑 Codex</strong><small>全部可访问项目</small></div><div><strong>2026-11-14 18:00 到期</strong><small>北京时间 · 有效期 30 天</small></div></div>${tokenField()}<ul class="included"><li>一次复制完整安装提示与凭证</li><li>包含到期时间，让 Agent 提醒更新</li></ul>${details()}</div><footer class="dialog-footer">${button('复制全部，让 Agent 配置')}<p>完整 Token 仅在本次显示，关闭前请复制。</p></footer>`;
  dialog.querySelector('.primary').classList.add('full-width');
  dialog.showModal();
}
let toastTimer;
function toast(text) {
  const node = document.querySelector('#toast');
  // A native modal must own its feedback so it remains above the backdrop.
  if (dialog.open) dialog.append(node);
  else document.body.append(node);
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
}
document.addEventListener('click', async event => {
  if (event.target.closest('[data-close]')) dialog.close();
  const target = event.target.closest('[data-copy]');
  if (!target) return;
  try {
    await navigator.clipboard.writeText(prompt);
    target.textContent = '✓ 已复制，粘贴给 Agent';
    toast('已复制完整配置提示词、示例 Token 与到期时间');
  } catch {
    const block = document.querySelector('textarea.prompt');
    if (block) { block.focus(); block.select(); }
    else { const disclosure = target.closest('section, dialog')?.querySelector('details'); if (disclosure) disclosure.open = true; }
    toast('请选中完整配置提示词后手动复制');
  }
});
document.querySelector('#create-form')?.addEventListener('submit', event => {
  event.preventDefault();
  window.location.href = '?view=a';
});
document.querySelectorAll('[name="range"]').forEach(input => input.addEventListener('change', () => {
  document.querySelector('#project-choices').hidden = input.value !== 'selected';
  document.querySelector('#project-help').textContent = input.value === 'selected' ? '选择允许此 Token 访问的项目。' : '包含当前及以后可访问的项目，实际权限受项目授权限制。';
}));
