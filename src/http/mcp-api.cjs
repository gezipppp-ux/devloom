const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createMcpServer } = require("./mcp-tools.cjs");
const { body, fileBody, json } = require("./messages.cjs");
const { accountError } = require("../domain/account.cjs");

function isMcpRequest(pathname) {
  return pathname === "/mcp" || pathname === "/api/mcp/whoami" ||
    /^\/api\/mcp\/projects\/[0-9a-f-]{36}\/uploads$/.test(pathname);
}
function registerMcpRoutes(instance, { tokens, services, isBusy }) {
  const authenticate = (upload = false) => async (request, reply) => {
    try {
      if ([...request.applicationUrl.searchParams.keys()].some(key => !["name"].includes(key)))
        throw accountError("MCP 请求不接受 URL 中的 Token 或其他未支持参数。", 400);
      request.mcpContext = upload
        ? await tokens.authenticateUpload(request.headers.authorization, request.params.projectId)
        : await tokens.authenticate(request.headers.authorization);
    } catch (error) {
      if (error.statusCode === 401) reply.header("www-authenticate", 'Bearer realm="web-coding-mcp"');
      return reply.code(error.statusCode || 500).send({ error: error.statusCode ? error.message : "认证服务暂时不可用。", code: error.code });
    }
  };
  instance.route({ method: ["POST", "GET", "DELETE"], url: "/mcp", onRequest: authenticate(),
    config: { rateLimit: { max: 180, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      if (request.method !== "POST") return reply.header("allow", "POST").code(405).send({ error: "此 MCP 服务使用无状态 Streamable HTTP POST。" });
      const input = await body(request.raw, 1024 * 1024);
      const context = await tokens.refresh(request.mcpContext);
      const server = createMcpServer({ context, tokens, services, isBusy, origin: request.applicationUrl.origin });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        await server.connect(transport);
        reply.hijack();
        reply.raw.setHeader("cache-control", "no-store");
        await transport.handleRequest(request.raw, reply.raw, input);
      } finally { await server.close(); }
    } });
  instance.get("/api/mcp/whoami", { onRequest: authenticate(), config: { rateLimit: { max: 180, timeWindow: "1 minute" } } },
    async request => tokens.whoami(request.mcpContext));
  instance.post("/api/mcp/projects/:projectId/uploads", {
    onRequest: authenticate(true), config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (isBusy()) throw accountError("环境工具正在更新，请完成后再上传。", 409);
    await tokens.refreshUpload(request.mcpContext, request.params.projectId);
    const data = await fileBody(request.raw);
    if (isBusy()) throw accountError("环境工具正在更新，请完成后再上传。", 409);
    const result = await services.upload(request.mcpContext, request.params.projectId, request.headers["idempotency-key"],
      { name: request.applicationUrl.searchParams.get("name"), mimeType: request.headers["content-type"], data });
    return reply.header("cache-control", "no-store").code(201).send(result);
  });
}
async function serveMcpAccount(request, response, url, { tokens, actor, input, authorize }) {
  if (url.pathname === "/api/account/mcp-tokens") {
    if (request.method === "GET") { json(response, 200, await tokens.list(actor)); return true; }
    if (request.method === "POST") { json(response, 201, await tokens.create(actor, input, authorize)); return true; }
  }
  const revoke = /^\/api\/account\/mcp-tokens\/([^/]+)\/revoke$/.exec(url.pathname);
  if (revoke && request.method === "POST") { json(response, 200, await tokens.revoke(actor, revoke[1], authorize)); return true; }
  return false;
}
module.exports = { isMcpRequest, registerMcpRoutes, serveMcpAccount };
