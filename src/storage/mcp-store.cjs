const { randomBytes, createHash } = require("node:crypto");
const { accountError } = require("../domain/account.cjs");
const { canonicalJson } = require("../domain/mcp-access.cjs");

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
class McpStore {
  constructor(database) { this.database = database; }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) {
      if (["P2002", "P2034"].includes(error.code)) throw accountError("操作冲突，请使用相同请求标识和参数重试。", 409, "MCP_CONFLICT");
      throw error;
    }
  }
  user(id) { return this.database.client.user.findUnique({ where: { id } }); }
  tokens(userId) { return this.database.client.mcpToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }); }
  token(id) { return this.database.client.mcpToken.findUnique({ where: { id }, include: { user: true } }); }
  tokenBySecret(secret) { return this.database.client.mcpToken.findUnique({ where: { tokenHash: digest(secret) }, include: { user: true } }); }
  async createToken(user, input) {
    const secret = "wc_mcp_" + randomBytes(32).toString("base64url");
    const { expiresInDays, ...data } = input;
    const token = await this.database.client.mcpToken.create({ data: { ...data, userId: user.id, authVersion: user.authVersion,
      tokenHash: digest(secret), prefix: secret.slice(0, 15), expiresAt: new Date(Date.now() + expiresInDays * 86400000) } });
    return { token, secret };
  }
  async revoke(userId, id) {
    const result = await this.database.client.mcpToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count && !await this.database.client.mcpToken.findFirst({ where: { id, userId } })) throw accountError("Token 不存在。", 404);
  }
  touch(id) { return this.database.client.mcpToken.updateMany({ where: { id, revokedAt: null }, data: { lastUsedAt: new Date() } }); }
  async upload(userId, projectId, id, file) {
    const sha256 = digest(file.data);
    const table = this.database.client.mcpUpload;
    // Remove expired BLOBs, retaining small metadata for immutable upload IDs.
    await table.updateMany({ where: { expiresAt: { lte: new Date() }, data: { not: null } }, data: { data: null } });
    const existing = await table.findUnique({ where: { id } });
    if (existing) {
      if (existing.userId !== userId || existing.projectId !== projectId || existing.name !== file.name ||
          existing.mimeType !== file.mimeType || existing.sha256 !== sha256)
        throw accountError("相同上传标识不能提交不同文件或项目。", 409);
      if (!existing.issueId && existing.expiresAt <= new Date()) throw accountError("暂存附件已过期，请用新的上传标识重新上传。", 410);
      return existing;
    }
    const pending = await table.aggregate({ where: { userId, issueId: null, expiresAt: { gt: new Date() } }, _sum: { size: true } });
    if ((pending._sum.size || 0) + file.data.length > 100 * 1024 * 1024) throw accountError("暂存图片合计不能超过 100 MiB，请先发布或等待过期。", 400);
    return table.create({ data: { id, userId, projectId, ...file, size: file.data.length, sha256, expiresAt: new Date(Date.now() + 86400000) } });
  }
  async attachments(userId, projectId, ids, issueId) {
    const files = [];
    for (const id of ids) {
      const row = await this.database.client.mcpUpload.findUnique({ where: { id } });
      if (!row || row.userId !== userId || row.projectId !== projectId) throw accountError("附件不存在或不属于当前账号和项目。", 404);
      if (row.issueId && row.issueId !== issueId) throw accountError("附件已用于其他事项，请重新上传。", 409);
      if (!row.issueId && (row.expiresAt <= new Date() || !row.data)) throw accountError("暂存附件已过期，请重新上传。", 410);
      if (row.issueId) {
        const saved = await this.database.client.projectFile.findFirst({ where: { id, projectId, issueId, authorId: userId } });
        if (!saved) throw accountError("已绑定附件不存在。", 404);
        files.push({ id, name: saved.name, mimeType: saved.mimeType, data: Buffer.from(saved.data) });
      } else files.push({ id, name: row.name, mimeType: row.mimeType, data: Buffer.from(row.data) });
    }
    if (files.reduce((size, file) => size + file.data.length, 0) > 20 * 1024 * 1024) throw accountError("本次附件合计不能超过 20 MiB。", 400);
    return files;
  }
  async bind(ids, issueId) {
    if (ids.length) await this.database.client.mcpUpload.updateMany({ where: { id: { in: ids } }, data: { issueId, data: null } });
  }
  operation(userId, requestId) { return this.database.client.mcpOperation.findUnique({ where: { userId_requestId: { userId, requestId } } }); }
  hash(input) { return digest(JSON.stringify(canonicalJson(input))); }
  saveOperation(data) { return this.database.client.mcpOperation.create({ data: { ...data, result: JSON.parse(JSON.stringify(data.result)) } }); }
  audit(userId, tokenId, event, projectId, requestId) {
    return this.database.client.auditEvent.create({ data: { actorUserId: userId, event: "mcp." + event, details: { tokenId, projectId, requestId } } });
  }
}
module.exports = { McpStore };
