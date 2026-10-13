const { McpStore } = require("../storage/mcp-store.cjs");
const { tokenInput, mcpId, assertMcpScope, mcpScopes } = require("../domain/mcp-access.cjs");
const { accountError } = require("../domain/account.cjs");
const { presentMcpToken, presentMcpIdentity, presentMcpProject } = require("./mcp-presenter.cjs");

class McpTokenServices {
  constructor(database, projects) { this.store = new McpStore(database); this.projects = projects; }
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
  async whoami(context) { return presentMcpIdentity(await this.refresh(context)); }
}
module.exports = { McpTokenServices };
