# MCP 接入、附件上传与 Skills

控制台入口为「个人设置 → MCP 接入」，默认展示连接地址和个人 Token 列表；「连接 Agent 与使用指南」提供客户端配置和上传指南。后端提供同源 /mcp 地址，使用官方 TypeScript SDK 的无状态 Streamable HTTP；只接受 POST，不创建持久 MCP 会话、不提供旧 SSE 传输。支持 HTTP MCP 的 Codex、Claude Code、Pi 可配置此地址。

接入概览集中展示客户端配置、最近两枚 Token 和附件上传入口；完整列表、权限详情和创建表单按需展开。创建页面保留 HTTP 上传说明，成功后独立显示一次完整 Token，返回其他视图或关闭时清除。Pi 的具体配置方式取决于所使用的 MCP 扩展，控制台只提供通用连接参数。

## 身份与权限

- 用户在已登录且完成初始改密的浏览器会话中创建、列出和撤销本人 Token，管理接口继续要求 Cookie 和 CSRF；Bearer Token 不能管理或增发个人 MCP Token。
- Token 明文仅创建时返回一次，数据库只保存随机令牌的 SHA-256 摘要、前缀、名称和授权信息。有效期为 1–365 天，默认 30 天。
- 请求使用 Authorization: Bearer <Token>；不接受 URL 中的 Token。MCP 请求使用个人 MCP Token，HTTP 上传仅使用 MCP 签发的临时上传 Token；读取请求体后再次检查；应用写事务再次验证账号、Token、项目权限和归档状态。
- 权限目录为 shared/mcp-scopes.json：read、issues.write、issues.assign、releases.write、files.upload。有效操作取 Token scope 与当前用户项目权限的交集。可限制指定项目，或明确授权全部当前及以后可访问项目。
- 撤销、过期、账号停用、强制改密或账号 authVersion 变化使 Token 失效。改名不失效；项目撤权在后续操作中生效。管理员现有项目管理特例继续适用，Token 不授予额外开发资格。
- /api/mcp/whoami 返回当前身份、Token 公共元数据及上传约定，适合验证配置；不返回凭据摘要。
- MCP 保留现有 Host/Origin 校验和 PUBLIC_ORIGIN HTTPS 部署规则。只对明确的 MCP/Bearer 路由免除浏览器 CSRF，其他 API 不接受此豁免。

## 工具

| 工具 | 用途 |
| --- | --- |
| whoami | 身份、授权和上传约定、Skills 地址 |
| create_upload_token | 为指定项目签发最长 24 小时有效的临时上传 Token；需要 files.upload |
| list_projects | 可访问项目，名称检索与分页 |
| list_releases | 指定项目或全部可访问且有事项查看权限项目的版本；status 为 active、archived、all |
| create_release | 新建版本，使用既有 v1.2 / v1.2.3 命名规则，可填写 targetDate |
| list_project_members | 有效成员及 canAssign；可筛选具备开发资格的负责人 |
| get_issue_workflow | 按 projectId、type 读取已发布系统流程及历史发布版本，不公开草稿；以 publishedVersion 选择当前新事项使用的 definition |
| search_issues / get_issue | 查重、详情、事项和开发任务修订号、附件与站内链接 |
| create_issue | 原子创建事项、绑定附件、设置职责、关注人和可选开发负责人 |
| update_issue | 带 revision 更新内容、版本、职责、关注人和追加附件 |
| assign_issue | 指派／转派负责人及设置关注人 |
| get_request_result | 响应丢失后读取本人原请求结果 |

列表默认每页 30 条，最多 100 条，按 nextOffset 继续。list_releases 省略 projectIds 时按权限遍历项目；显式提供不可访问项目时整次报错，不伪装为空列表。

create_issue / update_issue 字段与事项表单同步：title、description、releaseId、priority、acceptanceCriteria、reproductionSteps、expectedResult、actualResult、severity、dueDate、tags，以及下述职责和关注人。dueDate 接受有效 YYYY-MM-DD、null 或空字符串（清空）；tags 最多 12 项，每项最多 30 字，去首尾空白后非空并去重，更新替换整组。省略字段不改变已有值。type 仅创建时使用，developerId 仅创建或 assign_issue 使用；status、workflowVersionId、执行状态不接受直接赋值。create_release 的 targetDate 使用相同日历日期表达，不转换用户时区。

