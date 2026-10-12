const { accountError } = require("./account.cjs");

const ISSUE_TYPES = ["requirement", "bug"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const SEVERITIES = ["minor", "normal", "major", "critical"];
const contentFields = ["releaseId", "title", "description", "priority", "acceptanceCriteria", "reproductionSteps", "expectedResult", "actualResult", "severity"];
const assignmentFields = ["participantIds"];

function text(value, label, limit, { required = false } = {}) {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim()))
    throw accountError(`${label}需为${required ? "非空" : ""}文本，最多 ${limit} 字。`, 400);
  return value.trim();
}
function object(input, allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)))
    throw accountError("请求包含无效或不支持的字段。", 400);
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw accountError("请提供有效修订号。", 400);
  return value;
}
function identifier(value, label = "标识") {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw accountError(`${label}无效。`, 400);
  return value;
}
function identifiers(value, label, maximum = 50) {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length)
    throw accountError(`${label}需为最多 ${maximum} 个不同标识。`, 400);
  return value.map(id => identifier(id, label));
}
function choice(value, choices, label) {
  if (!choices.includes(value)) throw accountError(`${label}无效。`, 400);
  return value;
}
function issueRequestId(input) {
  if (!Object.hasOwn(input, "requestId")) return undefined;
  if (typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId))
    throw accountError("创建请求标识需为 UUIDv4。", 400);
  return input.requestId.toLowerCase();
}
function issueInput(input, current) {
  object(input, ["attachments", ...contentFields, ...assignmentFields, ...(current ? ["revision"] : ["type", "requestId"])]);
  if (current) revision(input.revision);
  const type = current?.type || choice(input.type, ISSUE_TYPES, "事项类型");
  const value = current ? {} : { type, title: "", description: "", priority: "normal", severity: "normal", assigneeId: null, participantIds: [], acceptanceCriteria: "", reproductionSteps: "", expectedResult: "", actualResult: "" };
  for (const field of contentFields) if (Object.hasOwn(input, field)) {
    value[field] = field === "releaseId" ? (input[field] === null ? null : identifier(input[field], "发布版本"))
      : field === "priority" ? choice(input[field], PRIORITIES, "优先级")
      : field === "severity" ? choice(input[field], SEVERITIES, "严重程度")
        : text(input[field], field === "title" ? "标题" : "内容", field === "title" ? 200 : 60000, { required: field === "title" });
  }
  if (!current && !value.title) throw accountError("请填写事项标题。", 400);
  if (Object.hasOwn(input, "participantIds")) value.participantIds = identifiers(input.participantIds, "参与人");
  return value;
}
function issueTransition(issue, input) {
  object(input, ["transitionId", "status", "revision", "reason"]);
  revision(input.revision);
  const allowed = issueTransitions(issue).find(entry => input.transitionId ? entry.id === input.transitionId : entry.status === input.status);
  if (!allowed) throw accountError("不允许此事项状态流转。", 409);
  const reason = input.reason === undefined ? "" : text(input.reason, "流转原因", 4000);
  if (allowed.requiresReason && !reason)
    throw accountError("重新打开、驳回、取消或退回事项必须填写原因。", 400);
  return { status: allowed.status, reason, permission: allowed.permission };
}
function issueTransitions(issue) {
  return (issue.workflowVersion?.definition?.transitions || []).filter(edge => edge.from === issue.status).map(edge => ({ id: edge.id, name: edge.name, status: edge.to, permission: edge.permission, requiresReason: edge.requiresReason }));
}
function pageInput(input = {}) {
  const limit = input.limit === undefined || input.limit === null ? 30 : Number(input.limit);
  const offset = input.offset === undefined || input.offset === null ? 0 : Number(input.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw accountError("分页范围无效。", 400);
  return { limit, offset, query: input.query == null ? "" : text(input.query, "搜索内容", 200) };
}

module.exports = { issueRequestId, ISSUE_TYPES, PRIORITIES, SEVERITIES, contentFields, assignmentFields, text, object, revision, identifier, identifiers, choice, issueInput, issueTransition, issueTransitions, pageInput };
