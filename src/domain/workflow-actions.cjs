const { accountError } = require("./account.cjs");

const handlerFields = Object.freeze({ businessOwner: "businessOwnerId", reporter: "reporterId", developer: "developerId", qaOwner: "qaOwnerId", acceptanceOwner: "acceptanceOwnerId" });
const actionCategories = Object.freeze(["planning", "work", "development", "verification"]);
const requiredFieldNames = Object.freeze(["description", "acceptanceCriteria", "reproductionSteps", "expectedResult", "actualResult", "releaseId", "qaOwnerId", "acceptanceOwnerId"]);
function workflowHandler(issue, node) {
  const action = issue.actions?.find(action => action.nodeId === node?.id && ["ready", "active"].includes(action.status));
  return action?.explicitHandler && node?.handler !== "developer" ? action.handlerId : issue[handlerFields[node?.handler]] || null;
}
function workflowStepPermissions(issue, node) {
  return [...new Set((issue.workflowVersion?.definition?.transitions || []).filter(edge => edge.from === node?.id).flatMap(edge => edge.trigger === "development.assigned" ? ["issue.assign", "session.start"] : [edge.permission]))];
}
function canProcessWorkflowStep(issue, node, permissions) {
  return permissions.includes("issue.view") && workflowStepPermissions(issue, node).some(permission => permissions.includes(permission));
}
function assertWorkflowHandler(issue, node, actorId) {
  if (workflowHandler(issue, node) !== actorId) throw accountError("此步骤由指定处理人操作，请联系业务负责人调整分派。", 403);
}
function assertTransitionFields(issue, transition) {
  const missing = (transition.requiredFields || []).filter(field => field === "acceptanceCriteria" ? !issue.acceptanceCriteria?.length : !issue[field]?.trim());
  const labels = { description: "描述", acceptanceCriteria: "验收标准", reproductionSteps: "复现步骤", expectedResult: "预期结果", actualResult: "实际结果", releaseId: "目标版本", qaOwnerId: "测试负责人", acceptanceOwnerId: "业务验收人" };
  if (missing.length) throw accountError("流转所需资料尚未填写：" + missing.map(field => labels[field]).join("、"), 400);
}
function actionBucket(category, status) {
  if (!["ready", "active"].includes(status)) return null;
  return category === "verification" ? "verify" : status === "active" ? "doing" : "todo";
}
function developmentAction(task, execution, requests = []) {
  if (["cancelled", "merged"].includes(task.status)) return null;
  if (task.status === "completed" && (task.snapshot.kind === "manual" || !task.snapshot.issues?.length)) return null;
  if (task.workflowEvents?.length) return { bucket: "todo", label: "处理业务流转", phase: "流转受阻" };
  if (requests.length) return { bucket: "todo", label: "处理审批或问题", phase: "等待你处理" };
  if (["running", "preparing", "starting"].includes(execution?.status)) return { bucket: "doing", label: "查看进度", phase: execution.status === "running" ? "执行中" : "准备环境" };
  if (task.status === "completed") return null;
  if (task.issueLinks?.length && task.issueLinks.every(link => link.issue.deliverables?.[0]?.taskId === task.id && (["pending", "returned"].includes(link.issue.deliverables[0].status) || !link.issue.workflowVersion?.definition.nodes.find(node => node.id === link.issue.status)?.allowDevelopment) || ["completed", "cancelled"].includes(link.issue.workflowVersion?.definition.nodes.find(node => node.id === link.issue.status)?.kind))) return null;
  if (task.status === "planned") return { trigger: "development.started", bucket: "todo", label: "开始开发", phase: "待开发" };
  if (["completed", "failed", "interrupted", "cancelled"].includes(execution?.status)) return { bucket: "todo", label: "整理成果", phase: "本轮已结束" };
  return { bucket: "todo", label: "核对原执行", phase: "执行结果待确认" };
}
module.exports = { handlerFields, actionCategories, requiredFieldNames, workflowHandler, workflowStepPermissions, canProcessWorkflowStep, assertWorkflowHandler, assertTransitionFields, actionBucket, developmentAction };
