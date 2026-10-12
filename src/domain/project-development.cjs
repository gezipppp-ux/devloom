const { validateBaseBranch } = require("./development-baseline.cjs");
const { accountError } = require("./account.cjs");
const { object, text, identifiers, identifier, revision } = require("./project-issues.cjs");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function developmentInput(input, addition = false) {
  object(input, addition ? ["requestId", "issueIds", "send"] : ["requestId", "issueIds", "title", "executorId"]);
  if (!UUID.test(input.requestId || "")) throw accountError("开发请求标识无效，请重新打开表单。", 400);
  const issueIds = identifiers(input.issueIds, "事项", 20);
  if (!issueIds.length) throw accountError("请选择至少一条事项。", 400);
  if (addition && input.send !== undefined && typeof input.send !== "boolean") throw accountError("发送选项无效。", 400);
  const result = { requestId: input.requestId, issueIds };
  if (addition) result.send = input.send === true;
  else {
    if (Object.hasOwn(input, "title")) result.title = text(input.title, "任务标题", 200, { required: true });
    if (Object.hasOwn(input, "executorId")) result.executorId = identifier(input.executorId, "执行人");
  }
  return result;
}
function developmentStartInput(input) {
  object(input, ["requestId", "revision", "baseBranch", "model", "reasoningEffort", "permissionMode"]);
  if (!UUID.test(input.requestId || "")) throw accountError("开发请求标识无效。", 400);
  const result = { requestId: input.requestId, revision: revision(input.revision), baseBranch: validateBaseBranch(input.baseBranch) };
  for (const field of ["model", "reasoningEffort", "permissionMode"]) if (Object.hasOwn(input, field)) result[field] = text(input[field], "执行设置", 200);
  return result;
}
function developmentEditInput(input) {
  object(input, ["revision", "title", "executorId", "issueIds"]);
  const result = { revision: revision(input.revision) };
  if (Object.hasOwn(input, "title")) result.title = text(input.title, "任务标题", 200, { required: true });
  if (Object.hasOwn(input, "executorId")) result.executorId = identifier(input.executorId, "执行人");
  if (Object.hasOwn(input, "issueIds")) {
    result.issueIds = identifiers(input.issueIds, "事项", 20);
    if (!result.issueIds.length) throw accountError("请选择至少一条事项。", 400);
  }
  return result;
}
function developmentPrompt(issues, addition = false) {
  const content = [addition ? "以下是本轮明确追加的项目事项快照。请结合已有实现处理，不自动更改事项业务状态。" : "请实现以下项目事项，结合每条事项的验收要求与复现信息开展开发。事项业务状态由成员单独维护。",
    ...issues.map(issue => [
      `--- 项目事项 #${issue.number}（${issue.type === "bug" ? "Bug" : "需求"}，修订 ${issue.revision}）---`,
      `标题：${issue.title}`, issue.description,
      issue.acceptanceCriteria ? `验收标准：\n${issue.acceptanceCriteria}` : "",
      issue.reproductionSteps ? `复现步骤：\n${issue.reproductionSteps}` : "",
      issue.expectedResult ? `预期结果：\n${issue.expectedResult}` : "",
      issue.actualResult ? `实际结果：\n${issue.actualResult}` : "",
      issue.source?.url ? `来源：${issue.source.url}` : "",
      issue.files?.length ? `事项附件：${issue.files.map(file => file.name).join("、")}。仅支持的图片附件会作为本轮图片传入。` : "",
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
  if (content.length > 60000) throw accountError("所选事项合计超过 60000 字，请拆分开发任务。", 400);
  return content;
}

module.exports = { developmentInput, developmentStartInput, developmentEditInput, developmentPrompt };
