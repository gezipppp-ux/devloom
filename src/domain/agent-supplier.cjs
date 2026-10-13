const { accountError } = require("./account.cjs");

const SERVER_SUPPLIER_ID = "codex-server-config";
const MODEL_ID = /^[^\s\x00-\x1f\x7f]{1,100}$/;
const EFFORT = /^[a-z][a-z0-9_-]{0,31}$/;
function object(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key)))
    throw accountError("供应商参数无效。", 400);
}
function text(value, name, maximum, empty = false) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw accountError(`${name}无效。`, 400);
  return value.trim();
}
function supplierRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw accountError("供应商修订号无效，请刷新后重试。", 400);
  return value;
}
function supplierAgent(value = "codex") {
  if (value !== "codex") throw accountError("暂不支持该 Agent 的供应商配置。", 400);
  return value;
}
function supplierUrl(value) {
  let url;
  try { url = new URL(text(value, "API 地址", 2000)); } catch { throw accountError("请填写完整的 HTTP(S) API 基础地址。", 400); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw accountError("API 地址不能包含凭据、查询参数或片段。", 400);
  return url.toString().replace(/\/+$/, "");
}
function supplierModels(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw accountError("请配置 1–100 个模型。", 400);
  const ids = new Set();
  return input.map(entry => {
    object(entry, ["model", "label", "reasoningEfforts", "defaultReasoningEffort"]);
    const model = text(entry.model, "模型 ID", 100);
    if (!MODEL_ID.test(model) || ids.has(model)) throw accountError("模型 ID 无效或重复。", 400);
    ids.add(model);
    const reasoningEfforts = entry.reasoningEfforts ?? [];
    if (!Array.isArray(reasoningEfforts) || reasoningEfforts.length > 12 || reasoningEfforts.some(value => typeof value !== "string" || !EFFORT.test(value)))
      throw accountError("模型思考强度无效。", 400);
    const defaultReasoningEffort = entry.defaultReasoningEffort ?? "";
    if (typeof defaultReasoningEffort !== "string" || (defaultReasoningEffort && !reasoningEfforts.includes(defaultReasoningEffort)))
      throw accountError("默认思考强度必须在模型支持范围内。", 400);
    return { model, label: text(entry.label || model, "模型名称", 200), reasoningEfforts: [...new Set(reasoningEfforts)], defaultReasoningEffort };
  });
}
function validateSupplier(input, previous) {
  object(input, ["agentType", "name", "baseUrl", "apiKey", "notes", "models", "defaultModel", "enabled", "revision"]);
  if (previous) supplierRevision(input.revision);
  const agentType = supplierAgent(input.agentType ?? previous?.agentType);
  if (typeof input.enabled !== "boolean") throw accountError("请选择供应商启用状态。", 400);
  const apiKey = input.apiKey === undefined ? previous?.apiKey : text(input.apiKey, "API Key", 8192);
  if (!apiKey) throw accountError("请填写 API Key。", 400);
  const models = supplierModels(input.models);
  const defaultModel = text(input.defaultModel, "默认模型", 100);
  if (!models.some(entry => entry.model === defaultModel)) throw accountError("默认模型必须在模型列表内。", 400);
  return { agentType, mode: "api-key", name: text(input.name, "供应商名称", 80), baseUrl: supplierUrl(input.baseUrl), apiKey,
    notes: text(input.notes ?? "", "备注", 1000, true), enabled: input.enabled, models, defaultModel };
}
function supplierSelection(supplier, input) {
  const model = input.model === undefined ? "" : input.model;
  const reasoningEffort = input.reasoningEffort === undefined ? "" : input.reasoningEffort;
  if (typeof model !== "string" || (model && !MODEL_ID.test(model)) || typeof reasoningEffort !== "string" || (reasoningEffort && !EFFORT.test(reasoningEffort)))
    throw accountError("无效的模型或思考强度。", 400);
  if (!model && reasoningEffort) throw accountError("请先选择具体模型，再设置思考强度。", 400);
  const selected = supplier.models.find(entry => entry.model === (model || supplier.defaultModel));
  if (!selected) throw accountError("所选模型不受当前供应商支持，请重新选择模型。", 409);
  if (reasoningEffort && !selected.reasoningEfforts.includes(reasoningEffort)) throw accountError("所选思考强度不受当前供应商支持，请重新选择。", 409);
  return { model, reasoningEffort, permissionMode: input.permissionMode };
}
module.exports = { SERVER_SUPPLIER_ID, supplierAgent, supplierRevision, supplierUrl, supplierModels, validateSupplier, supplierSelection, object };
