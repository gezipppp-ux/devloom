const { actionBucket, developmentAction, workflowHandler, canProcessWorkflowStep } = require("../domain/workflow-actions.cjs");
const { issueWorkflowNode } = require("../domain/issue-workflows.cjs");

function presentWorkActions(snapshot, projects, pending = new Map()) {
  const directory = new Map(projects.map(project => [project.id, project]));
  const base = (row, kind) => ({ id: row.id, kind, projectId: row.projectId, projectName: directory.get(row.projectId).name, createdAt: row.createdAt.toISOString(), dueDate: row.dueDate || null, priority: row.priority || "normal" });
  const items = [];
  const deliveries = snapshot.deliveries.filter(delivery =>
    ["collaboration.view", "issue.view", delivery.assignmentProblem ? "issue.assign" : delivery.status === "returned" ? "deliverable.create" : "deliverable.review"]
      .every(permission => directory.get(delivery.projectId).permissions.includes(permission)));
  const pendingIssueIds = new Set(deliveries.filter(delivery => !delivery.assignmentProblem && ["pending", "returned"].includes(delivery.status)).map(delivery => delivery.issueId));
  const returnedIssueIds = new Set(deliveries.filter(delivery => delivery.status === "returned").map(delivery => delivery.issueId));
  for (const action of snapshot.actions) {
    const project = directory.get(action.projectId), issue = action.issue;
    const node = issueWorkflowNode(issue), needsAssignment = action.assignmentProblem || !workflowHandler({ ...issue, actions: [action] }, node);
    if (!project.permissions.includes("issue.view") || (needsAssignment ? !project.permissions.includes("issue.assign") : !canProcessWorkflowStep(issue, node, project.permissions))) continue;
    const claim = issue.developmentClaim;
    if (needsAssignment && node.handler === "developer" && snapshot.tasks.some(task => task.assignmentProblem && task.id === claim?.taskId)) continue;
    if (!needsAssignment && (returnedIssueIds.has(issue.id) || action.category === "verification" && pendingIssueIds.has(issue.id) || action.category === "development" && claim?.task.executorId === action.handlerId)) continue;
    items.push({ ...base(action, "issue"), issueId: issue.id, number: issue.number, title: issue.title, priority: issue.priority, dueDate: issue.dueDate,
      bucket: needsAssignment ? "todo" : actionBucket(action.category, action.status), phase: node.name, label: needsAssignment ? "分派处理人" : action.category === "verification" ? "处理验证" : "推进事项", reason: needsAssignment ? "当前步骤处理人缺失或权限失效，需要业务负责人分派" : "流程当前步骤已分派给你", status: action.status, revision: action.revision });
  }
  for (const task of snapshot.tasks) {
    const project = directory.get(task.projectId);
    if (task.assignmentProblem) {
      if (project.permissions.includes("issue.view") && project.permissions.includes("issue.assign")) items.push({ ...base(task, "task"), taskId: task.id, title: task.snapshot.title, bucket: "todo", phase: "等待分派处理人", label: "处理开发分派", reason: "开发执行人权限已失效，请检查任务并重新安排", revision: task.revision });
      continue;
    }
    if (!["session.view", "session.start"].every(permission => project.permissions.includes(permission))) continue;
    const requests = project.permissions.includes("session.approve") ? pending.get(`${task.workspaceId}/${task.runKey}`) || [] : [];
    const state = developmentAction(task, task.execution, requests);
    if (!state) continue;
    const labels = state.trigger === 'development.started' ? [...new Set((task.issueLinks || []).flatMap(({ issue }) => issue.workflowVersion.definition.transitions.filter(edge => edge.from === issue.status && edge.trigger === 'development.started').map(edge => edge.name)))] : [];
    if (labels.length === 1) state.workflowLabel = labels[0];
    items.push({ ...base(task, "task"), ...state, title: task.snapshot.title, taskId: task.id, workspaceId: task.workspaceId, runKey: task.runKey,
      blocking: requests.length > 0, notificationKey: requests.map(request => `${request.turnId}:${request.id}`).sort().join("/"), reason: requests.length ? "本轮执行等待你的决定" : "你是此开发任务的执行人", revision: task.revision });
  }
  for (const session of snapshot.sessions || []) {
    if (snapshot.linkedRuns.some(task => task.workspaceId === session.workspaceId && task.runKey === session.key)) continue;
    items.push({ id: `${session.workspaceId}/${session.key}`, kind: "session", projectId: session.projectId, projectName: directory.get(session.projectId).name,
      title: session.title, workspaceId: session.workspaceId, runKey: session.key, bucket: "todo", label: "处理审批或问题", phase: "等待你处理", reason: "本轮执行等待你的决定", blocking: true, priority: "normal", createdAt: session.updatedAt || "", notificationKey: session.requests.map(request => `${request.turnId}:${request.id}`).sort().join("/") });
  }
  for (const delivery of deliveries) {
    const returned = delivery.status === "returned";
    const recovery = delivery.assignmentProblem;
    const trigger = returned ? 'delivery.submitted' : !delivery.verificationStartedAt ? 'verification.started' : null;
    const workflowLabel = delivery.issue?.workflowVersion?.definition.transitions.find(edge => edge.from === delivery.issue.status && edge.trigger === trigger)?.name || null;
    if (recovery) { items.push({ ...base(delivery, "delivery"), deliveryId: delivery.id, title: delivery.title, bucket: "todo", phase: "等待分派处理人", label: "重新指定验证人", reason: "交付验证人权限已失效", revision: delivery.revision }); continue; }
    items.push({ ...base(delivery, "delivery"), deliveryId: delivery.id, issueId: delivery.issueId, title: delivery.title, workflowLabel, bucket: returned ? "todo" : "verify", phase: returned ? "交付退回" : delivery.verificationStartedAt ? "验证中" : "待开始验证", label: returned ? "修改并重新提交" : delivery.verificationStartedAt ? "继续验证" : "开始验证", reason: returned ? "你发布的交付被退回，请处理验证意见" : "你是此交付的指定验证人", revision: delivery.revision, priority: delivery.issue?.priority || "normal", dueDate: delivery.issue?.dueDate || null });
  }
  const priority = { urgent: 0, high: 1, normal: 2, low: 3 };
  items.sort((a, b) => Number(Boolean(b.blocking)) - Number(Boolean(a.blocking)) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || priority[a.priority] - priority[b.priority] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return items;
}
function presentActionAttention(actions) {
  const items = actions.filter(action => ["todo", "verify"].includes(action.bucket)).map(action => ({ id: `${action.kind}:${action.id}:${action.revision || 0}:${action.notificationKey || ""}`,
    kind: action.kind, issueId: action.issueId, taskId: action.taskId, deliveryId: action.deliveryId, workspaceId: action.workspaceId, runKey: action.runKey,
    label: action.label, workflowLabel: action.workflowLabel || null, title: action.title, projectId: action.projectId, projectName: action.projectName, updatedAt: action.createdAt }));
  return { items, total: items.length };
}
module.exports = { presentWorkActions, presentActionAttention };
