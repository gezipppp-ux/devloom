const { McpStore } = require("../storage/mcp-store.cjs");
const { tokenInput, mcpId, assertMcpScope, mcpScopes } = require("../domain/mcp-access.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentMcpToken, presentMcpIdentity, presentMcpProject, presentMcpUploadToken } = require("./mcp-presenter.cjs");
const { SkillPackageServices } = require("./skill-package-services.cjs");

class McpTokenServices {
  constructor(database, projects, skills = new SkillPackageServices()) { this.store = new McpStore(database); this.projects = projects; this.skills = skills; }
  async currentUser(actor) {
    const user = actor?.id && await this.store.user(actor.id);
    if (!user || user.status !== "active" || user.mustChangePassword) throw accountError("请先登录并完成密码修改。", 401);
    return user;
  }
  async list(actor) {
    const user = await this.currentUser(actor);
    const tokens = await this.store.tokens(actor.id);
    const projects = (await this.projects.list(actor)).projects.map(presentMcpProject);
    await this.currentUser(actor);
    return { tokens: tokens.map(token => presentMcpToken(token, user)), projects, scopes: mcpScopes };
  }
  async create(actor, input, authorize) {
    const data = tokenInput(input);
    return this.store.transaction(async () => {
      await authorize?.();
      const user = await this.currentUser(actor);
      for (const id of data.projectIds) await this.projects.authorize(id, actor, "project.view");
      const { token, secret } = await this.store.createToken(user, data);
      await this.store.audit(user.id, token.id, "token.created");
      return { token: presentMcpToken(token), secret };
    });
  }
  async revoke(actor, id, authorize) {
    return this.store.transaction(async () => {
      await authorize?.(); await this.currentUser(actor);
      await this.store.revoke(actor.id, mcpId(id, "Token ID"));
      await this.store.audit(actor.id, id, "token.revoked");
      return { ok: true };
    });
  }
  validate(token) {
    if (!token || token.revokedAt || token.expiresAt <= new Date() || token.user.status !== "active" ||
        token.user.mustChangePassword || token.authVersion !== token.user.authVersion)
      throw accountError("MCP Token 无效、已过期或已撤销。", 401, "MCP_TOKEN_INVALID");
    return token;
  }
  async authenticate(header) {
    if (typeof header !== "string" || !/^Bearer wc_mcp_[A-Za-z0-9_-]{43}$/.test(header))
      throw accountError("请通过 Authorization: Bearer 提供 MCP Token。", 401, "MCP_TOKEN_REQUIRED");
    const token = this.validate(await this.store.tokenBySecret(header.slice(7)));
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60000) await this.store.touch(token.id);
    return token;
  }
  async refresh(context, scope = "read", projectId) {
    const token = this.validate(await this.store.token(context.id));
    if (token.userId !== context.userId) throw accountError("MCP 身份已失效。", 401);
    assertMcpScope(token, scope, projectId);
    return token;
  }
  async uploadAccess(context, projectId) {
    const token = await this.refresh(context, "files.upload", projectId);
    const actor = { id: token.userId };
    const access = await this.projects.authorize(projectId, actor, "issue.view");
    await this.projects.authorize(projectId, actor, access.permissions.includes("issue.create") ? "issue.create" : "issue.edit");
    return token;
  }
  async createUploadToken(context, { projectId }, origin) {
    mcpId(projectId, "项目 ID");
    return this.store.transaction(async () => {
      const token = await this.uploadAccess(context, projectId);
      const { grant, secret } = await this.store.createUploadToken(token, projectId);
      await this.uploadAccess(context, projectId);
      await this.store.audit(token.userId, token.id, "upload_token.created", projectId);
      return presentMcpUploadToken(grant, secret, origin);
    });
  }
  validateUploadToken(grant, projectId) {
    if (!grant || grant.expiresAt <= new Date())
      throw accountError("临时上传 Token 无效或已过期，请通过 MCP 重新申请。", 401, "UPLOAD_TOKEN_INVALID");
    if (grant.projectId !== projectId) throw accountError("临时上传 Token 仅限指定项目使用。", 403, "UPLOAD_PROJECT_DENIED");
    return grant;
  }
  async authenticateUpload(header, projectId) {
    if (typeof header !== "string" || !/^Bearer wc_upload_[A-Za-z0-9_-]{43}$/.test(header))
      throw accountError("请通过 MCP create_upload_token 获取临时上传 Token，再使用 Authorization: Bearer 上传附件。", 401, "UPLOAD_TOKEN_REQUIRED");
    const grant = this.validateUploadToken(await this.store.uploadTokenBySecret(header.slice(7)), projectId);
    const token = this.validate(await this.store.token(grant.tokenId));
    const context = { id: token.id, userId: token.userId, uploadTokenId: grant.id };
    await this.refreshUpload(context, projectId);
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60000) await this.store.touch(token.id);
    return context;
  }
  async refreshUpload(context, projectId) {
    const grant = this.validateUploadToken(context.uploadTokenId && await this.store.uploadToken(context.uploadTokenId), projectId);
    if (grant.tokenId !== context.id) throw accountError("临时上传身份已失效。", 401, "UPLOAD_TOKEN_INVALID");
    return this.uploadAccess(context, projectId);
  }
  async whoami(context, origin) {
    const token = await this.refresh(context);
    const skills = await this.skills.describe(origin);
    await this.refresh(context);
    return presentMcpIdentity(token, origin, skills);
  }
}
module.exports = { McpTokenServices };
