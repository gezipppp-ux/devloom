const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const { ISSUE_TYPES, PRIORITIES, SEVERITIES } = require("../domain/project-issues.cjs");
const { releaseNameRules } = require("../domain/project-releases.cjs");

const id = z.string().uuid(), requestId = id.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).describe("UUIDv4；重试必须沿用同一标识及相同参数。");
const page = { limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).max(100000).default(0) };
const text = z.string().max(60000);
const date = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/).nullable().optional().describe("有效日历日期 YYYY-MM-DD，无时区转换；null 或空字符串表示清空，省略表示保留。");
const fields = {
  title: z.string().min(1).max(200).optional(), description: text.optional(), releaseId: id.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(), dueDate: date,
  tags: z.array(z.string().min(1).max(30)).max(12).optional().describe("最多 12 个标签，每项最多 30 字；去除首尾空白后去重；空数组清空，省略保留。"),
  acceptanceCriteria: text.optional(), reproductionSteps: text.optional(), expectedResult: text.optional(), actualResult: text.optional(),
  reporterId: id.optional(), businessOwnerId: id.optional(), qaOwnerId: id.nullable().optional(), acceptanceOwnerId: id.nullable().optional(),
  severity: z.enum(SEVERITIES).optional(), watcherIds: z.array(id).max(50).optional(),
  attachmentIds: z.array(id).max(20).optional().describe("先通过受鉴权 HTTP 上传；正文用 attachment:附件ID 引用。不可传本地路径或 base64。"),
};
const commands = [
  ["whoami", "验证当前 Token、身份、授权范围和 HTTP 上传规则；runtime 返回当前站点与 MCP 地址，skills 返回技能版本、安装清单和完整包地址。", {}, null],
  ["create_upload_token", "为指定项目签发仅用于 HTTP 附件上传的临时 Token，最长 24 小时且不晚于 MCP Token 到期时间。不能用于 MCP 调用；到期后重新申请。", {
    projectId: id,
  }, null, "files.upload"],
  ["list_projects", "列出本人可访问且 Token 授权的项目；支持名称搜索和分页。", { ...page, query: z.string().max(200).optional() }, "listProjects"],
  ["list_releases", "查询项目的发布版本；省略 projectIds 查询全部授权且有事项查看权限的项目，遍历 nextOffset 获取所有结果。", {
    ...page, projectIds: z.array(id).min(1).max(100).optional(), status: z.enum(["active", "archived", "all"]).default("active"),
  }, "listReleases"],
  ["create_release", "新建发布版本；名称必须如 v1.2 或 v1.2.3；不允许后缀。", {
    projectId: id, requestId, name: z.string().max(releaseNameRules.maxLength).regex(new RegExp("^(?:" + releaseNameRules.pattern + ")$")), description: z.string().max(4000).optional(), targetDate: date,
  }, "createRelease", "releases.write"],
  ["list_project_members", "读取有效项目成员，用稳定用户 ID 指派；canAssign 表示可担任开发负责人。", {
    ...page, projectId: id, query: z.string().max(200).optional(), assignableOnly: z.boolean().default(false),
  }, "members"],
  ["get_issue_workflow", "读取需求或 Bug 的已发布系统流程：按 publishedVersion 选择 definition，了解初始节点、分派限制及流转必填字段。不包含草稿；既有事项仍绑定创建时的流程版本。", {
    projectId: id, type: z.enum(ISSUE_TYPES),
  }, "getIssueWorkflow"],
  ["search_issues", "发布前搜索同类事项避免重复；支持版本、类型和归档筛选。", {
    ...page, projectId: id, query: z.string().max(200).optional(), type: z.enum(ISSUE_TYPES).optional(),
    releaseId: z.union([id, z.literal("unassigned")]).optional(), includeArchived: z.boolean().default(false),
  }, "searchIssues"],
  ["get_issue", "读取事项、修订号、开发任务修订号、正式附件与网页链接。", { projectId: id, issueId: id }, "getIssue"],
  ["create_issue", "原子发布包含正文与附件的需求或 Bug，可指定一名开发负责人和多名关注人。指派只创建待开发任务，不启动 Agent。", {
    ...fields, projectId: id, requestId, type: z.enum(ISSUE_TYPES), title: z.string().min(1).max(200), developerId: id.optional(),
  }, "createIssue", "issues.write"],
  ["update_issue", "编辑事项及补充 HTTP 上传的附件。携带 get_issue 返回的 revision，冲突后重新读取。", {
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
  const server = new McpServer({ name: "devloom", version: "1.0.0" }, {
    instructions: "先查询项目、版本、成员和 get_issue_workflow 已发布流程，发布前查重。事项支持截止日期 dueDate、标签 tags，版本支持目标日期 targetDate。发布及编辑使用稳定 UUIDv4 requestId，超时查询原请求或原样重试。" +
      "附件上传前调用 create_upload_token({projectId}) 获取最长 24 小时有效的临时上传 Token；MCP Token 不能直接上传。" +
      "使用 create_upload_token 返回的 uploadUrl 添加 name 查询参数，POST 原始二进制；地址须与 whoami.runtime.siteOrigin 同源。" +
      "请求头 Authorization: Bearer <uploadToken>、Idempotency-Key: <UUIDv4>、Content-Type 为文件实际 MIME 类型，未知用 application/octet-stream。" +
      "成功返回 attachmentId 和 markdown；ID 传入 create_issue/update_issue 的 attachmentIds，markdown 放入正文。图片用 ![说明](attachment:附件ID)，普通文件用 [说明](attachment:附件ID)。" +
      "支持图片及普通文件，单个 10 MiB，每次发布最多 20 个/20 MiB，暂存 24 小时。PNG/JPEG/WebP 在开发时作为图片输入，其他文件通过提示词中的本地路径读取。上传失败不能省略附件发布。" +
      "上传参数不接受文件路径，不自动启动开发。通过 whoami.skills 获取技能清单和完整包，安装 web-coding-issue-authoring；事项的相对 url 以 whoami.runtime.siteOrigin 解析。",
    maxToolInputElements: 1000,
  });
  for (const [name, description, shape, method, scope] of commands) {
    if (scope && !context.scopes.includes(scope)) continue;
    server.registerTool(name, { description, inputSchema: z.object(shape).strict(),
      annotations: { readOnlyHint: !scope, destructiveHint: Boolean(scope) && name !== "create_upload_token", idempotentHint: name !== "create_upload_token", openWorldHint: false } }, async input => {
      try {
        if (scope && isBusy()) return toolError(409, "MAINTENANCE", "环境工具正在更新，请完成后重试。");
        const result = name === "create_upload_token" ? await tokens.createUploadToken(context, input, origin)
          : method ? await services[method](context, input) : await tokens.whoami(context, origin);
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
