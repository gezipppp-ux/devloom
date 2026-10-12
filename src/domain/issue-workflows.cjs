const { accountError } = require("./account.cjs");

function invalid(message) { throw accountError(message, 400); }
function workflowDefinition(input, { publish = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["nodes", "transitions"].includes(key)) || !Array.isArray(input.nodes) || !Array.isArray(input.transitions) || input.nodes.length > 100 || input.transitions.length > 500) invalid("流程定义无效。");
  const ids = new Set();
  const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  const validName = name => typeof name === "string" && name.trim().length > 0 && name.length <= 100 && !/[\u0000-\u001f]/.test(name);
  const nodes = input.nodes.map(node => {
    if (!node || Object.keys(node).some(key => !["id", "name", "kind", "allowDevelopment", "x", "y"].includes(key)) || !validId(node.id) || ids.has(node.id) || !validName(node.name) || !["initial", "normal", "completed", "cancelled"].includes(node.kind) || typeof node.allowDevelopment !== "boolean") invalid("流程节点标识、名称或属性无效。");
    ids.add(node.id);
    if (["completed", "cancelled"].includes(node.kind) && node.allowDevelopment) invalid("完成或取消节点不能允许开发。");
    for (const key of ["x", "y"]) if (node[key] !== undefined && (!Number.isFinite(node[key]) || Math.abs(node[key]) > 100000)) invalid("节点坐标无效。");
    return { ...node, name: node.name.trim() };
  });
  const edgeIds = new Set();
  const transitions = input.transitions.map(edge => {
    if (!edge || Object.keys(edge).some(key => !["id", "from", "to", "name", "permission", "requiresReason"].includes(key)) || !validId(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || !validName(edge.name) || !["issue.transition", "issue.accept"].includes(edge.permission) || typeof edge.requiresReason !== "boolean") invalid("流程连线、操作权限或名称无效。");
    edgeIds.add(edge.id);
    return { ...edge, name: edge.name.trim() };
  });
  if (publish) {
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
  if (type === "requirement") {
    const nodes = [
      { id: "planned", name: "规划中", kind: "initial", allowDevelopment: true },
      { id: "developing", name: "开发中", kind: "normal", allowDevelopment: true },
      { id: "pending_verification", name: "待验证", kind: "normal", allowDevelopment: false },
      { id: "verifying", name: "验证中", kind: "normal", allowDevelopment: false },
      { id: "implemented", name: "已实现", kind: "completed", allowDevelopment: false },
      { id: "rejected", name: "已拒绝", kind: "cancelled", allowDevelopment: false },
    ].map((node, index) => ({ ...node, x: index < 5 ? index * 240 + 40 : 520, y: index < 5 ? 40 : 240 }));
    const edges = [
      ["planned", "developing", "开始开发"], ["developing", "pending_verification", "提交验证"],
      ["pending_verification", "verifying", "开始验证"], ["verifying", "implemented", "验证通过"],
      ["developing", "planned", "退回规划"], ["pending_verification", "developing", "退回开发"],
      ["verifying", "developing", "验证失败"], ["implemented", "planned", "重新打开"], ["rejected", "planned", "重新规划"],
      ...["planned", "developing", "pending_verification", "verifying"].map(from => [from, "rejected", "拒绝"]),
    ];
    return { nodes, transitions: edges.map(([from, to, name]) => ({ id: `${from}_${to}`, from, to, name,
      permission: ["pending_verification", "verifying"].includes(from) ? "issue.accept" : "issue.transition",
      requiresReason: ["implemented", "rejected"].includes(from) || to === "rejected" || to === "planned" || (["pending_verification", "verifying"].includes(from) && to === "developing") })) };
  }
  const nodes = [
    { id: "pending", name: "待处理", kind: "initial", allowDevelopment: true },
    { id: "processing", name: "处理中", kind: "normal", allowDevelopment: true },
    { id: "resolved", name: "已解决待验证", kind: "normal", allowDevelopment: false },
    { id: "verified", name: "已验证待关闭", kind: "normal", allowDevelopment: false },
    { id: "closed", name: "已关闭", kind: "completed", allowDevelopment: false },
    { id: "failed", name: "失败待处理", kind: "normal", allowDevelopment: true },
    { id: "cancelled", name: "已取消", kind: "cancelled", allowDevelopment: false },
  ].map((node, index) => ({ ...node, x: index < 5 ? index * 240 + 40 : index === 5 ? 280 : 760, y: index < 5 ? 40 : 240 }));
  const edges = [
    ["pending", "processing", "开始处理"], ["processing", "resolved", "提交验证"],
    ["resolved", "verified", "验证通过"], ["verified", "closed", "关闭缺陷"],
    ["resolved", "failed", "验证失败"], ["verified", "failed", "退回处理"], ["failed", "processing", "重新处理"],
    ["processing", "pending", "退回待处理"], ["closed", "pending", "重新打开"], ["cancelled", "pending", "恢复处理"],
    ...["pending", "processing", "resolved", "verified", "failed"].map(from => [from, "cancelled", "取消"]),
  ];
  return { nodes, transitions: edges.map(([from, to, name]) => ({ id: `${from}_${to}`, from, to, name,
    permission: ["resolved", "verified"].includes(from) ? "issue.accept" : "issue.transition",
    requiresReason: ["closed", "cancelled"].includes(from) || ["cancelled", "failed", "pending"].includes(to) })) };

}
function issueWorkflowNode(issue) { return issue.workflowVersion?.definition?.nodes.find(node => node.id === issue.status); }
function issueDevelopmentAllowed(issue) { const node = issueWorkflowNode(issue); return issue.release?.status !== "archived" && !["completed", "cancelled"].includes(node?.kind) && node?.allowDevelopment === true; }
function issueCompleted(issue) { return ["completed", "cancelled"].includes(issueWorkflowNode(issue)?.kind); }
function assertIssueWritable(issue) { if (issue.release?.status === "archived") throw accountError("发布版本已归档，事项只读；请先恢复版本。", 409); }

module.exports = { workflowDefinition, defaultWorkflow, issueWorkflowNode, issueDevelopmentAllowed, issueCompleted, assertIssueWritable };
