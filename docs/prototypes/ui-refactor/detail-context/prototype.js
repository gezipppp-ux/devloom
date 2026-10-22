/* Standalone review: mock data only, no network or persistence. */
const state = {
  variant: "a",
  page: "task",
  scenario: "assigned",
  locale: "zh",
  source: "55",
};
const $ = (selector) => document.querySelector(selector);
const t = (zh, en) => (state.locale === "en" ? en : zh);
const person = (name) =>
  `<span class="person"><span class="avatar">${name.slice(-1)}</span><span>${name}</span></span>`;
const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
const muted = (value) => `<span class="muted">${value}</span>`;
const name = () =>
  state.scenario === "long" ? "刘嘉辉 · 产品平台与增长业务组" : "刘嘉辉";
const unavailable = () => state.scenario === "empty";
const archived = () => state.scenario === "readonly";
const title = () =>
  state.scenario === "long"
    ? "热门账号洞察（V1.4）：支持跨平台账号趋势分析、复杂条件筛选与内容数据导出，保持大屏和移动端信息一致"
    : "热门账号洞察（V1.4）";
const sources = () =>
  `<div class="source-select"><label for="source-${state.variant}">${t("来源事项", "Source issue")}${state.page === "task" ? " · 2" : ""}</label><select id="source-${state.variant}" data-source ${state.page === "issue" ? "disabled" : ""}><option value="55" ${state.source === "55" ? "selected" : ""}>#55 · 热门账号洞察（V1.4）</option><option value="63" ${state.source === "63" ? "selected" : ""}>#63 · 图片微调支持图片比例与数量收纳式配置</option></select></div>`;
