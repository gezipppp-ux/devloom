const { AgentSupplierStore } = require("../storage/agent-supplier-store.cjs");
const { getAgentProvider } = require("../agents/registry.cjs");
const { supplierAgent, supplierRevision, supplierUrl, validateSupplier, object } = require("../domain/agent-supplier.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentSupplier } = require("./agent-supplier-presenter.cjs");

class AgentSupplierServices {
  constructor(database, { accounts, changed = async () => {}, store, provider = getAgentProvider } = {}) {
    this.store = store || new AgentSupplierStore(database); this.accounts = accounts; this.changed = changed; this.provider = provider;
  }
  async authorize(actor, authorize) { await authorize?.(); await this.accounts.requireAdmin(actor); }
  async list(actor, agentType) {
    await this.authorize(actor); supplierAgent(agentType);
    return this.store.transaction(async () => {
      const current = await this.store.selection(agentType);
      return { suppliers: (await this.store.list(agentType)).map(presentSupplier), currentId: current.id, selectionRevision: current.selectionRevision };
    });
  }
  async save(actor, input, id, authorize) {
    await this.authorize(actor, authorize);
    const result = await this.store.transaction(async () => {
      const previous = id ? await this.store.read(id, true) : undefined;
      const value = validateSupplier(input, previous);
      if (previous && previous.revision !== input.revision) throw accountError("供应商配置已修改，请刷新后重试。", 409);
      await this.authorize(actor, authorize);
      return presentSupplier(await this.store.save(value, previous));
    });
    await this.changed(); return { supplier: result };
  }
  async activate(actor, id, input, authorize) {
    object(input, ["revision"]); supplierRevision(input.revision);
    await this.authorize(actor, authorize);
    await this.store.transaction(async () => { await this.authorize(actor, authorize); await this.store.activate(id, input.revision); });
    await this.changed(); return this.list(actor, "codex");
  }
  async remove(actor, id, input, authorize) {
    object(input, ["revision", "confirm"]); supplierRevision(input.revision);
    if (input.confirm !== true) throw accountError("请确认删除供应商。", 400);
    await this.authorize(actor, authorize);
    await this.store.transaction(async () => { await this.authorize(actor, authorize); await this.store.remove(id, input.revision); });
    await this.changed(); return { deleted: true };
  }
  async duplicate(actor, id) {
    await this.authorize(actor);
    const row = await this.store.read(id);
    if (row.mode !== "api-key") throw accountError("服务器现有配置无需复制。", 400);
    return { draft: { agentType: row.agentType, name: `${row.name.slice(0, 75)} 副本`, baseUrl: row.baseUrl, notes: row.notes,
      models: row.models, defaultModel: row.defaultModel, enabled: false } };
  }
  async request(actor, input, kind, authorize) {
    object(input, ["id", "revision", "agentType", "baseUrl", "apiKey", "model"]);
    await this.authorize(actor, authorize);
    const previous = input.id ? await this.store.read(input.id, true) : undefined;
    if (previous && (previous.mode !== "api-key" || supplierRevision(input.revision) !== previous.revision))
      throw accountError("供应商已变化，请刷新后重试。", 409);
    const agentType = supplierAgent(input.agentType ?? previous?.agentType);
    const apiKey = input.apiKey === undefined ? previous?.apiKey : input.apiKey;
    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 8192 || /[\x00-\x1f\x7f]/.test(apiKey)) throw accountError("请填写有效 API Key。", 400);
    const connection = { baseUrl: supplierUrl(input.baseUrl ?? previous?.baseUrl), apiKey: apiKey.trim(), model: input.model };
    if (kind === "check" && (typeof input.model !== "string" || !/^[^\s\x00-\x1f\x7f]{1,100}$/.test(input.model))) throw accountError("请选择检测模型。", 400);
    const adapter = this.provider(agentType).supplier;
    const result = kind === "models" ? { models: await adapter.fetchModels(connection) } : await adapter.check(connection);
    await this.authorize(actor, authorize);
    if (previous && (await this.store.read(previous.id)).revision !== previous.revision) throw accountError("检测期间配置已修改，结果已作废。", 409);
    return result;
  }
}
module.exports = { AgentSupplierServices };
