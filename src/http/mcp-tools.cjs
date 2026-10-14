const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");

const id = z.string().uuid(), requestId = id.describe("UUIDv4；重试必须沿用同一标识及相同参数。");
const page = { limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).max(100000).default(0) };
const text = z.string().max(60000);
const fields = {
  title: z.string().min(1).max(200).optional(), description: text.optional(), releaseId: id.nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  acceptanceCriteria: text.optional(), reproductionSteps: text.optional(), expectedResult: text.optional(), actualResult: text.optional(),
  reporterId: id.optional(), businessOwnerId: id.optional(), qaOwnerId: id.nullable().optional(), acceptanceOwnerId: id.nullable().optional(),
  severity: z.enum(["minor", "normal", "major", "critical"]).optional(), watcherIds: z.array(id).max(50).optional(),
  attachmentIds: z.array(id).max(20).optional().describe("先通过受鉴权 HTTP 上传；正文用 attachment:附件ID 引用。不可传本地路径或 base64。"),
};
const commands = [
  ["whoami", "验证当前 Token、身份、授权范围和 HTTP 上传规则。", {}, null],
  ["list_projects", "列出本人可访问且 Token 授权的项目；支持名称搜索和分页。", { ...page, query: z.string().max(200).optional() }, "listProjects"],
  ["list_releases", "查询项目的发布版本；省略 projectIds 查询全部授权且有事项查看权限的项目，遍历 nextOffset 获取所有结果。", {
    ...page, projectIds: z.array(id).min(1).max(100).optional(), status: z.enum(["active", "archived", "all"]).default("active"),
  }, "listReleases"],
  ["create_release", "新建发布版本；名称必须如 v1.2 或 v1.2.3；不允许后缀。", {
    projectId: id, requestId, name: z.string().max(100), description: z.string().max(4000).optional(),
  }, "createRelease", "releases.write"],
  ["list_project_members", "读取有效项目成员，用稳定用户 ID 指派；canAssign 表示可担任开发负责人。", {
    ...page, projectId: id, query: z.string().max(200).optional(), assignableOnly: z.boolean().default(false),
  }, "members"],
  ["search_issues", "发布前搜索同类事项避免重复；支持版本、类型和归档筛选。", {
    ...page, projectId: id, query: z.string().max(200).optional(), type: z.enum(["requirement", "bug"]).optional(),
    releaseId: z.union([id, z.literal("unassigned")]).optional(), includeArchived: z.boolean().default(false),
  }, "searchIssues"],
  ["get_issue", "读取事项、修订号、开发任务修订号、正式附件与网页链接。", { projectId: id, issueId: id }, "getIssue"],
  ["create_issue", "原子发布图文需求或 Bug，可指定一名开发负责人和多名关注人。指派只创建待开发任务，不启动 Agent。", {
    ...fields, projectId: id, requestId, type: z.enum(["requirement", "bug"]), title: z.string().min(1).max(200), developerId: id.optional(),
  }, "createIssue", "issues.write"],
  ["update_issue", "编辑事项及补充 HTTP 上传的图片。携带 get_issue 返回的 revision，冲突后重新读取。", {
    ...fields, projectId: id, issueId: id, requestId, revision: z.number().int().min(1),
  }, "updateIssue", "issues.write"],
  ["assign_issue", "指派或转派一名开发负责人，可设置多名关注人；已有任务须携带 taskRevision，仅未启动的独立事项任务可转派。", {
    projectId: id, issueId: id, requestId, revision: z.number().int().min(1), developerId: id,
    watcherIds: z.array(id).max(50).optional(), taskRevision: z.number().int().min(1).optional(),
  }, "assignIssue", "issues.assign"],
  ["get_request_result", "响应丢失后按原 requestId 查询本人已成功提交的写操作；未找到时可沿用原参数重试。", {
    projectId: id, requestId,
  }, "requestResult"],
];

function createMcpServer({ context, tokens, services, isBusy, origin }) {
  const server = new McpServer({ name: "web-coding", version: "1.0.0" }, {
    instructions: "先查询项目、版本和成员，发布前查重。所有写操作使用稳定 UUIDv4 requestId，超时查询原请求或原样重试。" +
      "图片从客户端通过 POST " + origin + "/api/mcp/projects/{projectId}/uploads?name=文件名 上传原始二进制；" +
      "请求头 Authorization: Bearer <Token>、Idempotency-Key: <UUIDv4>、Content-Type: image/png。" +
      "成功返回 attachmentId，传入 create_issue/update_issue 的 attachmentIds，并在正文写 ![说明](attachment:附件ID)。" +
      "仅 PNG/JPEG/WebP，单张 10 MiB，每次发布最多 20 张/20 MiB，暂存 24 小时。上传失败不能省略图片发布。" +
      "不读取服务端路径，不自动启动开发。返回的 url 为站内路径，站点地址为 " + origin + "。",
    maxToolInputElements: 1000,
  });
  for (const [name, description, shape, method, scope] of commands) {
    if (scope && !context.scopes.includes(scope)) continue;
    server.registerTool(name, { description, inputSchema: z.object(shape).strict(),
      annotations: { readOnlyHint: !scope, destructiveHint: Boolean(scope), idempotentHint: true, openWorldHint: false } }, async input => {
      try {
        if (scope && isBusy()) return toolError(409, "MAINTENANCE", "环境工具正在更新，请完成后重试。");
        const result = method ? await services[method](context, input) : await tokens.whoami(context);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return toolError(error.statusCode || 500, error.code || "MCP_OPERATION_FAILED",
          error.statusCode ? error.message : "操作未完成，请查询原请求或稍后使用相同标识重试。");
      }
    });
  }
  return server;
}
function toolError(status, code, message) {
  const result = { error: { status, code, message } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
}
module.exports = { createMcpServer };
