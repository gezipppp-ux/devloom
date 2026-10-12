// Database diagnostics may contain SQL, generated code and connection details.
// Preserve domain errors, but expose only actionable storage failure messages.
function presentError(error) {
  if (!/^P\d{4}$/.test(error.code || "")) return error;
  return Object.assign(new Error(error.code === "P2034"
    ? "数据已变更，请刷新后重试。"
    : "数据服务暂时不可用，请稍后重试。"), error.code === "P2034"
    ? { statusCode: 409, code: "STORAGE_CONFLICT" }
    : { statusCode: 503, code: "STORAGE_UNAVAILABLE" });
}

module.exports = { presentError };
