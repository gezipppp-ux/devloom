import { priorityLabels, assetTypes } from "./project-labels.js";
export const fieldLabels = { releaseId: "目标版本", executorId: "开发负责人", title: "标题", description: "描述", priority: "优先级", status: "状态", acceptanceCriteria: "验收标准", reproductionSteps: "复现步骤", expectedResult: "预期结果", actualResult: "实际结果", severity: "严重程度", assigneeId: "开发负责人", participantIds: "参与人", name: "项目名称", remoteUrl: "Git 仓库地址", ownerUserId: "负责人", initCommands: "初始化命令", bug: "Bug 提示词", requirement: "需求提示词", type: "类型", content: "内容", url: "链接", username: "用户名", environment: "环境", category: "分类", tags: "标签", ownerId: "负责人", expiresAt: "有效期", issueIds: "关联事项", hasSecret: "敏感值" };
export const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function mergeFields(base, draft, latest, choices = {}) {
  const values = {}, conflicts = [];
  for (const key of Object.keys(fieldLabels)) {
    if (!(key in draft)) continue;
    if (sameValue(draft[key], base[key])) values[key] = latest[key];
    else if (sameValue(latest[key], base[key]) || sameValue(draft[key], latest[key])) values[key] = draft[key];
    else { conflicts.push(key); values[key] = choices[key] === "latest" ? latest[key] : draft[key]; }
  }
  return { values, conflicts };
}
export function readableValue(key, value, people = [], statusNames = {}) {
  if (value == null || value === "" || Array.isArray(value) && !value.length) return "未设置";
  if (["assigneeId", "ownerId", "ownerUserId", "participantIds"].includes(key)) return [value].flat().map(id => people.find(p => p.id === id)?.displayName || "历史成员").join("、");
  if (key === "hasSecret") return value ? "已配置（内容受保护）" : "未配置";
  if (key === "issueIds") return `关联 ${value.length} 条事项`;
  if (key === "expiresAt") return String(value).slice(0, 10);
  if (Array.isArray(value)) return value.join("、");
  return ({ status: statusNames, priority: priorityLabels, type: assetTypes, environment: { development: "开发", test: "测试", staging: "预发布" }, severity: { minor: "轻微", normal: "普通", major: "严重", critical: "致命" } })[key]?.[value] || String(value);
}

export function readableTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}
