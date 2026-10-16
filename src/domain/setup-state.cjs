const steps = require("../../shared/setup-steps.json");
const { accountError, validateAccountCreation } = require("./account.cjs");
const { projectInput, projectId } = require("./project-input.cjs");

const SETUP_ID = "installation";
const required = row => ["awaiting_admin", "pending"].includes(row.status);
function currentStep(row) {
  if (row.status === "awaiting_admin") return "admin";
  return steps.find(step => step.id !== "admin" && !row.steps[step.id])?.id || "complete";
}
function object(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key)))
    throw accountError("初始化参数无效。");
}
function envelope(input) {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw accountError("请重新加载初始化进度。", 409);
  if (typeof input.requestId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.requestId))
    throw accountError("初始化请求标识无效。");
}
function setupAdminInput(input) {
  object(input, ["username", "displayName", "password"]);
  return validateAccountCreation(input, { initial: true });
}
function setupStepInput(step, input) {
  object(input, ["revision", "requestId", "skip", "value"]);
  envelope(input);
  if (!["environment", "directory", "departments", "accounts", "project", "complete"].includes(step)) throw accountError("初始化步骤不存在。", 404);
  if (input.skip !== undefined && typeof input.skip !== "boolean") throw accountError("跳过标记无效。");
  if (input.skip) {
    if (!["accounts", "project"].includes(step)) throw accountError("此步骤不能跳过。");
    if (input.value !== undefined) throw accountError("跳过步骤不能同时提交创建参数。");
    return { revision: input.revision, requestId: input.requestId, skip: true };
  }
  const value = input.value || {};
  if (step === "directory") {
    object(value, ["memberStorageRoot"]);
    if (typeof value.memberStorageRoot !== "string" || value.memberStorageRoot.length > 4096) throw accountError("成员目录无效。");
  } else if (step === "accounts") {
    object(value, ["accounts"]);
    if (!Array.isArray(value.accounts) || !value.accounts.length || value.accounts.length > 2) throw accountError("请选择一至两个测试账号，或跳过本步。");
    const kinds = new Set();
    for (const account of value.accounts) {
      object(account, ["kind", "username", "displayName", "password"]);
      if (!["product", "developer"].includes(account.kind) || kinds.has(account.kind)) throw accountError("测试账号部门无效或重复。");
      kinds.add(account.kind);
      validateAccountCreation({ username: account.username, displayName: account.displayName, password: account.password }, { initial: true });
    }
  } else if (step === "project") {
    object(value, ["name", "description", "remoteUrl", "memberIds"]);
    projectInput({ name: value.name, remoteUrl: value.remoteUrl, ...(value.description !== undefined ? { description: value.description } : {}) });
    if (!Array.isArray(value.memberIds) || value.memberIds.length > 2 || new Set(value.memberIds).size !== value.memberIds.length) throw accountError("请选择有效测试成员。");
    value.memberIds.forEach(projectId);
  } else object(value, []);
  return { revision: input.revision, requestId: input.requestId, value };
}
function assertSetupStep(row, step, revision) {
  if (row.status !== "pending") throw accountError("初始化已结束或尚未创建管理员。", 409, "SETUP_STATE_CONFLICT");
  if (row.revision !== revision) throw accountError("初始化进度已变更，请保留输入并重新加载。", 409, "REVISION_CONFLICT");
  if (row.steps[step]?.status === "completed" && step !== "environment") throw accountError("此步骤已经完成，请重新加载结果。", 409);
  const index = steps.findIndex(item => item.id === step);
  if (steps.slice(0, index).some(item => !row.steps[item.id])) throw accountError("请先完成前面的初始化步骤。", 409);
}
function environmentReadiness(report) {
  if (!report || report.busy || report.job?.status === "restart-required") return false;
  for (const id of ["git", "codex", "node", "npm"]) {
    const tool = report.tools?.find(item => item.id === id);
    if (!tool || tool.pendingRestart || !(tool.binaryReady ?? tool.status === "pass")) return false;
  }
  return !report.checks?.some(check => check.name !== "成员目录可写" && check.status !== "pass");
}
function setupDraftInput(input) {
  object(input, ["revision", "drafts"]);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw accountError("初始化修订号无效。", 409);
  object(input.drafts, ["directory", "accounts", "project"]);
  const result = {};
  if (input.drafts.directory !== undefined) {
    if (typeof input.drafts.directory !== "string" || input.drafts.directory.length > 4096) throw accountError("目录草稿无效。");
    result.directory = input.drafts.directory;
  }
  if (input.drafts.accounts !== undefined) {
    if (!Array.isArray(input.drafts.accounts) || input.drafts.accounts.length !== 2) throw accountError("账号草稿无效。");
    result.accounts = input.drafts.accounts.map((account, index) => {
      object(account, ["username", "displayName", "selected"]);
      if (typeof account.selected !== "boolean") throw accountError("账号选中状态无效。");
      if (typeof account.username !== "string" || account.username.length > 64 || typeof account.displayName !== "string" || account.displayName.length > 80) throw accountError("账号草稿无效。");
      return { username: account.username, displayName: account.displayName, selected: account.selected, kind: index ? "developer" : "product" };
    });
  }
  if (input.drafts.project !== undefined) {
    const value = input.drafts.project;
    object(value, ["name", "description", "remoteUrl", "memberIds"]);
    for (const [key, maximum] of [["name", 80], ["description", 8000], ["remoteUrl", 4096]])
      if (typeof value[key] !== "string" || value[key].length > maximum) throw accountError("项目草稿无效。");
    // Partial addresses are allowed as drafts; credentials are never persisted there.
    if (/https?:\/\/[^/\s]*@/i.test(value.remoteUrl) || /[a-z][a-z0-9+.-]*:\/\/[^/\s]*:[^/\s]*@/i.test(value.remoteUrl) || /[?#]/.test(value.remoteUrl)) throw accountError("仓库地址草稿不能包含凭据、查询参数或片段。");
    if (!Array.isArray(value.memberIds) || value.memberIds.length > 2) throw accountError("项目成员草稿无效。");
    value.memberIds.forEach(projectId);
    result.project = { ...value };
  }
  return { revision: input.revision, drafts: result };
}
module.exports = { SETUP_ID, required, currentStep, setupAdminInput, setupStepInput, assertSetupStep, environmentReadiness, setupDraftInput };
