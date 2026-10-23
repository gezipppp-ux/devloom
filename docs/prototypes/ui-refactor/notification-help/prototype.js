/* Standalone design review. All connection and permission states are simulated. */
(() => {
  const params = new URLSearchParams(location.search);
  const state = { scheme: ["a", "b", "c"].includes(params.get("scheme")) ? params.get("scheme") : "b", english: params.get("lang") === "en", browser: "chrome", method: params.get("method") === "temporary" ? "temporary" : "https", expanded: false, enabled: false };
  const environments = [
    ["HTTP + 局域网 IP", "HTTP + LAN IP", "http://192.168.0.64:4317", false, "default"],
    ["HTTPS + 域名", "HTTPS + domain", "https://devloom.example.com", true, "default"],
    ["HTTP + 域名", "HTTP + domain", "http://devloom.example.com", false, "default"],
    ["HTTP + 本机地址", "HTTP + loopback", "http://127.0.0.1:4317", true, "default"],
    ["HTTP + 已配浏览器例外", "HTTP + browser exception", "http://192.168.0.64:4317", true, "default"],
    ["HTTPS + 已拒绝权限", "HTTPS + permission denied", "https://devloom.example.com", true, "denied"],
    ["HTTPS + 受信任 IP 证书", "HTTPS + trusted IP certificate", "https://192.168.0.64:4317", true, "default"],
    ["安全连接 + 浏览器不支持", "Secure + unsupported browser", "https://devloom.example.com", true, "unsupported"]
  ];
  let environmentIndex = 0, returnFocus = null, toastTimer;
  const $ = (selector) => document.querySelector(selector);
  const t = (zh, en) => state.english ? en : zh;
  const environment = () => environments[environmentIndex];
  const flagUrl = () => `${state.browser}://flags/#unsafely-treat-insecure-origin-as-secure`;
  const descriptions = {
    a: ["提示紧邻开关，按需展开教程；配置步骤较少时最直接。", "Keep the reason beside the switch and expand the instructions in place."],
    b: ["已选定 · 居中弹窗，明确选择两种方式之一，再查看对应步骤。", "Selected · Choose one of two methods in the dialog, then follow its instructions."],
    c: ["提示区 + 帮助侧栏 · 保留页面上下文，适合后续增加更多排查内容。", "A notice opens a side panel, keeping the settings visible and making room for more troubleshooting."]
  };
  function showToast(message) {
    clearTimeout(toastTimer); $("#toast").hidden = false; $("#toast").textContent = message;
    toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 2600);
  }
  async function copy(value) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("fallback");
      await navigator.clipboard.writeText(value);
      showToast(t("已复制，请粘贴到浏览器地址栏或配置框。", "Copied. Paste into the address bar or configuration field."));
    } catch {
      const input = document.createElement("textarea"); input.value = value;
      const host = $("#help-dialog").open ? $("#help-dialog") : document.body;
      host.append(input); input.select();
      const copied = document.execCommand("copy"); input.remove();
      showToast(copied ? t("已复制。", "Copied.") : t("复制未成功，请手动选中文本复制。", "Copy failed. Select and copy the text manually."));
    }
  }
  function copyLine(value, key) {
    return `<div class="copy-line"><code>${value}</code><button type="button" data-copy="${key}">${t("复制", "Copy")}</button></div>`;
  }
  function steps() {
    return `<div class="browser-tabs" role="group" aria-label="${t("选择浏览器", "Choose browser")}"><button data-browser="chrome" aria-pressed="${state.browser === "chrome"}">Chrome</button><button data-browser="edge" aria-pressed="${state.browser === "edge"}">Edge</button></div>
      <ol class="steps">
        <li><strong>${t("打开浏览器实验设置", "Open browser flags")}</strong><p>${t("复制下方地址，粘贴到浏览器地址栏打开。", "Copy this address and paste it into the browser address bar.")}</p>${copyLine(flagUrl(), "flags")}</li>
        <li><strong>${t("添加当前站点并启用", "Add this site and enable the flag")}</strong><p>${t("在 Insecure origins treated as secure 下填入：", "Enter this origin under Insecure origins treated as secure:")}</p>${copyLine(environment()[2], "origin")}<p>${t("右侧选为 Enabled（已启用）。", "Set the option to Enabled.")}</p></li>
        <li><strong>${t("重启浏览器并允许通知", "Relaunch and allow notifications")}</strong><p>${t("点击 Relaunch，重新打开本站，再开启通知开关并选择“允许”。", "Click Relaunch, reopen this site, then turn on notifications and choose Allow.")}</p></li>
      </ol>`;
  }
  function guide() {
    return `<div class="guide">
      <p class="method-prompt">${t("选择一种方式即可，无需同时设置。", "Choose either method. You do not need to complete both.")}</p>
      <div class="method-choices" role="group" aria-label="${t("选择开启通知的方式", "Choose a notification setup method")}">
        <button class="method-choice" data-method="https" aria-pressed="${state.method === "https"}" aria-controls="method-instructions"><span class="method-label">${t("方式一", "METHOD 1")}<span class="tag">${t("推荐", "Recommended")}</span></span><strong>${t("使用 HTTPS 访问", "Use HTTPS")}</strong><span class="method-caption">${t("适合团队长期使用", "For long-term team use")}</span></button>
        <button class="method-choice" data-method="temporary" aria-pressed="${state.method === "temporary"}" aria-controls="method-instructions"><span class="method-label">${t("方式二", "METHOD 2")}</span><strong>${t("临时允许当前内网站点", "Temporarily allow this intranet site")}</strong><span class="method-caption">${t("仅调整当前浏览器", "Applies only to this browser")}</span></button>
      </div>
      <div id="method-instructions">${state.method === "https" ? `<ol class="steps https-steps"><li><strong>${t("向管理员获取 HTTPS 地址", "Get an HTTPS address from your administrator")}</strong><p>${t("站点需配置浏览器信任的有效证书。", "The site needs a valid certificate trusted by your browser.")}</p></li><li><strong>${t("通过新地址打开本站", "Open this app at the new address")}</strong><p>${t("使用管理员提供的完整地址，不要直接把当前地址的 http 改为 https。", "Use the full address your administrator provides; simply changing http to https will not configure the server.")}</p></li><li><strong>${t("开启通知并选择“允许”", "Turn on notifications and choose Allow")}</strong><p>${t("进入个人设置，开启通知开关。团队成员无需修改浏览器实验设置。", "Open Personal settings and enable notifications. Team members need no changes to browser flags.")}</p></li></ol>` : `<section class="method"><p>${t("适用于电脑上的 Chrome / Edge；仅为你信任的内网站点设置。", "For desktop Chrome / Edge; configure only an intranet site you trust.")}</p><div class="browser-instructions">${steps()}</div></section>
      <p class="footnote">${t("此设置仅对当前浏览器生效，不会加密 HTTP 连接。改用 HTTPS 后可移除例外。", "This applies only to this browser and does not encrypt HTTP traffic. Remove the exception after moving to HTTPS.")}</p>
      <details class="footnote"><summary>${t("重启后仍被拦截？", "Still blocked after relaunching?")}</summary><p>${t("在地址栏左侧打开网站设置，将“通知”改为“允许”，然后刷新本站。如果浏览器不提供以上选项，请使用 HTTPS 地址。", "Open site settings beside the address bar, allow Notifications, and reload. If your browser does not offer this flag, use HTTPS.")}</p></details>`}</div>
      <div class="guide-footer"><button data-action="recheck">${t("重新检测", "Check again")}</button><span class="recheck-result" role="status">${t("完成设置后，回到此处检查。", "Return here after changing your settings.")}</span></div>
    </div>`;
  }
  function hint() {
    const current = environment();
    if (!current[3]) {
      const title = t("当前连接暂时无法使用桌面通知", "Desktop notifications need a secure connection");
      const description = t("你正在通过 HTTP 访问，浏览器限制了通知权限。", "This site uses HTTP, so the browser restricts notification permission.");
      return `<div class="notice ${state.scheme === "c" ? "boxed" : ""}"><span class="notice-mark" aria-hidden="true">!</span><div class="notice-content"><strong>${title}</strong><p>${description}</p></div><button class="text" id="help-trigger" data-action="help" ${state.scheme === "a" ? `aria-expanded="${state.expanded}" aria-controls="inline-guide"` : 'aria-haspopup="dialog"'}>${state.expanded ? t("收起教程 ↑", "Hide guide ↑") : state.scheme === "a" ? t("查看设置方法 ↓", "Show instructions ↓") : state.scheme === "b" ? t("如何开启 →", "How to enable →") : t("打开帮助 →", "Open help →")}</button></div><div id="inline-guide" ${state.expanded && state.scheme === "a" ? "" : "hidden"}>${state.scheme === "a" ? guide() : ""}</div>`;
    }
    if (current[4] === "denied") return `<div class="notice"><span class="notice-mark" aria-hidden="true">!</span><div class="notice-content"><strong>${t("通知权限已被拒绝", "Notification permission was denied")}</strong><p>${t("当前连接符合要求。请打开地址栏左侧的网站设置，将“通知”改为“允许”，然后刷新页面。", "Your connection is supported. Open site settings beside the address bar, allow Notifications, and reload.")}</p></div></div>`;
    if (current[4] === "unsupported") return `<p class="status-note">${t("当前浏览器不支持桌面通知，请使用支持通知的桌面浏览器。", "This browser does not support desktop notifications. Use a supported desktop browser.")}</p>`;
    return `<p class="status-note">${t("当前连接支持申请通知权限。每台设备需单独允许。", "This connection supports notification permission. Allow it separately on each device.")}</p>`;
  }
  function render() {
    document.documentElement.lang = state.english ? "en" : "zh-CN";
    $("#review-title").textContent = t("通知访问提示", "Notification access guidance");
    $("#sample-label").textContent = t("交互原型 · 模拟环境", "Interactive prototype · simulated state");
    $("#environment-label").textContent = t("访问场景", "Connection");
    $("#preview-open").textContent = t("查看展开效果", "Preview guide");
    $("#preview-open").disabled = environment()[3];
    $("#language").textContent = state.english ? "中文" : "EN";
    $("#environment").innerHTML = environments.map((row, i) => `<option value="${i}" ${i === environmentIndex ? "selected" : ""}>${row[state.english ? 1 : 0]}</option>`).join("");
    document.querySelectorAll("[data-scheme]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.scheme === state.scheme));
      const titles = state.english ? ["A · Inline guide", "B · Dialog", "C · Side panel"] : ["A · 就地展开", "B · 引导弹窗", "C · 帮助侧栏"];
      button.textContent = titles[["a", "b", "c"].indexOf(button.dataset.scheme)];
    });
    $("#scheme-description").textContent = descriptions[state.scheme][state.english ? 1 : 0];
    $("#sidebar").innerHTML = `<div class="brand"><span class="brand-mark">⌘</span><span class="brand-name">DevLoom</span></div>${[t("工作台", "Workbench"), t("项目", "Projects"), t("事项", "Issues"), t("开发", "Development"), t("交付", "Deliveries")].map((name, i) => `<div class="nav-item"><span class="nav-icon" aria-hidden="true">${["▦", "▱", "☷", "⌘", "◇"][i]}</span><span class="nav-label">${name}</span></div>`).join("")}<div class="nav-item nav-bottom"><span class="nav-icon" aria-hidden="true">⚙</span><span class="nav-label">${t("管理中心", "Administration")}</span></div>`;
    $("#breadcrumb").textContent = t("全部项目　 /　 个人设置", "All projects　 /　 Personal settings");
    $("#main").innerHTML = `<header class="page-heading"><h1>${t("个人设置", "Personal settings")}</h1><p>${t("管理你的偏好与连接，让工作更顺手。", "Manage your preferences and connections.")}</p></header>
      <div class="settings"><nav class="settings-menu" aria-label="${t("个人设置分类", "Settings sections")}"><p>${t("我的账号", "MY ACCOUNT")}</p><span class="active">${t("资料与偏好", "Profile & preferences")}</span><span>${t("Git 账号", "Git accounts")}</span><span>${t("MCP 接入", "MCP access")}</span><span>${t("账号安全", "Account security")}</span></nav>
      <section class="settings-content"><header class="section-heading"><h2>${t("个人资料与偏好", "Profile & preferences")}</h2><p>${t("这些设置只影响你的账号。", "These settings apply only to your account.")}</p></header>
      <div class="profile-panel"><section class="form-section"><div class="identity"><span class="avatar">林</span><div><strong>${t("林晨", "Lin Chen")}</strong><p>linchen · ${t("登录账号", "Username")}</p></div></div><div class="profile-row"><label class="field">${t("显示名称", "Display name")}<input value="${t("林晨", "Lin Chen")}" autocomplete="off"></label><button data-action="save">${t("保存显示名称", "Save name")}</button></div></section>
      <section class="form-section"><h3>${t("执行默认值", "Execution defaults")}</h3><p class="muted">${t("创建任务时自动填入，单个任务仍可独立调整。", "Applied to new tasks; each task can override these values.")}</p><div class="fields"><label class="field">${t("模型", "Model")}<select><option>${t("跟随默认模型", "Use default model")}</option></select></label><label class="field">${t("默认执行权限", "Default permissions")}<select><option>${t("需要时询问", "Ask when needed")}</option></select></label></div></section>
      <section class="form-section" id="notifications"><h3>${t("通知", "Notifications")}</h3><div class="notification-row"><div><strong>${t("需要我处理时提醒", "Notify me when action is needed")}</strong><p>${t("浏览器打开应用期间，提醒新的执行审批、提问、待验证交付和 Codex 未读结果。每台设备需单独允许通知。", "While this app is open, get alerts for approvals, questions, deliveries to verify, and unread Codex results. Allow notifications on each device.")}</p></div><button class="switch" data-action="toggle" role="switch" aria-label="${t("需要我处理时提醒", "Notify me when action is needed")}" aria-checked="${state.enabled}" ${!environment()[3] || ["denied", "unsupported"].includes(environment()[4]) ? 'disabled aria-describedby="connection-hint"' : ""}></button></div><div id="connection-hint">${hint()}</div></section>
      <footer class="profile-footer"><button class="primary" data-action="save">${t("保存个人设置", "Save personal settings")}</button></footer></div></section></div>`;
  }
  function openHelp() {
    if (environment()[3]) return;
    returnFocus = $("#help-trigger");
    if (state.scheme === "a") {
      state.expanded = !state.expanded;
      $("#connection-hint").innerHTML = hint();
      $("#help-trigger").focus({ preventScroll: true });
      if (state.expanded) $("#notifications").scrollIntoView({ block: "start", behavior: "instant" });
      return;
    }
    const dialog = $("#help-dialog");
    dialog.className = state.scheme === "c" ? "drawer" : "";
    dialog.innerHTML = `<header class="dialog-head"><div><h2 id="dialog-title">${t("开启桌面通知", "Enable desktop notifications")}</h2><p>${t("选择适合你的连接方式", "Choose a connection method")}</p></div><button data-action="close" aria-label="${t("关闭帮助", "Close help")}" autofocus>×</button></header><div class="dialog-body">${state.scheme === "c" ? `<div class="connection">${t("当前访问地址 · HTTP", "Current origin · HTTP")}<code>${environment()[2]}</code></div>` : `<p class="guide-intro">${t("当前通过 HTTP 访问，浏览器限制了通知权限。", "Your current HTTP connection restricts notification permission.")}</p>`}${guide()}</div>`;
    document.body.style.overflow = "hidden"; dialog.showModal();
  }
  $("#help-dialog").addEventListener("close", () => { document.body.style.overflow = ""; returnFocus?.focus({ preventScroll: true }); });
  $("#help-dialog").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled), summary")).filter(element => element.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  $("#environment").addEventListener("change", (event) => { environmentIndex = Number(event.target.value); state.expanded = false; state.enabled = false; render(); });
  $("#language").addEventListener("click", () => { state.english = !state.english; render(); });
  $("#preview-open").addEventListener("click", openHelp);
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.scheme) { state.scheme = button.dataset.scheme; state.expanded = false; render(); }
    if (button.dataset.method) {
      state.method = button.dataset.method;
      const currentGuide = button.closest(".guide"), host = currentGuide.parentElement; currentGuide.outerHTML = guide();
      host.querySelector(`[data-method="${state.method}"]`).focus({ preventScroll: true });
    }
    if (button.dataset.browser) {
      state.browser = button.dataset.browser;
      const host = button.closest(".browser-instructions"); host.innerHTML = steps();
      host.querySelector(`[data-browser="${state.browser}"]`).focus({ preventScroll: true });
    }
    if (button.dataset.copy) void copy(button.dataset.copy === "flags" ? flagUrl() : environment()[2]);
    if (button.dataset.action === "help") openHelp();
    if (button.dataset.action === "close") $("#help-dialog").close();
    if (button.dataset.action === "recheck") button.parentElement.querySelector(".recheck-result").textContent = t("当前仍是 HTTP 受限状态。此原型不读取实际浏览器配置。", "Still restricted in this simulated state. This prototype does not read browser settings.");
    if (button.dataset.action === "save") showToast(t("演示：设置已保存。", "Demo: settings saved."));
    if (button.dataset.action === "toggle") { state.enabled = !state.enabled; render(); showToast(t("演示：通知状态已更新。", "Demo: notification state updated.")); }
  });
  render();
  if (params.get("open") === "1") openHelp();
})();
