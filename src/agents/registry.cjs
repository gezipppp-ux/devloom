const { CodexAgent } = require("./codex-agent.cjs");
const { resolveCodex } = require("../codex/command.cjs");
const { fetchSupplierModels, checkSupplier } = require("../codex/supplier-api.cjs");
const { readModelCatalog } = require("../codex/model-catalog.cjs");

const codex = Object.freeze({
  id: "codex",
  label: "Codex",
  create: options => new CodexAgent(options),
  resolveCommand: resolveCodex,
  capabilities: CodexAgent.capabilities,
  supplier: { fetchModels: fetchSupplierModels, check: checkSupplier, catalog: readModelCatalog },
});

// Provider names are data, never module paths. Only implemented providers register here.
function getAgentProvider(id = "codex") {
  if (id !== "codex") throw new Error(`不支持的 CLI 执行器：${String(id)}`);
  return codex;
}

function createAgent({ provider = "codex", ...options } = {}) {
  return getAgentProvider(provider).create(options);
}

module.exports = { createAgent, getAgentProvider };
