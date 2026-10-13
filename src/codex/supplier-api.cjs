const { accountError } = require("../domain/account.cjs");

async function supplierRequest(connection, resource, payload, fetcher = fetch) {
  const timeout = AbortSignal.timeout(20000);
  try {
    const response = await fetcher(`${connection.baseUrl}/${resource}`, { method: payload ? "POST" : "GET", redirect: "error", signal: timeout,
      headers: { Authorization: `Bearer ${connection.apiKey}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
    if (!response.ok) {
      await response.body?.cancel();
      const reason = [401, 403].includes(response.status) ? "认证或访问权限失败" : response.status === 429 ? "供应商限流或额度不足" : "供应商请求失败";
      throw accountError(`${reason}（HTTP ${response.status}）。`, 400);
    }
    if (!response.body) throw accountError("供应商返回空响应。", 400);
    const reader = response.body.getReader();
    const parts = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 1024 * 1024) throw accountError("供应商响应超出大小限制。", 400);
        parts.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
    catch { throw accountError("供应商返回的内容不是有效 JSON。", 400); }
  } catch (error) {
    if (error.statusCode) throw error;
    throw accountError(timeout.aborted ? "供应商请求超时。" : "无法连接供应商，请检查地址、网络及接口协议。", 400);
  }
}
async function fetchSupplierModels(connection, fetcher) {
  const result = await supplierRequest(connection, "models", undefined, fetcher);
  if (!Array.isArray(result?.data)) throw accountError("供应商未返回有效模型列表，可手动填写模型。", 400);
  const models = [...new Set(result.data.map(entry => entry?.id).filter(id => typeof id === "string" && /^[^\s\x00-\x1f\x7f]{1,100}$/.test(id)))];
  return models.slice(0, 500).map(model => ({ model, label: model }));
}
async function checkSupplier(connection, fetcher) {
  const started = Date.now();
  const result = await supplierRequest(connection, "responses", { model: connection.model, input: "Reply with OK.", stream: false, store: false, max_output_tokens: 128 }, fetcher);
  if (result?.error || result?.status !== "completed" || !Array.isArray(result.output) ||
    !result.output.some(item => item.type === "message" && item.content?.some(part => part.type === "output_text" && typeof part.text === "string" && part.text.trim())))
    throw accountError("接口已响应，但未返回完整的 Responses 文本结果，请检查模型及协议兼容性。", 400);
  return { ok: true, elapsedMs: Date.now() - started, model: connection.model };
}
module.exports = { fetchSupplierModels, checkSupplier };
