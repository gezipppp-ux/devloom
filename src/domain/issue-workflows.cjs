const { accountError } = require("./account.cjs");

const workflowEvents = require("../../shared/workflow-events.json");
const { handlerFields, actionCategories, requiredFieldNames } = require("./workflow-actions.cjs");

function invalid(message) { throw accountError(message, 400); }
function workflowDefinition(input, { publish = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["nodes", "transitions"].includes(key)) || !Array.isArray(input.nodes) || !Array.isArray(input.transitions) || input.nodes.length > 100 || input.transitions.length > 500) invalid("流程定义无效。");
  const ids = new Set();
  const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  const validName = name => typeof name === "string" && name.trim().length > 0 && name.length <= 100 && !/[\u0000-\u001f]/.test(name);
  const nodes = input.nodes.map(node => {
    if (!node || Object.keys(node).some(key => !["id", "name", "kind", "allowDevelopment", "x", "y", "handler", "category", "allowAssignment", "active"].includes(key)) || !validId(node.id) || ids.has(node.id) || !validName(node.name) || !["initial", "normal", "completed", "cancelled"].includes(node.kind) || typeof node.allowDevelopment !== "boolean") invalid("流程节点标识、名称或属性无效。");
    ids.add(node.id);
    if (["completed", "cancelled"].includes(node.kind) && node.allowDevelopment) invalid("完成或取消节点不能允许开发。");
    for (const key of ["x", "y"]) if (node[key] !== undefined && (!Number.isFinite(node[key]) || Math.abs(node[key]) > 100000)) invalid("节点坐标无效。");
    const handler = node.handler === undefined ? "businessOwner" : node.handler, category = node.category === undefined ? "work" : node.category;
    if (!Object.hasOwn(handlerFields, handler) || !actionCategories.includes(category)) invalid("处理职责或工作类别无效。");
    for (const key of ["allowAssignment", "active"]) if (node[key] !== undefined && typeof node[key] !== "boolean") invalid("节点动作属性无效。");
    if (["completed", "cancelled"].includes(node.kind) && node.allowAssignment) invalid("结束节点不能允许分派开发。");
    return { ...node, name: node.name.trim(), handler, category, allowAssignment: node.allowAssignment === true, active: node.active === true };
  });
  const edgeIds = new Set();
  const transitions = input.transitions.map(edge => {
    if (!edge || Object.keys(edge).some(key => !["id", "from", "to", "name", "permission", "requiresReason", "requiredFields", "requireAcceptedDelivery", "trigger", "actor", "assignment", "requireDelivery"].includes(key)) || !validId(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || !validName(edge.name) || !["issue.transition", "issue.accept"].includes(edge.permission) || typeof edge.requiresReason !== "boolean") invalid("流程连线、操作权限或名称无效。");
    if (edge.requiredFields !== undefined && (!Array.isArray(edge.requiredFields) || edge.requiredFields.some(field => !requiredFieldNames.includes(field)) || new Set(edge.requiredFields).size !== edge.requiredFields.length)) invalid("必填字段无效。");
    if (edge.requireAcceptedDelivery !== undefined && typeof edge.requireAcceptedDelivery !== "boolean") invalid("交付门禁无效。");
    const trigger = edge.trigger ?? "manual", actor = edge.actor ?? "handler", assignment = edge.assignment ?? "role";
    if (!Object.hasOwn(workflowEvents, trigger) || !workflowEvents[trigger].actors.includes(actor) || !["role", "selection", "executor", "reviewer", "submitter"].includes(assignment)) invalid("流转触发事件、操作主体或交接规则无效。");
    if (edge.requireDelivery !== undefined && typeof edge.requireDelivery !== "boolean") invalid("交付证据门禁无效。");
    if (assignment === "reviewer" && !["delivery.submitted", "verification.started"].includes(trigger)) invalid("仅送验或开始验证可以采用本轮验证人。");
    if (assignment === "submitter" && !["verification.returned", "manual"].includes(trigger)) invalid("仅退回或人工交接可以采用本轮交付提交人。");
    if (trigger === "verification.accepted" && nodes.find(node => node.id === edge.to)?.kind === "cancelled") invalid("验证通过不能进入取消节点。");
    if (trigger === "verification.returned" && ["completed", "cancelled"].includes(nodes.find(node => node.id === edge.to)?.kind)) invalid("退回修改不能进入结束节点。");
    edgeIds.add(edge.id);
    return { ...edge, name: edge.name.trim(), trigger, actor, assignment };
  });
  if (publish) {
    const eventKeys = new Set();
    for (const edge of transitions.filter(edge => edge.trigger !== "manual")) {
      const key = edge.from + ":" + edge.trigger;
      if (eventKeys.has(key)) invalid("同一节点的同一业务事件只能配置一条流转。");
      eventKeys.add(key);
    }
    for (const node of nodes) if (node.allowAssignment && !transitions.some(edge => edge.from === node.id && edge.trigger === "development.assigned") && node.handler !== "developer") invalid("允许认领的节点必须配置开发分派流转。");
    const initial = nodes.filter(node => node.kind === "initial");
    if (initial.length !== 1) invalid("流程必须有且仅有一个初始节点。");
    if (!nodes.some(node => ["completed", "cancelled"].includes(node.kind))) invalid("流程必须包含完成或取消节点。");
    const reachable = new Set([initial[0].id]);
    for (let changed = true; changed;) { changed = false; for (const edge of transitions) if (reachable.has(edge.from) && !reachable.has(edge.to)) { reachable.add(edge.to); changed = true; } }
    if (reachable.size !== nodes.length) invalid("所有节点必须可从初始节点到达。");
    const terminable = new Set(nodes.filter(node => ["completed", "cancelled"].includes(node.kind)).map(node => node.id));
    for (let changed = true; changed;) { changed = false; for (const edge of transitions) if (terminable.has(edge.to) && !terminable.has(edge.from)) { terminable.add(edge.from); changed = true; } }
    if (terminable.size !== nodes.length) invalid("每个节点必须能够到达完成或取消节点，不能形成无法结束的死路。");
  }
  return { nodes, transitions };
}
function defaultWorkflow(type) {
  const bug = type === "bug";
  const ids = { initial: bug ? "pending" : "planned", developing: bug ? "processing" : "developing", waiting: bug ? "resolved" : "pending_verification", done: bug ? "closed" : "implemented", rejected: bug ? "cancelled" : "rejected" };
  const makeNode = (id, name, kind, handler, category, allowDevelopment = false, extra = {}) => ({ id, name, kind, handler, category, allowDevelopment, allowAssignment: false, active: false, ...extra });
  const nodes = [
    makeNode(ids.initial, bug ? "待确认" : "规划中", "initial", "businessOwner", "planning", false, { allowAssignment: true }),
    makeNode("ready", "待开发", "normal", "developer", "development", true, { allowAssignment: true }),
    makeNode(ids.developing, bug ? "修复中" : "开发中", "normal", "developer", "development", true, { active: true, allowAssignment: true }),
    makeNode(ids.waiting, "待验证", "normal", "qaOwner", "verification"),
    makeNode("verifying", "验证中", "normal", "qaOwner", "verification", false, { active: true }),
    ...(bug ? [makeNode("verified", "待业务验收", "normal", "acceptanceOwner", "verification")] : []),
    makeNode(ids.done, bug ? "已关闭" : "已实现", "completed", "businessOwner", "work"),
    makeNode("rework", "待返工", "normal", "developer", "development", true, { allowAssignment: true }),
    makeNode(ids.rejected, bug ? "已取消" : "已拒绝", "cancelled", "businessOwner", "work"),
  ].map((node, i) => ({ ...node, x: 40 + (i % 5) * 240, y: 40 + Math.floor(i / 5) * 240 }));
  const transitions = [];
  const edge = (from, to, name, trigger, actor, assignment = "role", extra = {}) => transitions.push({ id: from + "_" + to, from, to, name, trigger, actor, assignment, permission: trigger.startsWith("verification.") || from === "verified" ? "issue.accept" : "issue.transition", requiresReason: false, ...extra });
  edge(ids.initial, "ready", "安排开发", "development.assigned", "assigner", "executor");
  edge("ready", ids.developing, "开始开发", "development.started", "developer", "executor");
  edge("rework", ids.developing, "继续开发", "development.started", "developer", "executor");
  edge(ids.developing, ids.waiting, "提交验证", "delivery.submitted", "developer", "reviewer", { requireDelivery: true });
  edge("rework", ids.waiting, "重新提交验证", "delivery.submitted", "developer", "reviewer", { requireDelivery: true });
  edge(ids.waiting, "verifying", "开始验证", "verification.started", "reviewer", "reviewer");
  for (const from of [ids.waiting, "verifying"]) {
    edge(from, bug ? "verified" : ids.done, "验证通过", "verification.accepted", "reviewer", "role", { requireAcceptedDelivery: true });
    edge(from, "rework", "退回修改", "verification.returned", "reviewer", "executor", { requiresReason: true });
  }
  if (bug) {
    edge("verified", ids.done, "业务验收通过", "manual", "handler", "role", { requireAcceptedDelivery: true });
    edge("verified", "rework", "退回修改", "manual", "handler", "executor", { requiresReason: true });
  }
  for (const from of [ids.done, ids.rejected]) edge(from, ids.initial, "重新打开", "manual", "assigner", "selection", { requiresReason: true });
  for (const from of nodes.filter(node => !["completed", "cancelled"].includes(node.kind)).map(node => node.id)) edge(from, ids.rejected, "取消事项", "manual", "handler", "role", { requiresReason: true });
  return { nodes, transitions };
}
function issueWorkflowNode(issue) { return issue.workflowVersion?.definition?.nodes.find(node => node.id === issue.status); }
function issueDevelopmentAllowed(issue) { const node = issueWorkflowNode(issue); return issue.release?.status !== "archived" && !["completed", "cancelled"].includes(node?.kind) && node?.allowDevelopment === true; }
function issueCompleted(issue) { return ["completed", "cancelled"].includes(issueWorkflowNode(issue)?.kind); }
function assertIssueWritable(issue) { if (issue.release?.status === "archived") throw accountError("发布版本已归档，事项只读；请先恢复版本。", 409); }

module.exports = { workflowDefinition, defaultWorkflow, issueWorkflowNode, issueDevelopmentAllowed, issueCompleted, assertIssueWritable };