get_issue_workflow 复用 SystemWorkflowServices.readPublished，要求 Token read、项目范围及 issue.view，返回前重新鉴权。流程 requiredFields 在相应流转时生效；创建使用当前已发布版本和初始节点，带 developerId 时还需满足该节点的分派与流转门禁。MCP 不提供手动状态流转或启动开发工具；仅发布不会启动 Agent，分派也只创建待开发任务。

工具返回结构化 JSON 并同时提供 JSON 文本；可预期错误带 isError 和 error.status/code/message。Token 不具备某写 scope 时，不在工具列表中暴露对应工具；执行时仍重新验证，不能依赖工具列表作为授权。

## 受鉴权 HTTP 附件上传

客户端先调用 MCP `create_upload_token({projectId})`，取得 `uploadToken`、`uploadPath`、`expiresAt`。令牌仅允许该项目上传，可在有效期内复用；最长 24 小时，不晚于原 MCP Token 到期时间。原 Token 撤销、账号停用／改密或项目权限变化立即影响上传。申请无需 requestId，响应丢失可重新申请。数据库只保存随机令牌的 SHA-256 摘要、父 Token ID、项目及到期时间，后续签发时清理过期记录。

客户端再将附件保存为本地文件，使用临时 Token 上传原始二进制；MCP Token 不能直接上传，临时 Token 不能访问 MCP 或管理凭据。远程 MCP 不读取客户端路径。地址：

    POST /api/mcp/projects/:projectId/uploads?name=screenshot.png
    Authorization: Bearer <Token>
    Idempotency-Key: <UUIDv4>
    Content-Type: image/png

curl 示例（将工具返回的 uploadToken 放入临时环境变量 WEB_CODING_UPLOAD_TOKEN）：

    curl --fail-with-body --request POST \
      "https://your-host/api/mcp/projects/<PROJECT_ID>/uploads?name=screenshot.png" \
      --header "Authorization: Bearer $WEB_CODING_UPLOAD_TOKEN" \
      --header "Idempotency-Key: <UPLOAD_UUID>" \
      --header "Content-Type: image/png" \
      --data-binary "@screenshot.png"

Windows PowerShell：

    $uploadId = [guid]::NewGuid().ToString()
    $uploadHeaders = @{
      Authorization = "Bearer $env:WEB_CODING_UPLOAD_TOKEN"
      "Idempotency-Key" = $uploadId
    }
    $uploadUrl = "https://your-host/api/mcp/projects/<PROJECT_ID>/uploads?name=screenshot.png"
    Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHeaders -ContentType "image/png" -InFile ".\screenshot.png"

文件名需 URL 编码。成功响应包含 attachmentId、name、mimeType、size、sha256、expiresAt、issueId 和 markdown。未绑定时 issueId 为 null，markdown 示例：

    ![图片](attachment:xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx)

将 attachmentId 放入 create_issue / update_issue 的 attachmentIds，同时在 description、acceptanceCriteria、reproductionSteps、expectedResult 或 actualResult 中引用。发布时转换为现有 /api/projects/:projectId/files/:id 地址；正式附件继续经过账号与事项权限验证，不能作为公开图床。

- 接受图片、文本、PDF、Office 等附件；单文件 10 MiB，每次创建／编辑最多 20 个且合计不超过 20 MiB。上传响应的 Markdown 对实际图片使用图片引用，其他文件使用普通链接。每人有效暂存合计最多 100 MiB。
- 暂存 24 小时后禁止绑定，后续上传时清理过期 BLOB；保留少量元数据，避免旧上传标识被重新解释。成功绑定后清除暂存 BLOB，正式附件成为权威数据。
- 上传归属于账号和项目，不能引用其他账号／项目附件，也不能把已绑定附件用于另一个事项。绑定已有事项的本人附件可在该事项编辑中继续引用。
- 上传标识相同且文件、项目、名称和类型相同时复用结果；输入不同返回 409。网络失败用原标识和原文件重试；临时 Token 过期时重新签发并保留上传标识，暂存附件过期才生成新的上传标识。
- 上传权限还要求当前项目 issue.view 及 issue.create 或 issue.edit。在读取上传正文前、写事务内和提交前复核临时 Token、原 MCP Token、账号及项目权限；撤销 Token 或项目权限不能利用慢上传绕过。
- 附件失败时停止发布，不允许静默丢失资料。无需外部图床，不要求模型搬运 base64。

