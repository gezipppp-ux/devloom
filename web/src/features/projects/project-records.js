import { formatDate, translate } from "../../shared/i18n/index.js";
import { priorityLabels, assetTypes } from "./project-labels.js";
export const fieldLabels = { releaseId: "目标版本", executorId: "开发负责人", title: "标题", description: "描述", priority: "优先级", status: "状态", acceptanceCriteria: "验收标准", reproductionSteps: "复现步骤", expectedResult: "预期结果", actualResult: "实际结果", severity: "严重程度", developerId: "开发负责人", watcherIds: "关注人", reporterId: "提报人", businessOwnerId: "业务负责人", qaOwnerId: "测试负责人", acceptanceOwnerId: "业务验收人", name: "项目名称", remoteUrl: "Git 仓库地址", ownerUserId: "负责人", initCommands: "初始化命令", bug: "Bug 提示词", requirement: "需求提示词", type: "类型", content: "内容", url: "链接", username: "用户名", environment: "环境", category: "分类", tags: "标签", ownerId: "负责人", expiresAt: "有效期", issueIds: "关联事项", hasSecret: "敏感值" };
fieldLabels.supplement = "补充提示词";
fieldLabels.dueDate = "截止日期";
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
  if (value == null || value === "" || Array.isArray(value) && !value.length) return translate("未设置");
  if (["developerId", "ownerId", "ownerUserId", "watcherIds", "reporterId", "businessOwnerId", "qaOwnerId", "acceptanceOwnerId"].includes(key)) return [value].flat().map(id => people.find(p => p.id === id)?.displayName || translate("历史成员")).join("、");
  if (key === "status") return statusNames[value] || String(value);
  if (key === "hasSecret") return value ? translate("已配置（内容受保护）") : translate("未配置");
  if (key === "issueIds") return translate('关联 {count} 条事项', { count: value.length });
  if (key === "expiresAt") return String(value).slice(0, 10);
  if (Array.isArray(value)) return value.join("、");
  return translate(({ status: statusNames, priority: priorityLabels, type: assetTypes, environment: { development: "开发", test: "测试", staging: "预发布" }, severity: { minor: "轻微", normal: "普通", major: "严重", critical: "致命" } })[key]?.[value]) || String(value);
}

export function readableTime(value) {
  if (!value) return translate("时间未知");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? translate("时间未知") : formatDate(date, { hour: "2-digit", minute: "2-digit", hour12: false });
}
