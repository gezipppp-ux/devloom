/* Review-only prototype. No business API, command execution or real credentials. */
(() => {
  "use strict";
  const app = document.getElementById("app");
  const storageKey = "web-coding-setup-prototype-v1";
  const labels = ["管理员账号", "运行环境", "成员目录", "部门与权限", "测试账号", "第一个项目", "完成配置"];
  const subtitles = ["建立管理身份", "检测并安装工具", "项目与任务位置", "应用默认权限", "可跳过", "可跳过", "检查初始化结果"];
  const icons = {
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3Z"/><path d="M3 10h18"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 22"/>',
    box: '<path d="m12 3 9 5v9l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9m-4-17 9 5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    refresh: '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5m-4 6a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/>',
    file: '<path d="M5 3h9l5 5v13H5Zm9 0v6h5M8 13h8m-8 4h6"/>',
    save: '<path d="M5 3h12l4 4v14H3V3Zm2 0v6h9V3M7 21v-8h10v8"/>',
  };
  const icon = (name, spin = false) => `<svg class="icon${spin ? " spin" : ""}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const badge = (text, type = "") => `<span class="badge ${type}">${escape(text)}</span>`;
  const notice = (title, text, type = "") => `<div class="notice ${type}">${icon(type === "success" ? "check" : "info")}<div><strong>${escape(title)}</strong><p>${escape(text)}</p></div></div>`;
  const defaults = () => ({
    step: 0, maxStep: 0, done: {}, paused: false, finished: false, scenario: "missing",
    admin: null, adminDraft: { username: "admin", displayName: "管理员" },
    env: { git: false, codex: false, auth: false, deferred: false, issue: "", busy: "" },
    directory: "D:\\wt", directorySaved: false, directoryDenied: false, departments: false,
    accounts: [], accountDrafts: [
      { selected: true, username: "test-product", displayName: "测试#产品", department: "产品部门", kind: "product" },
      { selected: true, username: "test-dev", displayName: "测试#研发", department: "研发部门", kind: "developer" },
    ],
    projectDraft: { name: "", remoteUrl: "", description: "", members: [] }, project: null,
  });
  let state = defaults();
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved?.version === 1) state = saved.data;
    if (state.env.busy) { state.env.busy = ""; state.env.issue = "interrupted"; }
  } catch { /* The prototype also works without browser storage. */ }
  let secrets = {}, errors = {}, operation = 0, toastTimer;
  function persist() {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, data: state })); } catch { /* In-memory demo remains available. */ }
  }
  function message(text) {
    const toast = document.getElementById("toast");
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }
  const usernameValid = value => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value.trim());
  const passwordValid = value => typeof value === "string" && value.length >= 6 && value.length <= 256;
  function field(id, label, value = "", options = {}) {
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-field="${id}" ${options.password ? 'type="password" autocomplete="new-password"' : 'type="text" autocomplete="off"'} value="${escape(value)}" placeholder="${escape(options.placeholder || "")}" ${options.readonly ? "readonly" : ""} ${errors[id] ? `aria-invalid="true" aria-describedby="${id}-error"` : ""}>${options.hint ? `<p class="hint">${escape(options.hint)}</p>` : ""}${errors[id] ? `<p id="${id}-error" class="hint error">${escape(errors[id])}</p>` : ""}</div>`;
  }
  function top(title, description) {
    return `<div class="section-top"><div><h2 id="step-title" tabindex="-1">${title}</h2><p>${description}</p></div><span class="step-count">${String(state.step + 1).padStart(2, "0")} / 07</span></div>`;
  }
  function footer(label, { disabled = false, skip = "", caption = "", action = "next" } = {}) {
    return `<div class="wizard-footer"><button data-action="back" ${state.step === 0 || state.env.busy ? "disabled" : ""}>上一步</button><div class="footer-end">${skip ? `<button class="text-button" data-action="skip">${skip}</button>` : ""}<button class="primary" data-action="${action}" ${disabled ? "disabled" : ""}>${label}${icon("arrow")}</button></div></div>${caption ? `<p class="footer-caption">${caption}</p>` : ""}`;
  }
  function accountStep() {
    if (state.admin) return top("管理员账号已创建", "后续步骤将以此账号完成系统配置。") + notice(state.admin.displayName, `登录名：${state.admin.username} · 系统管理员`, "success") + footer("继续配置");
    return top("先创建管理员账号", "由你管理成员、项目和系统配置。") +
      `<div class="card"><div class="card-heading"><h3>管理员信息</h3>${badge("必填")}</div><div class="field-grid">${field("admin-username", "登录名", state.adminDraft.username, { hint: "3–64 位字母、数字、点、短横线或下划线。" })}${field("admin-display", "显示名称", state.adminDraft.displayName)}</div><div class="field-grid">${field("admin-password", "设置密码", secrets["admin-password"], { password: true, placeholder: "请使用演示密码", hint: "6–256 个字符，无预置密码。" })}${field("admin-confirm", "确认密码", secrets["admin-confirm"], { password: true, placeholder: "再次输入演示密码" })}</div><p class="hint">创建后自动登录并继续初始化。密码仅用于本次演示，不会发送或保存。</p></div>` +
      footer("创建管理员并继续", { caption: "管理员账号为必填步骤。测试成员将在后续按需创建。" });
  }
  function environmentStep() {
    const env = state.env;
    const ready = env.git && env.codex && !env.issue && !env.busy;
    let status = "";
    if (env.busy) status = notice(`正在安装 ${env.busy === "git" ? "Git" : "Codex CLI"}`, "正在执行安装并复查版本。此处为模拟过程；正式安装离开页面后仍会继续。");
    else if (env.issue === "failed") status = notice("Codex CLI 安装失败", "模拟网络不可用。Git 已安装成功，重试只处理仍缺失的 Codex CLI。", "error");
    else if (env.issue === "restart") status = notice("Git 已安装，等待重启生效", "当前服务的 PATH 尚未刷新。请重启服务后重新检测，检测通过前不能继续。", "warning");
    else if (env.issue === "unavailable") status = notice("此服务器暂不支持自动安装 Git", "没有可用的安装器或服务账号权限不足。请在服务器安装后重新检测。", "warning");
    else if (env.issue === "unknown") status = notice("Codex CLI 检测异常", "无法启动配置的 Codex。请检查安装位置或 CODEX_BIN 配置，再重新检测。", "error");
    else if (env.issue === "interrupted") status = notice("上次安装结果需要重新检测", "页面已刷新，演示进度不自动重放。正式版本会读取运行中的安装状态或重新检测。");
    else if (ready && env.auth) status = notice("运行环境已就绪", "工具与 Codex 登录检测通过，可以继续配置成员目录。", "success");
    else if (ready) status = notice("工具已就绪，Codex 尚未登录", "你可以完成认证后重新检测，也可以先继续团队配置。", "warning");
    else status = notice("检测到缺失工具", "安装计划已列在下方。点击一次“安装缺失工具”，依次完成 Git 和 Codex CLI 安装。", "warning");
    function tool(name, installed, kind, target, source) {
      let text = installed ? "已安装" : "待安装", type = installed ? "success" : "warning";
      if (env.busy === kind) { text = "安装中"; type = ""; }
      if (kind === "git" && env.issue === "restart") text = "待重启";
      if (kind === "codex" && env.issue === "unknown") { text = "检测异常"; type = "error"; }
      return `<div class="tool-row"><div class="tool-icon">${icon(env.busy === kind ? "refresh" : kind === "git" ? "code" : "box", env.busy === kind)}</div><div><span class="tool-name">${name}</span><small>${installed ? "v" + target : "服务端未就绪"}</small><p>${installed ? "已从服务环境检测到" : `安装目标 ${target} · ${source}`}</p></div>${badge(text, type)}</div>`;
    }
    return top("检查运行环境", "检查的是运行 Web Coding 的服务器。") + status +
      `<div class="card"><div class="card-heading"><h3>开发所需工具</h3>${badge("Windows · 示例")}</div>${tool("Git", env.git, "git", "2.51.0.windows.1", "winget / Git.Git")}${tool("Codex CLI", env.codex, "codex", "0.114.0", "npm / @openai/codex")}<div class="prerequisites"><span>${icon("check")}Node.js 22.13.0</span><span>${icon("check")}npm 可用</span><span>${icon("check")}PostgreSQL 已连接</span></div><p class="hint">版本均为演示数据；实施时实时检测并核对安装目标。</p><div class="inline-actions">${!ready && !["restart", "unavailable", "unknown"].includes(env.issue) ? `<button class="primary" data-action="install" ${env.busy ? "disabled" : ""}>${icon("box")}${env.issue === "failed" ? "重试缺失工具" : "安装缺失工具"}</button>` : ""}<button data-action="recheck" ${env.busy ? "disabled" : ""}>${icon("refresh")}重新检测</button></div></div>` +
      (ready && !env.auth ? `<div class="card"><div class="card-heading"><h3>Codex 认证</h3>${badge("待处理", "warning")}</div><p class="muted">在实际运行服务的账号下完成 Codex 登录，再返回检测。也可稍后处理，开始开发前会再次检查。</p><div class="path-preview"><code>codex login</code></div><div class="inline-actions"><button data-action="auth-check">已完成登录，重新检测</button></div><p class="hint">此按钮在原型中模拟认证成功。</p></div>` : "") +
      footer(ready && !env.auth ? "稍后登录，继续配置" : "继续配置", { disabled: !ready, caption: "已有合格版本保持不变。安装失败或待重启时，请处理后继续。" });
  }
  function directoryStep() {
    return top("选择成员目录", "项目仓库和任务目录统一保存在这里。") +
      `<div class="card"><div class="card-heading"><h3>成员项目与任务目录</h3>${badge(state.directorySaved ? "已保存" : "必填", state.directorySaved ? "success" : "")}</div><div class="field"><label for="directory">成员目录基础路径</label><div class="field-row"><input id="directory" data-field="directory" value="${escape(state.directory)}" ${state.directorySaved ? "readonly" : ""} ${errors.directory ? 'aria-invalid="true" aria-describedby="directory-error"' : ""}><button data-action="choose-directory" ${state.directorySaved ? "disabled" : ""}>${icon("folder")}浏览服务器目录</button></div><p class="hint">填写服务器上的绝对路径。建议使用短路径，例如 Windows 的 D:\\wt 或 Linux 的 /srv/wt。</p>${errors.directory ? `<p id="directory-error" class="hint error">${escape(errors.directory)}</p>` : ""}</div><h3>目录预览</h3><div id="path-preview" class="path-preview">${pathPreview()}</div><p class="hint">目录使用 Git 仓库名和登录用户名，例如 web-coding / admin。同名仓库的后创建项目自动加短后缀；修改显示名称不搬移目录。</p></div>` +
      notice("保存时检查写入权限", "目录不存在时会创建；无权限时保留输入并提示处理。项目文件会在成员准备开发空间时生成。") +
      `<label class="check-label"><input type="checkbox" id="directory-denied" ${state.directoryDenied ? "checked" : ""} ${state.directorySaved ? "disabled" : ""}><span class="hint">原型状态：模拟目录不可写</span></label>` +
      footer(state.directorySaved ? "继续配置" : "保存并继续");
  }
  function pathPreview() {
    const separator = state.directory.startsWith("/") ? "/" : "\\";
    const root = state.directory.replace(/[\\/]+$/, "") || "<基础目录>";
    const member = [root, "projects", "<仓库名>", "members", "<用户名>"].join(separator);
    return `<div class="path-line"><small>成员项目仓库</small><code>${escape(member + separator + "repository-<准备修订号>")}</code></div><div class="path-line"><small>任务 Worktree</small><code>${escape(member + separator + "worktree" + separator + "<任务目录>")}</code></div>`;
  }
  function departmentsStep() {
    const product = ["查看项目、需求与 Bug", "创建、编辑、分派和流转事项", "验收需求、验证 Bug", "管理发布版本", "查看协作、评论和发布交付", "查看普通资产"];
    const developer = ["查看项目、需求与 Bug", "变更事项状态", "查看协作、评论和发布交付", "查看代码和操作仓库", "查看、启动和继续 Agent 会话", "处理审批和停止执行"];
    function department(name, kind, count, text, list) {
      return `<div class="card"><div class="department-symbol">${icon(kind)}</div><div class="card-heading"><h3>${name}</h3>${badge(count + " 项权限")}</div><p class="hint">${text}</p><ul class="capabilities">${list.map(item => `<li>${icon("check")}<span>${item}</span></li>`).join("")}</ul><details><summary>查看权限边界</summary><ul><li>须加入项目后才能访问项目内容。</li><li>不包含系统管理、项目管理或敏感字段权限。</li><li>${name === "产品部门" ? "不包含代码或 Agent 执行权限。" : "不包含事项创建、分派和业务验收权限。"}</li></ul></details></div>`;
    }
    return top("建立默认部门", "应用现有权限模板，后续可在部门管理中调整。") +
      (state.departments ? notice("两个部门已创建", "返回或刷新不会重复创建，也不会覆盖已有授权。", "success") : notice("为团队准备两种工作角色", "系统将自动创建产品部门和研发部门，并赋予对应的功能上限。")) +
      `<div class="department-grid">${department("产品部门", "file", 12, "维护需求，组织协作与业务验收。", product)}${department("研发部门", "code", 13, "准备开发空间，通过 Agent 处理任务。", developer)}</div>` +
      notice("部门权限 + 项目授权", "部门决定能使用哪些功能；加入具体项目后，成员才获得该项目的数据访问权。") +
      footer(state.departments ? "继续配置" : "创建默认部门并继续");
  }
  function accountsStep() {
    if (state.accounts.length) return top("测试账号已创建", "每个账号已分配对应部门。") +
      `<div class="card">${state.accounts.map(account => `<div class="member-option"><div><strong>${escape(account.displayName)}</strong><small>${escape(account.username)}</small></div>${badge(account.department, "success")}</div>`).join("")}<p class="hint">初始密码不回显。测试账号首次登录仍需修改密码。</p></div>` + footer("继续配置");
    return top("创建测试账号", "快速体验产品与研发协作，也可以稍后添加正式成员。") +
      state.accountDrafts.map((account, index) => `<div class="card account-card ${account.selected ? "" : "off"}"><div class="card-heading"><label class="check-label"><input id="account-select-${index}" type="checkbox" data-account-select="${index}" ${account.selected ? "checked" : ""}><span><strong>${escape(account.displayName)}</strong><small style="display:block">${escape(account.department)} · 普通成员</small></span></label>${badge("可选")}</div><div class="account-fields"><div class="field-grid">${field(`account-name-${index}`, "显示名称", account.displayName)}${field(`account-login-${index}`, "登录名", account.username)}</div>${field(`account-password-${index}`, "初始密码", secrets[`account-password-${index}`], { password: true, placeholder: "填写演示密码", hint: "6–256 个字符，首次登录须修改；不保存密码草稿。" })}</div></div>`).join("") +
      `<p class="hint">“测试#产品 / 测试#研发”是显示名。中文与 # 不用于登录名。</p>` +
      footer("创建所选账号并继续", { skip: "跳过测试账号", disabled: !state.accountDrafts.some(account => account.selected), caption: "创建账号不会自动授予任何项目的访问权限。" });
  }
  function projectStep() {
    if (state.project) return top("第一个项目已创建", "项目和成员授权已保存。") +
      `<div class="card"><h3>${escape(state.project.name)}</h3><p><code>${escape(state.project.remoteUrl)}</code></p><p class="hint">负责人：${escape(state.admin.displayName)}。测试成员：${state.project.members.length} 人。</p></div>` + footer("查看初始化结果");
    return top("创建第一个项目", "填写仓库地址，开始组织团队协作。") +
      `<div class="card">${field("project-name", "项目名称", state.projectDraft.name, { placeholder: "例如：团队工作台" })}${field("project-remote", "Git 仓库地址", state.projectDraft.remoteUrl, { placeholder: "https://git.example.com/team/project.git", hint: "支持 HTTP(S) 或 SSH 地址，地址中不填写密码或令牌。" })}<div class="field"><label for="project-description">项目说明 <span class="muted">（可选）</span></label><textarea id="project-description" data-field="project-description" placeholder="简单说明这个项目的目标">${escape(state.projectDraft.description)}</textarea></div><div class="account-department">${icon("shield")}负责人：${escape(state.admin.displayName)}（${escape(state.admin.username)}）</div></div>` +
      `<div class="card"><div class="card-heading"><h3>加入项目的测试成员</h3>${badge("按部门分配权限")}</div>${state.accounts.length ? state.accounts.map(account => `<div class="member-option"><label class="check-label"><input type="checkbox" data-member="${escape(account.username)}" ${state.projectDraft.members.includes(account.username) ? "checked" : ""}><span>${escape(account.displayName)}<small>${escape(account.username)}</small></span></label>${badge(account.department === "产品部门" ? "产品协作 · 12 项" : "研发执行 · 13 项")}</div>`).join("") : `<p class="muted">已跳过测试账号。可以先创建项目，再从项目成员页面添加正式成员。</p>`}</div>` +
      notice("创建后即可进行项目协作", "开发成员之后再配置个人 Git 账号并准备开发空间。创建项目不会克隆仓库或启动任务。") +
      footer("创建项目并继续", { skip: "跳过项目创建" });
  }
  function completeStep() {
    const ready = canFinish();
    return top(ready ? "配置已准备好" : "还有配置需要处理", "核对初始化结果，完成后进入工作台。") +
      (!ready ? notice("请先完成必填步骤", "运行环境或基础配置尚未通过，请返回对应步骤处理。", "warning") : "") +
      `<div class="card"><div class="finish-symbol">${icon(ready ? "check" : "info")}</div><h2>${ready ? "你的工作台已准备就绪" : "初始化结果"}</h2><p class="muted">${ready ? "基础配置已保存，团队可以开始使用。" : "必填步骤通过后才能完成初始化。"}</p><dl class="summary-list"><div><dt>管理员</dt><dd>${escape(state.admin.displayName)}<small>登录名 ${escape(state.admin.username)}</small></dd></div><div><dt>运行环境</dt><dd>${state.env.git && state.env.codex && !state.env.issue ? "Git / Codex CLI 已安装" : "尚需处理"}<small>${state.env.auth ? "Codex 认证已通过" : "Codex 认证稍后完成"}</small></dd></div><div><dt>成员目录</dt><dd><code>${escape(state.directory)}</code></dd></div><div><dt>默认部门</dt><dd>产品部门 · 研发部门<small>已应用对应权限模板</small></dd></div><div><dt>测试账号</dt><dd>${state.accounts.length ? state.accounts.map(account => escape(account.displayName)).join("、") : "已跳过"}<small>${state.accounts.length ? "已分配部门；项目权限按选中成员授予" : "可在账号管理中添加正式成员"}</small></dd></div><div><dt>第一个项目</dt><dd>${state.project ? escape(state.project.name) : "已跳过"}<small>${state.project ? `已加入 ${state.project.members.length} 个测试成员` : "之后创建项目，并添加需要参与的成员"}</small></dd></div></dl></div>` +
      (!state.env.auth ? notice("开发前还有一项待办", "在服务器的服务账号下完成 Codex 登录，再从系统设置重新检测。项目协作可以先使用。", "warning") : "") +
      footer(state.project ? "完成并进入项目" : "完成并进入全部项目", { action: "finish", disabled: !ready, caption: "完成后不再自动显示初始化向导。" });
  }
  function canFinish() { return Boolean(state.admin && state.env.git && state.env.codex && !state.env.issue && !state.env.busy && state.directorySaved && state.departments); }
  const views = [accountStep, environmentStep, directoryStep, departmentsStep, accountsStep, projectStep, completeStep];
  function render(focus = false) {
    const scenario = document.getElementById("scenario");
    scenario.value = state.scenario;
    scenario.disabled = Boolean(state.env.busy);
    document.querySelector(".identity").innerHTML = state.admin ? `<span class="avatar">A</span><span>${escape(state.admin.username)}<small>系统管理员</small></span>` : `<span class="badge">等待创建管理员</span>`;
    if (state.paused) {
      app.innerHTML = `<section class="result-page"><div class="card"><div class="department-symbol">${icon("save")}</div><h1>已保存初始化进度</h1><p class="muted">${state.admin ? "正式版本会返回登录页；重新登录后继续未完成的步骤。" : "管理员尚未创建。再次进入初始化页面即可创建。"}</p><p>当前步骤：<strong>${labels[state.step]}</strong></p><p class="hint">演示进度仅保存在当前浏览器标签页；密码草稿已清除。</p><div class="inline-actions"><button class="primary" data-action="resume">继续初始化${icon("arrow")}</button></div></div></section>`;
      return;
    }
    if (state.finished) {
      app.innerHTML = `<section class="result-page"><div class="card"><div class="finish-symbol">${icon("check")}</div><h1>初始化完成</h1><p class="muted">${state.project ? `正式版本将打开项目「${escape(state.project.name)}」。` : "正式版本将进入全部项目，随时创建第一个项目。"}</p><div class="notice">${icon("info")}<div><strong>本次演示到这里结束</strong><p>所有操作都是模拟的，没有创建真实账号、项目或目录。</p></div></div><div class="inline-actions"><button data-action="review">返回查看配置结果</button><button class="primary" data-action="reset">重新体验</button></div></div></section>`;
      return;
    }
    app.innerHTML = `<div class="page-heading"><div><div class="eyebrow">WORKSPACE SETUP</div><h1>初始化你的工作台</h1><p>从管理员账号开始，为团队准备好协作环境。</p></div><button class="text-button" data-action="pause">保存并退出</button></div><div class="wizard"><aside><ol class="steps" aria-label="初始化步骤">${labels.map((label, index) => `<li><button class="step-button ${index === state.step ? "active" : ""} ${state.done[index] ? "done" : ""}" data-step="${index}" ${index > state.maxStep || state.env.busy ? "disabled" : ""} ${index === state.step ? 'aria-current="step"' : ""}><span class="step-dot">${state.done[index] === "skipped" ? "–" : state.done[index] ? icon("check") : index + 1}</span><span><strong>${label}</strong><small>${state.done[index] === "skipped" ? "已跳过" : state.done[index] ? "已保存" : subtitles[index]}</small></span></button></li>`).join("")}</ol><p class="sidebar-note"><strong>按步骤保存，随时继续</strong>基础配置需要完成。测试账号和第一个项目可跳过，之后再补充。</p></aside><section class="main-panel" aria-labelledby="step-title">${views[state.step]()}<p class="saved-note">${icon("save")}已完成的步骤保留结果，返回不会重复创建。</p></section></div>`;
    if (focus) { document.getElementById("step-title")?.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }
  function advance(status = "completed") {
    state.done[state.step] = status;
    state.step = Math.min(6, state.step + 1);
    state.maxStep = Math.max(state.maxStep, state.step);
    errors = {};
    persist(); render(true);
  }
  function invalid(nextErrors) {
    errors = nextErrors; render();
    document.getElementById(Object.keys(errors)[0])?.focus();
  }
  function next() {
    if (state.env.busy) return;
    if (state.step === 0 && !state.admin) {
      const issues = {};
      if (!usernameValid(state.adminDraft.username)) issues["admin-username"] = "请输入 3–64 位有效登录名。";
      if (!state.adminDraft.displayName.trim() || [...state.adminDraft.displayName.trim()].length > 80) issues["admin-display"] = "显示名称需为 1–80 个字符。";
      if (!passwordValid(secrets["admin-password"])) issues["admin-password"] = "密码需为 6–256 个字符。";
      if (secrets["admin-password"] !== secrets["admin-confirm"]) issues["admin-confirm"] = "两次输入的密码不一致。";
      if (Object.keys(issues).length) return invalid(issues);
      state.admin = { username: state.adminDraft.username.trim().toLowerCase(), displayName: state.adminDraft.displayName.trim() };
      delete secrets["admin-password"]; delete secrets["admin-confirm"];
      message("管理员已创建并自动登录（演示）");
    }
    if (state.step === 1) {
      if (!state.env.git || !state.env.codex || state.env.issue) return;
      state.env.deferred = !state.env.auth;
    }
    if (state.step === 2 && !state.directorySaved) {
      if (!/^(?:[A-Za-z]:\\|\/)/.test(state.directory.trim())) return invalid({ directory: "请填写服务器上的绝对路径，例如 D:\\wt 或 /srv/wt。" });
      if (state.directoryDenied) return invalid({ directory: "目录不可写，请选择服务账号有写入权限的目录。取消原型的异常模拟后可重试。" });
      state.directory = state.directory.trim(); state.directorySaved = true;
      message("基础目录已保存（演示）");
    }
    if (state.step === 3) { state.departments = true; message("产品部门、研发部门及权限已就绪（演示）"); }
    if (state.step === 4 && !state.accounts.length) {
      const selected = state.accountDrafts.filter(account => account.selected), issues = {}, usernames = new Set([state.admin.username]);
      if (!selected.length) return;
      state.accountDrafts.forEach((account, index) => {
        if (!account.selected) return;
        const login = account.username.trim().toLowerCase();
        if (!usernameValid(login)) issues[`account-login-${index}`] = "请输入 3–64 位有效登录名。";
        else if (usernames.has(login)) issues[`account-login-${index}`] = "登录名与管理员或另一个测试账号重复。";
        usernames.add(login);
        if (!account.displayName.trim() || [...account.displayName.trim()].length > 80) issues[`account-name-${index}`] = "显示名称需为 1–80 个字符。";
        if (!passwordValid(secrets[`account-password-${index}`])) issues[`account-password-${index}`] = "初始密码需为 6–256 个字符。";
      });
      if (Object.keys(issues).length) return invalid(issues);
      state.accounts = selected.map(account => ({ ...account, username: account.username.trim().toLowerCase(), displayName: account.displayName.trim() }));
      state.projectDraft.members = state.accounts.map(account => account.username);
      secrets = {};
      message(`已创建 ${state.accounts.length} 个测试账号（演示）`);
    }
    if (state.step === 5 && !state.project) {
      const issues = {}, draft = state.projectDraft;
      if (!draft.name.trim() || draft.name.trim().length > 80) issues["project-name"] = "项目名称需为 1–80 个字符。";
      let remoteValid = /^(https?:\/\/|ssh:\/\/|[A-Za-z0-9._-]+@[^\s:]+:)[^\s]+$/.test(draft.remoteUrl.trim());
      if (/^https?:\/\//.test(draft.remoteUrl)) {
        try { const url = new URL(draft.remoteUrl); remoteValid = remoteValid && !url.username && !url.password && !url.search && !url.hash && url.pathname !== "/"; } catch { remoteValid = false; }
      }
      if (!remoteValid) issues["project-remote"] = "填写有效的 HTTP(S) 或 SSH Git 地址，且不要嵌入密码或令牌。";
      if (Object.keys(issues).length) return invalid(issues);
      state.project = { ...draft, name: draft.name.trim(), remoteUrl: draft.remoteUrl.trim(), members: [...draft.members] };
      message("项目与所选成员授权已保存（演示）");
    }
    advance();
  }
  function reset() { operation++; state = defaults(); secrets = {}; errors = {}; persist(); render(true); }
  async function install() {
    if (state.env.busy) return;
    const run = ++operation;
    state.env.issue = "";
    for (const tool of ["git", "codex"]) {
      if (state.env[tool]) continue;
      state.env.busy = tool; persist(); render();
      await new Promise(resolve => setTimeout(resolve, 950));
      if (run !== operation) return;
      state.env[tool] = true;
    }
    state.env.busy = ""; state.env.issue = ""; persist(); render();
    message("工具安装完成（演示），可登录 Codex 或稍后处理");
  }
  function recheck() {
    if (state.env.busy) return;
    if (["failed", "unavailable", "unknown"].includes(state.env.issue)) return message("当前异常场景保持不变；可重试安装，或在评审工具栏切换“环境已就绪”。");
    if (state.env.issue === "restart") { state.env.git = true; state.env.codex = true; message("模拟服务已重启，工具检测通过"); }
    else message("环境检测已刷新（演示）");
    state.env.issue = ""; persist(); render();
  }
  app.addEventListener("input", event => {
    const id = event.target.dataset.field, value = event.target.value;
    if (!id) return;
    if (event.target.type === "password") { secrets[id] = value; return; }
    if (id === "admin-username") state.adminDraft.username = value;
    if (id === "admin-display") state.adminDraft.displayName = value;
    if (id === "directory") { state.directory = value; document.getElementById("path-preview").innerHTML = pathPreview(); }
    const accountMatch = /^account-(name|login)-(\d)$/.exec(id);
    if (accountMatch) state.accountDrafts[Number(accountMatch[2])][accountMatch[1] === "name" ? "displayName" : "username"] = value;
    if (id === "project-name") state.projectDraft.name = value;
    if (id === "project-remote") state.projectDraft.remoteUrl = value;
    if (id === "project-description") state.projectDraft.description = value;
    persist();
  });
  app.addEventListener("change", event => {
    if (event.target.dataset.accountSelect !== undefined) {
      state.accountDrafts[Number(event.target.dataset.accountSelect)].selected = event.target.checked;
      const id = event.target.id;
      persist(); render(); document.getElementById(id)?.focus();
    }
    if (event.target.dataset.member) {
      const members = new Set(state.projectDraft.members);
      if (event.target.checked) members.add(event.target.dataset.member); else members.delete(event.target.dataset.member);
      state.projectDraft.members = [...members]; persist();
    }
    if (event.target.id === "directory-denied") { state.directoryDenied = event.target.checked; persist(); }
  });
  app.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.step !== undefined) { state.step = Number(button.dataset.step); errors = {}; persist(); render(true); return; }
    switch (button.dataset.action) {
      case "next": next(); break;
      case "back": state.step = Math.max(0, state.step - 1); errors = {}; persist(); render(true); break;
      case "skip": secrets = {}; advance("skipped"); break;
      case "install": void install(); break;
      case "recheck": recheck(); break;
      case "auth-check": state.env.auth = true; state.env.deferred = false; persist(); render(); message("Codex 认证检测通过（演示）"); break;
      case "choose-directory": document.getElementById("directory-dialog").showModal(); break;
      case "pause": state.paused = true; secrets = {}; persist(); render(); break;
      case "resume": state.paused = false; persist(); render(true); break;
      case "finish": if (!canFinish()) return; state.finished = true; state.done[6] = "completed"; secrets = {}; persist(); render(); break;
      case "review": state.finished = false; state.step = 6; persist(); render(true); break;
      case "reset": reset(); break;
    }
  });
  document.getElementById("reset-demo").addEventListener("click", reset);
  document.getElementById("scenario").addEventListener("change", event => {
    operation++;
    const scenario = event.target.value;
    state.scenario = scenario;
    state.env = { git: false, codex: false, auth: false, deferred: false, issue: "", busy: "" };
    if (scenario === "ready") Object.assign(state.env, { git: true, codex: true, auth: true });
    if (scenario === "auth") Object.assign(state.env, { git: true, codex: true });
    if (scenario === "failed") Object.assign(state.env, { git: true, issue: "failed" });
    if (scenario === "restart") Object.assign(state.env, { codex: true, issue: "restart" });
    if (scenario === "unavailable") Object.assign(state.env, { codex: true, issue: "unavailable" });
    if (scenario === "unknown") Object.assign(state.env, { git: true, issue: "unknown" });
    state.finished = false; state.paused = false;
    delete state.done[1]; delete state.done[6];
    state.step = state.admin ? 1 : 0;
    persist(); render(true);
    if (!state.admin) message("场景已选择，创建演示管理员后即可查看。");
  });
  const dialog = document.getElementById("directory-dialog");
  dialog.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (button?.dataset.directory) {
      state.directory = button.dataset.directory; errors = {}; persist(); dialog.close(); render(); document.getElementById("directory")?.focus();
    } else if (button?.hasAttribute("data-close-directory")) dialog.close();
  });
  render();
})();