## Agent Skills 公开指南

`/skills` 和 `/skills/` 是无需登录、无需 JavaScript 的完整服务端 HTML 指南，开发与生产使用同一路由。`/skills/SKILL.md` 提供含 name/description frontmatter 的可安装技能；`Accept: text/markdown` 访问 `/skills` 同样返回 Markdown。`?lang=en` 提供英文内容。页面复用共享设计变量，提供下载与 Agent 安装提示词，MCP 接入页提供打开和复制指南链接。

内容按当前请求的已验证站点地址生成，完整介绍全部 13 个 MCP 工具的用途、参数、权限、结果和副作用，以及字段默认值与清空规则。发布流程为连接验证 → 项目／版本／流程／成员查询 → 查重 → 整理需求或 Bug 内容 → 临时 Token 与 HTTP 附件上传 → 带 requestId 原子提交 → get_issue 核验和返回链接；分别提供需求和 Bug 的完整示例，以及修订冲突和幂等恢复说明。中英文内容同步；回归对比实际 tools/list 与两种语言的工具／字段文档，并实际提交两类示例，防止字段漂移。指南不包含凭据或账号数据。Agent 需支持技能文件且能访问该地址；回环地址仅限本机 Agent，远程 Agent 使用可达部署地址。安装技能不触发业务发布。

## 发布、指派与重试

写工具必须提供稳定 UUIDv4 requestId；它独立于 JSON-RPC 请求 ID。服务端保存用户、项目、操作、规范化输入摘要与原始成功结果，相同请求返回 reused: true，换参数返回 409。相同用户不能把原标识用于另一个项目或操作。更新重试先检查原成功记录，再检查修订，避免已成功请求因旧 revision 再次报错。

事项、正式附件、暂存绑定、关注人、可选负责人及请求结果在同一个 PostgreSQL Serializable 短事务中提交。负责人无效或附件失败时全部回滚，保留有效暂存文件。新建版本也使用同一幂等机制。上传流位于事务外，不在事务中等待网络、Git 或 Agent。

人员字段明确使用 reporterId、businessOwnerId、qaOwnerId、acceptanceOwnerId、watcherIds。创建时 reporterId / businessOwnerId 默认当前账号，显式设置本人职责不额外要求分派权限；设置其他人、非空关注人或 developerId 需要 issues.assign scope 和 issue.assign 权限。update_issue 需要 issues.write scope，内容／附件变更要求 issue.edit，职责／关注人变更要求 issues.assign 和 issue.assign；仅修改人员时不要求 issue.edit，与 Web 服务一致。开发负责人使用 developerId，必须为当前有效且具备 session.start 的项目成员。沿用既有指派逻辑创建 planned 开发任务，不准备 Git、不创建 worktree、不启动 Agent。转派需要事项 revision 和开发任务 taskRevision，只允许未启动的任务；合并任务要求到控制台确认整体转派范围。

get_request_result 返回原操作的成功快照，get_issue 返回最新状态。找不到请求不表示可以换新标识重发，客户端应使用原参数和原标识重试。

## 模块与验证

- http/mcp-api.cjs 和 mcp-tools.cjs：HTTP/Bearer 协议、MCP 注册与参数 schema。
- application/mcp-token-services.cjs：Token 生命周期；mcp-project-services.cjs：查询、发布与幂等用例，复用现有项目、内容、版本和开发服务；mcp-presenter.cjs：公开结果。
- storage/mcp-store.cjs：Token 摘要、暂存 BLOB、操作结果与审计；domain/mcp-access.cjs：纯输入和 scope 规则。
- 迁移 20261013070000_mcp_access 追加三张表；20261015150000_mcp_upload_tokens 追加临时上传令牌表，不改写已有 MCP Token、附件、session/source/worktree。
- test/integration/mcp.test.cjs 使用独立 PostgreSQL 和官方 MCP 客户端，验证鉴权隔离、上传、发布、指派、幂等与回滚；浏览器用假数据验证 Token 创建、撤销和各宽度的上传说明。

部署先运行 npm run build 与 npm run db:deploy，再重启服务。测试不访问真实项目、不启动真实 Agent、不修改 TAPD。

临时上传令牌变更后，客户端必须先调用 create_upload_token；旧的直接使用 MCP Token 上传方式返回 401。仅更新前端不足以启用此功能，部署需执行新增迁移并重启后端。
