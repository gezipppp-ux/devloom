export const activityLabels = {
  worktreeInitialization: "工作区初始化",
  commandExecution: "命令执行",
  fileChange: "文件修改",
  mcpToolCall: "工具调用",
  webSearch: "网页检索",
  reasoning: "思考摘要",
  plan: "执行计划",
  contextCompaction: "上下文整理",
};

const groupedTypes = new Set(Object.keys(activityLabels).filter(type => type !== "plan"));

export function activityFailed(item) {
  return item.status === "failed" || Boolean(item.error) ||
    (item.exitCode != null && Number.isFinite(Number(item.exitCode)) && Number(item.exitCode) !== 0);
}

// Group only adjacent, ordinary activity from the same known turn. Unknown
// records, plans, failures and messages keep their original positions.
export function sessionRows(items) {
  const rows = [];
  for (const item of items) {
    if (!groupedTypes.has(item.type) || activityFailed(item)) {
      rows.push({ kind: "item", id: item.id, item });
      continue;
    }
    const previous = rows.at(-1);
    if (item.turnId && previous?.kind === "activity" && previous.turnId === item.turnId) {
      previous.items.push(item);
    } else {
      rows.push({ kind: "activity", id: item.id, turnId: item.turnId, items: [item] });
    }
  }
  return rows;
}

export function activitySummary(items) {
  const active = items.findLast(item => item.status === "inProgress");
  if (active) return { active: true, label: {
    reasoning: "正在思考",
    commandExecution: "正在执行命令",
    fileChange: "正在修改文件",
    mcpToolCall: "正在调用工具",
    webSearch: "正在检索网页",
    contextCompaction: "正在整理上下文",
    worktreeInitialization: "正在初始化工作区",
  }[active.type] || "正在执行" };
  if (items.some(item => item.status === "pending")) return { label: "等待执行" };
  if (items.some(item => item.status === "interrupted")) return { label: "已停止" };
  if (items.every(item => item.status === "completed")) return { label: "已完成", completed: true };
  return { label: "过程记录" };
}

export function activityPreview(item) {
  if (item.command) return item.command;
  if (Array.isArray(item.changes)) {
    const paths = item.changes.map(change => change?.path).filter(path => typeof path === "string");
    if (paths.length) return paths.join(" · ");
  }
  return item.text?.split(/\r?\n/).find(line => line.trim()) || item.name || "";
}
