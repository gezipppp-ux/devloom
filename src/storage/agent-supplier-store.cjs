const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { accountError } = require("../domain/account.cjs");
const { encodeSecret, decodeSecret } = require("./database-secrets.cjs");

class AgentSupplierStore {
  constructor(database) { this.database = database; }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) {
      if (error.code === "P2002") throw accountError("同一 Agent 下已存在同名供应商。", 409);
      if (["P2034", "P2003", "P2025"].includes(error.code)) throw accountError("供应商配置发生变化，请刷新后重试。", 409);
      throw error;
    }
  }
  async list(agentType) { return this.database.client.agentSupplier.findMany({ where: { agentType }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }); }
  async read(id, secret = false) {
    const row = await this.database.client.agentSupplier.findUnique({ where: { id } });
    if (!row) throw accountError("供应商不存在。", 404);
    return secret && row.credentials ? { ...row, ...decodeSecret(row.credentials, this.database.encryptionKey) } : row;
  }
  async selection(agentType = "codex", secret = false) {
    const selection = await this.database.client.agentSupplierSelection.findUnique({ where: { agentType } });
    if (!selection) throw accountError("Agent 尚未配置默认供应商。", 409);
    const supplier = await this.read(selection.supplierId, secret);
    if (!supplier.enabled || supplier.agentType !== agentType) throw accountError("当前供应商不可用，请联系管理员。", 409);
    return { ...supplier, selectionRevision: selection.revision };
  }
  async save(value, previous) {
    return this.transaction(async () => {
      const { apiKey, ...data } = value;
      data.credentials = encodeSecret({ apiKey }, this.database.encryptionKey);
      if (!previous) return this.database.client.agentSupplier.create({ data: { ...data, id: randomUUID() } });
      if (previous.mode !== "api-key") throw accountError("服务器现有配置由服务账号维护。", 400);
      if (!value.enabled && await this.database.client.agentSupplierSelection.count({ where: { supplierId: previous.id } }))
        throw accountError("请先切换默认供应商，再停用此配置。", 409);
      const changed = ["baseUrl", "apiKey", "defaultModel", "models"].some(key => !isDeepStrictEqual(value[key], previous[key]));
      const updated = await this.database.client.agentSupplier.updateMany({ where: { id: previous.id, revision: previous.revision },
        data: { ...data, revision: { increment: 1 }, ...(changed ? { runtimeRevision: { increment: 1 } } : {}) } });
      if (!updated.count) throw accountError("供应商配置已修改，请刷新后重试。", 409);
      return this.read(previous.id);
    });
  }
  async activate(id, revision) {
    return this.transaction(async () => {
      const supplier = await this.read(id);
      if (!supplier.enabled) throw accountError("请先启用供应商。", 409);
      const result = await this.database.client.agentSupplierSelection.updateMany({ where: { agentType: supplier.agentType, revision },
        data: { supplierId: id, revision: { increment: 1 } } });
      if (!result.count) throw accountError("默认供应商已变化，请刷新后重试。", 409);
      return this.selection(supplier.agentType);
    });
  }
  async remove(id, revision) {
    return this.transaction(async () => {
      const row = await this.read(id);
      if (row.mode === "server-config") throw accountError("不能删除服务器现有配置。", 409);
      if (await this.database.client.agentSupplierSelection.count({ where: { supplierId: id } })) throw accountError("请先切换默认供应商，再删除此配置。", 409);
      if (await this.database.client.agentSupplierUse.count({ where: { supplierId: id, status: { not: "idle" } } }))
        throw accountError("仍有运行、待交互或状态未确认的轮次使用此供应商，请先处理原会话。", 409);
      if (!(await this.database.client.agentSupplier.deleteMany({ where: { id, revision } })).count) throw accountError("供应商配置已修改，请刷新后重试。", 409);
    });
  }
  async reserve(workspaceId, runKey, supplier) {
    return this.transaction(async () => {
      const current = await this.selection(supplier.agentType);
      if (current.id !== supplier.id || current.runtimeRevision !== supplier.runtimeRevision || current.selectionRevision !== supplier.selectionRevision)
        throw accountError("供应商在启动准备期间已切换，请重新发送。", 409);
      const token = randomUUID();
      await this.database.client.agentSupplierUse.upsert({ where: { workspaceId_runKey: { workspaceId, runKey } },
        create: { workspaceId, runKey, supplierId: supplier.id, token, status: "reserved" },
        update: { supplierId: supplier.id, token, status: "reserved" } });
      return token;
    });
  }
  async mark(workspaceId, runKey, token, status) {
    if (!token) return;
    await this.database.client.agentSupplierUse.updateMany({ where: { workspaceId, runKey, token }, data: { status } });
  }
}
module.exports = { AgentSupplierStore };
