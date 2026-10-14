const { validateBaseBranch } = require("./development-baseline.cjs");
const { accountError } = require("./account.cjs");
const { getPromptTemplates, renderPromptTemplate } = require("./prompt-templates.cjs");
const { object, text, identifiers, identifier, revision } = require("./project-issues.cjs");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function developmentInput(input, addition = false) {
  object(input, addition ? ["requestId", "issueIds", "send"] : ["requestId", "issueIds", "executorId"]);
  if (!UUID.test(input.requestId || "")) throw accountError("开发请求标识无效，请重新打开表单。", 400);
  const issueIds = identifiers(input.issueIds, "事项", 20);
  if (!issueIds.length) throw accountError("请选择至少一条事项。", 400);
  if (addition && input.send !== undefined && typeof input.send !== "boolean") throw accountError("发送选项无效。", 400);
  const result = { requestId: input.requestId, issueIds };
  if (addition) result.send = input.send === true;
  else {
    if (Object.hasOwn(input, "executorId")) result.executorId = identifier(input.executorId, "执行人");
  }
  return result;
}
function developmentMergeInput(input) {
  object(input, ["requestId", "tasks", "title"]);
  if (!UUID.test(input.requestId || "")) throw accountError("合并请求标识无效。", 400);
  if (!Array.isArray(input.tasks) || input.tasks.length < 2 || input.tasks.length > 20) throw accountError("请选择 2 至 20 个待开发任务。", 400);
  const tasks = input.tasks.map(task => { object(task, ["id", "revision"]); return { id: identifier(task.id, "开发任务"), revision: revision(task.revision) }; });
  identifiers(tasks.map(task => task.id), "开发任务", 20);
  return { requestId: input.requestId, tasks, title: text(input.title, "合并后的任务标题", 200, { required: true }) };
}
function developmentStartInput(input) {
  object(input, ["requestId", "revision", "baseBranch", "model", "reasoningEffort", "permissionMode", "supplementaryPrompt"]);
  if (!UUID.test(input.requestId || "")) throw accountError("开发请求标识无效。", 400);
  const result = { requestId: input.requestId, revision: revision(input.revision), baseBranch: validateBaseBranch(input.baseBranch) };
  if (Object.hasOwn(input, "supplementaryPrompt")) result.supplementaryPrompt = text(input.supplementaryPrompt, "补充提示词", 20000);
  for (const field of ["model", "reasoningEffort", "permissionMode"]) if (Object.hasOwn(input, field)) result[field] = text(input[field], "执行设置", 200);
  return result;
}
function manualDevelopmentInput(input) {
  object(input, ["requestId", "title", "content", "images", "baseBranch", "model", "reasoningEffort", "permissionMode"]);
  if (!UUID.test(input.requestId || "")) throw accountError("开发请求标识无效，请重新打开表单。", 400);
  const result = { requestId: input.requestId, title: text(input.title, "任务标题", 200, { required: true }),
    content: text(input.content === undefined ? "" : input.content, "开发目标", 60000), images: identifiers(input.images === undefined ? [] : input.images, "图片", 20),
    baseBranch: validateBaseBranch(input.baseBranch) };
  if (result.images.some(id => !UUID.test(id))) throw accountError("图片标识无效。", 400);
  if (!result.content && !result.images.length) throw accountError("请填写开发目标或上传图片。", 400);
  for (const field of ["model", "reasoningEffort", "permissionMode"]) if (Object.hasOwn(input, field)) result[field] = text(input[field], "执行设置", 200);
  return result;
}
function manualDevelopmentPrompt(request, templates) {
  const type = "requirement";
  const prompt = renderPromptTemplate(type, templates[type], { title: request.title, content: request.content,
    images: `本次独立开发附带 ${request.images.length} 张图片，顺序与上传顺序一致。`,
    image_count: request.images.length, image_list: request.images.map((_, index) => `图片 ${index + 1}`).join("\n") });
  if (prompt.length > 60000) throw accountError("开发目标与提示词合计超过 60000 字，请缩短内容。", 400);
  return prompt;
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
function developmentPrompt(issues, addition = false, templates = getPromptTemplates(), supplement = {}) {
  let imageOffset = 0;
  const content = [addition ? "以下是本轮明确追加的项目事项快照。请结合已有实现处理，不自动更改事项业务状态。" : "请实现以下项目事项，结合每条事项的验收要求与复现信息开展开发。事项业务状态由成员单独维护。",
    ...issues.map(issue => {
      const files = (issue.files || []).filter(file => ["image/png", "image/jpeg", "image/webp"].includes(file.mimeType));
      const imageList = files.map(file => `图片 ${++imageOffset}：${file.name}`).join("\n");
      const details = [
        `--- 项目事项 #${issue.number}（${issue.type === "bug" ? "Bug" : "需求"}，修订 ${issue.revision}）---`,
        issue.description,
        issue.acceptanceCriteria ? `验收标准：\n${issue.acceptanceCriteria}` : "",
        issue.reproductionSteps ? `复现步骤：\n${issue.reproductionSteps}` : "",
        issue.expectedResult ? `预期结果：\n${issue.expectedResult}` : "",
        issue.actualResult ? `实际结果：\n${issue.actualResult}` : "",
        issue.source?.url ? `来源：${issue.source.url}` : "",
        issue.files?.length ? `事项附件：${issue.files.map(file => file.name).join("、")}。仅支持的图片附件会作为本轮图片传入。` : "",
      ].filter(Boolean).join("\n");
      return renderPromptTemplate(issue.type, templates[issue.type], {
        title: issue.title, content: details,
        images: files.length ? `本事项附带 ${files.length} 张图片，编号对应本轮全部图片的发送顺序。\n${imageList}` : "本事项没有图片附件。",
        image_count: files.length, image_list: imageList,
      });
    }),
    ...(supplement.content ? [renderPromptTemplate("supplement", templates.supplement, {
      title: supplement.title, content: supplement.content,
    })] : []),
  ].join("\n\n");
  if (content.length > 60000) throw accountError("所选事项与补充提示词合计超过 60000 字，请拆分开发任务。", 400);
  return content;
}

module.exports = { developmentInput, developmentMergeInput, developmentStartInput, manualDevelopmentInput, manualDevelopmentPrompt, developmentEditInput, developmentPrompt };
