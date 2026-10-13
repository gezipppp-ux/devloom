function supplierSummary(row) {
  return { id: row.id, agentType: row.agentType, name: row.name, mode: row.mode, runtimeRevision: row.runtimeRevision };
}
function presentSupplier(row) {
  return { ...supplierSummary(row), baseUrl: row.baseUrl, notes: row.notes, models: row.models, defaultModel: row.defaultModel,
    enabled: row.enabled, revision: row.revision, hasApiKey: Boolean(row.credentials), builtin: row.mode === "server-config" };
}
module.exports = { supplierSummary, presentSupplier };