function assignment() {
  if (unavailable())
    return `<p>${t(state.page === "task" ? "王伟业创建的独立开发任务" : "尚未分派开发负责人", state.page === "task" ? "Independent task created by 王伟业" : "No developer assigned")}</p><small>${t(state.page === "task" ? "没有关联事项" : "认领或指派后显示分派记录", state.page === "task" ? "No linked issues" : "Assignment details appear after claiming or assigning")}</small>`;
  if (state.scenario === "claimed")
    return `<p>${person("王伟业")} ${t("自行认领", "claimed this issue")}</p><small>2026-10-21 14:30 · ${t("本人认领", "Self-claimed")}</small>`;
  return `<p><strong>${name()}</strong> <span class="assign-arrow">→</span> <strong>王伟业</strong></p><small>${t("分派人 → 开发负责人", "Assigned by → Developer")}<br>2026-10-21 14:30 · ${t("指派", "Assigned")}</small>`;
}
function taskInfo() {
  return `<section class="group"><h3>${t("开发任务", "Development task")}</h3><dl class="facts">${row(t("任务状态", "Task status"), `<span class="badge gray">${t(archived() ? "已完成" : "已启动", archived() ? "Completed" : "Started")}</span>`)}${row(t("执行者", "Executor"), person("王伟业"))}${row(t("目标版本", "Target release"), "v1.4.0")}${row(t("所属项目", "Project"), "MY智营")}${row(t("Agent 状态", "Agent status"), t("本轮结束", "Turn finished"))}${row(t("任务来源", "Task source"), t(unavailable() ? "独立开发" : "项目事项", unavailable() ? "Independent" : "Project issues"))}</dl></section>`;
}
function issueInfo() {
  if (unavailable() && state.page === "task")
    return `<section class="group"><h3>${t("来源事项", "Source issue")}</h3><p class="muted">${t("此任务为独立开发，暂无事项资料。", "This independent task has no source issue.")}</p></section>`;
  const second = state.source === "63";
  return `<section class="group">${sources()}<dl class="facts">${row(t("事项状态", "Issue status"), `<span class="badge">${t(archived() ? "已完成" : unavailable() ? "规划中" : "开发中", archived() ? "Completed" : unavailable() ? "Planned" : "In development")}</span>`)}${row(t("所属项目", "Project"), "MY智营")}${row(t("目标版本", "Target release"), "v1.4.0")}${row(t("优先级", "Priority"), t("普通", "Normal"))}${row(t("提报人", "Reporter"), second ? person("陈敏") : person(name()))}${row(t("业务负责人", "Business owner"), person(name()))}${row(t("开发负责人", "Developer"), unavailable() ? muted(t("未分派", "Unassigned")) : person("王伟业"))}${row(t("测试负责人", "QA owner"), second ? muted(t("未分派", "Unassigned")) : person("张晓雨"))}${row(t("业务验收人", "Acceptance owner"), person(name()))}${row(t("创建者", "Created by"), person(second ? "陈敏" : "王伟业"))}${row(t("关注人", "Watchers"), t("无", "None"))}${row(t("截止日期", "Due date"), "2026-10-28")}</dl>${state.page === "task" ? `<p class="source-note">${t("当前事项资料 · 开发范围保留纳入任务时的内容", "Current issue information · Development scope preserves the captured content")}</p>` : ""}</section>`;
}
function info() {
  if (state.scenario === "error")
    return `<div class="error" role="alert">${t("协作资料暂时无法读取，分派信息待确认。", "Collaboration details could not be loaded. Assignment is unconfirmed.")}<br><button data-retry>${t("重新加载", "Retry")}</button></div>`;
  return `${state.page === "task" ? taskInfo() : ""}${issueInfo()}`;
}
function timeline() {
  if (unavailable()) return "";
  return `<section class="group"><h3>${t("分派记录", "Assignment history")}</h3><ol class="timeline"><li><small>2026-10-21 14:30</small>${state.scenario === "claimed" ? t("王伟业自行认领", "王伟业 claimed this issue") : t("刘嘉辉将开发负责人调整为王伟业", "刘嘉辉 assigned development to 王伟业")}</li><li><small>2026-10-21 10:20</small>${t("王伟业创建事项，刘嘉辉负责业务确认", "王伟业 created the issue; 刘嘉辉 owns business review")}</li></ol></section>`;
}
function actions() {
  if (state.page === "task") return "";
  return `<div class="current-action"><span class="badge">${t(archived() ? "已完成" : "开发中", archived() ? "Completed" : "In development")}</span><p>${t("当前处理人：王伟业", "Current handler: 王伟业")}</p><button data-page="task" ${state.page === "task" ? "data-record" : ""}>${t(state.page === "task" ? "查看开发记录" : "查看关联任务", state.page === "task" ? "View development record" : "View linked task")}</button></div>`;
}
function taskContent() {
  return `<section class="section"><div class="section-head"><h2>${t("开发范围", "Development scope")} <span class="badge gray">${unavailable() ? "0" : "2"} ${t("条事项", "issues")}</span></h2></div><p>${t("纳入任务时保存的事项内容", "Issue content captured when added to the task")}</p>${unavailable() ? `<p>${t("独立开发：整理账号分析方案与验证结果。", "Independent development: prepare account analysis and validation.")}</p>` : ["55", "63"].map((id, i) => `<div class="scope-row"><span class="scope-icon">▤</span><div class="scope-text"><strong>${i ? "图片微调支持图片比例与数量收纳式配置" : title()}</strong><small>MY智营 · ${t("需求", "Requirement")} · #${id}</small></div><button data-inspect="${id}">${t("查看资料", "View details")}</button></div>`).join("")}</section><section class="section"><div class="section-head"><h2>${t("整理成果", "Prepare delivery")}</h2><span class="badge gray">${t("待提交验证", "Awaiting submission")}</span></div><p>${t("检查本轮修改与验证结果，完成后提交给验证人。", "Review changes and validation results before submitting for verification.")}</p><button class="primary" data-record>${t("查看开发记录", "View development record")}</button><div class="record" hidden><p>${t("本轮结束，待检查结果。", "This turn has finished. Review the result.")}</p><p>${t("模拟记录：已补齐筛选、趋势对比与空状态。", "Demo record: filtering, trend comparison and empty states are ready.")}</p></div></section><section class="section"><h2>${t("开发记录", "Development record")}</h2><div class="heading-meta"><span class="badge gray">${t("任务：已启动", "Task: Started")}</span><span>Codex · ${t("本轮结束", "Turn finished")}</span></div><h2 style="margin-top:22px">${t("本轮已结束，请检查结果", "Turn finished — review the result")}</h2><p>${t("查看代码与执行结果，确认修改满足事项的验收标准。", "Review code and execution results against the acceptance criteria.")}</p></section>`;
}
function issueContent() {
  return `<article class="document"><h2>${t("背景与目标", "Background and objectives")}</h2><p>为运营人员提供热门账号洞察，支持按平台、领域及时间范围发现值得关注的账号，结合内容趋势和互动数据辅助选题。</p><h2>${t("范围", "Scope")}</h2><ul><li>支持热门账号列表、趋势对比与详情查看。</li><li>复用现有项目权限，保留筛选条件与分页位置。</li><li>包含加载、空结果、接口失败和窄屏显示状态。</li></ul><h2>${t("业务规则", "Business rules")}</h2><div class="rules">${[
    ["R1", "进入列表时，默认展示最近 7 天的热门账号。"],
    ["R2", "调整平台或领域后，保留已有时间范围并回到第一页。"],
    ["R3", "打开账号详情后，返回时恢复列表筛选条件与阅读位置。"],
  ]
    .map(
      ([id, text]) =>
        `<div class="rule"><span>${id}</span><span>${text}</span></div>`,
    )
    .join(
      "",
    )}</div><h2>${t("验收标准", "Acceptance criteria")}</h2><p>列表与详情的数据口径一致；返回不丢失筛选；开发与事项页展示相同的来源资料和最新分派记录。</p><h2>${t("沟通与记录", "Discussion and activity")}</h2><p class="muted">${t("暂无新讨论。", "No new discussion.")}</p></article>`;
}
function assignmentBlock() {
  return `<div class="assignment"><span class="eyebrow">${t("开发分派", "Development assignment")}</span>${state.scenario === "error" ? `<p>${t("分派信息待确认", "Assignment unconfirmed")}</p>` : assignment()}</div>`;
}
function summary() {
  return `<div class="inline-summary"><div class="summary-field"><label>${t("开发分派", "Development assignment")}</label><strong>${state.scenario === "error" ? t("待确认", "Unconfirmed") : unavailable() ? t("未分派", "Unassigned") : state.scenario === "claimed" ? t("王伟业自行认领", "王伟业 claimed this issue") : `${name()} → 王伟业`}</strong><small>${t("分派人 / 开发负责人", "Assigned by / Developer")}</small></div><div class="summary-field"><label>${t("业务负责人", "Business owner")}</label><strong>${state.scenario === "error" ? "—" : name()}</strong></div><div class="summary-field"><label>${t("目标版本", "Target release")}</label><strong>v1.4.0</strong></div><div class="summary-field"><label>${t("优先级", "Priority")}</label><strong>${t("普通", "Normal")}</strong></div><button class="expand" data-expand>${t("完整协作资料 ↓", "All collaboration details ↓")}</button></div>`;
}
function navigate(page) {
  state.page = page;
  state.source = "55";
  location.hash = `${state.variant}-${page}`;
  render();
}
function render() {
  document.documentElement.lang = state.locale === "en" ? "en" : "zh-CN";
  document
    .querySelectorAll("[data-variant]")
    .forEach((el) =>
      el.setAttribute(
        "aria-pressed",
        String(el.dataset.variant === state.variant),
      ),
    );
  const navItems = [
    ["home", "⌂", "工作台", "Home"],
    ["projects", "▱", "项目", "Projects"],
    ["issue", "▤", "事项", "Issues"],
    ["task", "›_", "开发", "Develop"],
    ["delivery", "◎", "交付", "Deliver"],
  ];
  const nav = navItems
    .map(
      ([id, icon, label, en]) =>
        `<button ${["issue", "task"].includes(id) ? `data-page="${id}"` : "disabled"} class="${(state.page.includes("task") ? "task" : "issue") === id ? "active" : ""}"><span class="nav-icon">${icon}</span><span class="nav-label">${t(label, en)}</span></button>`,
    )
    .join("");
  $("#main-nav").innerHTML = nav;
  $("#mobile-nav").innerHTML = nav;
  $("#breadcrumb").textContent = t(
    state.page === "task"
      ? "开发任务详情"
      : state.page === "issue"
        ? "事项详情"
        : "事项 / 开发列表",
    state.page === "task"
      ? "Development task details"
      : state.page === "issue"
        ? "Issue details"
        : "Issues / Development",
  );
  $("#language").textContent = state.locale === "en" ? "中文" : "EN";
  const notes = {
    a: [
      t("A · 分组侧栏", "A · Grouped sidebar"),
      t(
        "分派常驻右侧，任务与事项资料分组呈现。",
        "Assignment stays visible beside grouped task and issue information.",
      ),
    ],
    b: [
      t("B · 页首摘要", "B · Summary first"),
      t(
        "先看分工与版本，完整资料在页内展开。",
        "Scan ownership and release first; expand full information in the page.",
      ),
    ],
    c: [
      t("C · 资料抽屉", "C · Context drawer"),
      t(
        "分派摘要常驻，完整资料按需打开。",
        "Assignment stays visible; open full context when needed.",
      ),
    ],
  };
  const note = `<div class="proposal-note"><div><strong>${notes[state.variant][0]}</strong><p>${notes[state.variant][1]}</p></div><div class="page-switch"><button data-page="issue" class="${state.page === "issue" ? "selected" : ""}">${t("事项详情", "Issue details")}</button><button data-page="task" class="${state.page === "task" ? "selected" : ""}">${t("开发详情", "Task details")}</button></div></div>`;
  if (state.page.endsWith("list")) {
    $("#page").innerHTML =
      `${note}<h1>${t(state.page === "task-list" ? "开发" : "事项", state.page === "task-list" ? "Develop" : "Issues")}</h1><div class="heading-meta">MY智营 · ${t("与我有关", "Related to me")} · v1.4.0</div><button class="queue-row" data-page="${state.page === "task-list" ? "task" : "issue"}"><span><strong>${title()}</strong><small>#55 · ${t("需求", "Requirement")} · MY智营</small></span><span>${t("开发中", "In development")} →</span></button><p class="queue-hint">${t("返回仍在原入口，并保留列表上下文。", "Returning preserves the original entry and list context.")}</p>`;
    return;
  }
  const heading = `<a class="back" href="#${state.variant}-${state.page}-list" data-back>← ${t(state.page === "task" ? "返回开发列表" : "返回事项", state.page === "task" ? "Back to development" : "Back to issues")}</a><div class="heading"><h1>${title()}</h1><div class="heading-meta"><span class="badge">${t(state.page === "task" ? "开发任务" : "需求", state.page === "task" ? "Development task" : "Requirement")}</span><span>#${state.page === "task" ? "6ec81813" : "55"}</span><span>·</span><span>MY智营</span><span>·</span><span>v1.4.0</span></div></div>`;
  const banner = archived()
    ? `<p class="readonly-banner">${t("项目已归档 · 资料与分派记录只读", "Project archived · Details and assignment history are read-only")}</p>`
    : "";
  const content = state.page === "task" ? taskContent() : issueContent();
  let body;
  if (state.variant === "a")
    body = `<div class="layout"><div class="content">${content}</div><aside class="rail" aria-label="${t("协作资料", "Collaboration details")}">${actions()}${assignmentBlock()}<details class="rail-details" ${window.innerWidth >= 1200 ? "open" : ""}><summary>${t("完整协作资料", "All collaboration details")}</summary><div class="metadata">${info()}</div><details class="assignment-history"><summary>${t("分派记录", "Assignment history")}</summary>${timeline()}</details></details></aside></div>`;
  else if (state.variant === "b")
    body = `${summary()}<details class="expanded-info"><summary><strong>${t("协作资料", "Collaboration details")}</strong>${t("提报、分派与参与人员", "Reporter, assignment and participants")}</summary><div class="expanded-body">${info()}</div><section class="group">${assignmentBlock()}${timeline()}</section></details><div class="layout"><div class="content">${content}</div><aside class="rail">${actions()}<p class="muted">${t("人员与事项资料统一收在页首。", "People and issue context are grouped at the top of the page.")}</p></aside></div>`;
  else
    body = `<div class="compact-assignment"><div>${state.scenario === "error" ? t("分派信息待确认", "Assignment unconfirmed") : assignment()}</div><button data-drawer>${t("协作资料与分派记录", "Details & assignment history")} ↗</button></div><div class="c-content">${actions()}${content}</div>`;
  $("#page").innerHTML = note + heading + banner + body;
}
function openDrawer() {
  $("#drawer-kicker").textContent =
    `${state.page === "task" ? "#6ec81813" : "#55"} · MY智营`;
  $("#drawer-title").textContent = t("协作资料", "Collaboration details");
  $("#drawer-content").innerHTML = `${assignmentBlock()}${info()}${timeline()}`;
  $("#close-drawer").setAttribute("aria-label", t("关闭资料", "Close details"));
  if (!$("#info-drawer").open) $("#info-drawer").showModal();
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("button,a");
  if (!target || target.disabled) return;
  if (target.dataset.variant) {
    state.variant = target.dataset.variant;
    location.hash = `${state.variant}-${state.page}`;
    render();
  } else if (target.hasAttribute("data-record")) {
    const record = $(".record");
    record.hidden = !record.hidden;
  } else if (target.dataset.page) navigate(target.dataset.page);
  else if (target.hasAttribute("data-back")) {
    event.preventDefault();
    navigate(`${state.page}-list`);
  } else if (target.hasAttribute("data-expand")) {
    const el = $(".expanded-info");
    el.open = !el.open;
    target.setAttribute("aria-expanded", String(el.open));
  } else if (target.hasAttribute("data-drawer")) openDrawer();
  else if (target.dataset.inspect) {
    state.source = target.dataset.inspect;
    if (state.variant === "c") openDrawer();
    else {
      render();
      const el =
        state.variant === "b" ? $(".expanded-info") : $(".rail-details");
      el.open = true;
      el.scrollIntoView({ block: "nearest" });
    }
  } else if (target.hasAttribute("data-retry")) {
    state.scenario = "assigned";
    $("#scenario").value = "assigned";
    render();
    if ($("#info-drawer").open) openDrawer();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.hasAttribute("data-source")) {
    const open = $(".expanded-info")?.open;
    state.source = event.target.value;
    render();
    if (open && $(".expanded-info")) $(".expanded-info").open = true;
    if ($("#info-drawer").open) openDrawer();
  }
});
$("#scenario").addEventListener("change", (event) => {
  state.scenario = event.target.value;
  render();
});
$("#language").addEventListener("click", () => {
  state.locale = state.locale === "zh" ? "en" : "zh";
  render();
});
$("#close-drawer").addEventListener("click", () => $("#info-drawer").close());
$("#info-drawer").addEventListener("click", (event) => {
  if (
    event.target === $("#info-drawer") &&
    event.clientX < $("#info-drawer").getBoundingClientRect().left
  )
    $("#info-drawer").close();
});
function fromHash() {
  const match = location.hash.match(/^#([abc])-(issue|task)(-list)?$/);
  if (match) {
    state.variant = match[1];
    state.page = match[2] + (match[3] || "");
  }
  render();
}
window.addEventListener("hashchange", fromHash);
fromHash();
