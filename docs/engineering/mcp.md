# MCP 接入、附件上传与 Skills

控制台入口为「个人设置 → MCP 接入」，默认展示连接地址和个人 Token 列表；「连接 Agent 与使用指南」提供客户端配置和上传指南。后端提供同源 /mcp 地址，使用官方 TypeScript SDK 的无状态 Streamable HTTP；只接受 POST，不创建持久 MCP 会话、不提供旧 SSE 传输。支持 HTTP MCP 的 Codex、Claude Code、Pi 可配置此地址。

接入概览集中展示连接地址、最近两枚 Token 和 Skills 指南；完整列表、权限详情和创建表单按需展开。创建表单只保留名称、有效期、操作权限和项目范围，HTTP 上传说明放在使用指南中。创建成功采用已选定的 [B 方案](../prototypes/mcp-token-setup/index.html?view=b)：左侧显示复制、发送、查看结果三步，右侧显示真实 Token 名称、完整凭据、项目范围与带时区的到期时间，提供一键复制及可展开的完整配置提示词。复制成功只推进到发送步骤，不推断已连接或已设置提醒。Pi 的具体配置方式取决于所使用的 MCP 扩展，控制台只提供通用连接参数。

复制内容在浏览器内生成，包含当前站点的 Skills 来源、MCP 地址、创建响应中的 secret 与 token.expiresAt（保留 ISO 8601 时区）、安装／更新及连接验证步骤、到期提醒要求。提示词要求 Agent 保存到客户端凭据配置或环境变量，不复述凭据、不写入项目／Skills／日志／提醒。页面不持久化完整凭据或提示词，返回、收起或卸载时清除内存，列表刷新不替换创建结果；语言切换保留同一 Token；技能与配置提示词当前只提供中文，复制失败展开文本供手动复制。通用指南和公开 Skills 不含实际 Token。

提醒由接收提示词的 Agent 执行：每次使用前检查，剩余不足 7 天时提醒，过期停止业务调用；客户端支持且用户请求时在到期前 3 天安排一次，已进入该时间段则当场提醒，不支持调度则明确只能在使用时提醒。连接后以 whoami.token.expiresAt 为准，不把复制或保存配置当作连接验证成功。DevLoom 不新增定时任务或代替 Agent 设置提醒。

## 身份与权限

- 用户在已登录且完成初始改密的浏览器会话中创建、列出和撤销本人 Token，管理接口继续要求 Cookie 和 CSRF；Bearer Token 不能管理或增发个人 MCP Token。
- Token 明文仅创建时返回一次，数据库只保存随机令牌的 SHA-256 摘要、前缀、名称和授权信息。有效期为 1–365 天，默认 30 天。
- 请求使用 Authorization: Bearer <Token>；不接受 URL 中的 Token。MCP 请求使用个人 MCP Token，HTTP 上传仅使用 MCP 签发的临时上传 Token；读取请求体后再次检查；应用写事务再次验证账号、Token、项目权限和归档状态。
- 权限目录为 shared/mcp-scopes.json：read、issues.write、issues.delete、issues.assign、releases.write、files.upload。有效操作取 Token scope 与当前用户项目权限的交集。可限制指定项目，或明确授权全部当前及以后可访问项目。删除使用独立的 issues.delete，既有 Token 不自动扩权，新建 Token 表单默认不选删除权限。
- 撤销、过期、账号停用、强制改密或账号 authVersion 变化使 Token 失效。改名不失效；项目撤权在后续操作中生效。管理员现有项目管理特例继续适用，Token 不授予额外开发资格。
- /api/mcp/whoami 与 MCP whoami 返回当前身份、Token 公共元数据、上传约定、runtime.siteOrigin/mcpUrl 和 skills（name、version、guideUrl、manifestUrl、entryUrl、packageUrl）。地址来自经过验证的 request.applicationUrl.origin；不返回凭据摘要。
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
| delete_issue | 带 revision 删除无任何开发任务或交付关联的需求/Bug；要求 issues.delete 与项目 issue.delete |
| assign_issue | 指派／转派负责人及设置关注人 |
| get_request_result | 响应丢失后读取本人原请求结果 |

列表默认每页 30 条，最多 100 条，按 nextOffset 继续。list_releases 省略 projectIds 时按权限遍历项目；显式提供不可访问项目时整次报错，不伪装为空列表。

create_issue / update_issue 字段与事项表单同步：title、description、releaseId、priority、acceptanceCriteria、reproductionSteps、expectedResult、actualResult、severity、dueDate、tags，以及下述职责和关注人。acceptanceCriteria 为非空字符串组成的数组，顺序即展示与验收顺序，总计最多 60000 字；更新替换整组，空数组清空。dueDate 接受有效 YYYY-MM-DD、null 或空字符串（清空）；tags 最多 12 项，每项最多 30 字，去首尾空白后非空并去重，更新替换整组。创建时必须提供业务负责人、测试负责人和业务验收人；更新时三项职责不得清空，历史事项缺失时须先补齐。省略字段不改变已有值。type 仅创建时使用，developerId 仅创建或 assign_issue 使用；status、workflowVersionId、执行状态不接受直接赋值。create_release 的 targetDate 使用相同日历日期表达，不转换用户时区。

get_issue_workflow 复用 SystemWorkflowServices.readPublished，要求 Token read、项目范围及 issue.view，返回前重新鉴权。流程 requiredFields 在相应流转时生效；创建使用当前已发布版本和初始节点，带 developerId 时还需满足该节点的分派与流转门禁。MCP 不提供手动状态流转或启动开发工具；仅发布不会启动 Agent，分派也只创建待开发任务。

工具返回结构化 JSON 并同时提供 JSON 文本；可预期错误带 isError 和 error.status/code/message。Token 不具备某写 scope 时，不在工具列表中暴露对应工具；执行时仍重新验证，不能依赖工具列表作为授权。

`delete_issue({projectId,issueId,requestId,revision})` 复用网页的逻辑删除服务，在同一 Serializable 事务中校验当前 Token、项目权限、归档、修订和所有历史任务/交付关联，并保存幂等结果与 MCP 审计。参数严格校验，不支持强制删除或批量删除。成功返回 `{id,deleted:true,reused:false}`；同一账号使用相同 requestId 和全部原参数重试返回 `reused:true`，不同参数返回 409；更换 requestId 删除已删除事项返回 404。重试仍要求当前删除权限；不会再次删除、递增修订或重复记录审计。

删除的 `get_request_result` 同样要求 issues.delete、issue.view 和 issue.delete，只返回删除回执，不读取或泄露已删除正文。其他创建、编辑或指派请求仍不得回放已删除事项内容。Agent 必须先核对目标和 get_issue 返回的 revision，只在用户明确授权的对象范围内调用；修订冲突后重新核对变更，不能盲目覆盖。新增 MCP scope 不需要数据库迁移；旧 Token 需重新创建并明确勾选「删除需求与 Bug」。

## 受鉴权 HTTP 附件上传

客户端先调用 MCP `create_upload_token({projectId})`，取得 `uploadToken`、`uploadUrl`、`uploadPath`、`expiresAt`；使用同源的 `uploadUrl` 上传，不在技能中拼固定地址。令牌仅允许该项目上传，可在有效期内复用；最长 24 小时，不晚于原 MCP Token 到期时间。原 Token 撤销、账号停用／改密或项目权限变化立即影响上传。申请无需 requestId，响应丢失可重新申请。数据库只保存随机令牌的 SHA-256 摘要、父 Token ID、项目及到期时间，后续签发时清理过期记录。

客户端再将附件保存为本地文件，使用临时 Token 上传原始二进制；MCP Token 不能直接上传，临时 Token 不能访问 MCP 或管理凭据。远程 MCP 不读取客户端路径。地址：

    POST /api/mcp/projects/:projectId/uploads?name=screenshot.png
    Authorization: Bearer <Token>
    Idempotency-Key: <UUIDv4>
    Content-Type: image/png

curl 示例（将工具返回的 uploadToken 放入临时环境变量 DEVLOOM_UPLOAD_TOKEN）：

    curl --fail-with-body --request POST \
      "https://your-host/api/mcp/projects/<PROJECT_ID>/uploads?name=screenshot.png" \
      --header "Authorization: Bearer $DEVLOOM_UPLOAD_TOKEN" \
      --header "Idempotency-Key: <UPLOAD_UUID>" \
      --header "Content-Type: image/png" \
      --data-binary "@screenshot.png"

Windows PowerShell：

    $uploadId = [guid]::NewGuid().ToString()
    $uploadHeaders = @{
      Authorization = "Bearer $env:DEVLOOM_UPLOAD_TOKEN"
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

## 需求与 Bug 提报技能

`list_project_members` 返回成员的 `effectivePermissions`；`get_issue_workflow` 的每个流程版本以及 `get_issue` 的事项返回 `responsibilityPermissions`，供测试负责人和业务验收人选择。创建或更换这两项职责时，服务端依据绑定流程和当前有效权限校验；未更换的历史职责不会因编辑其他字段被自动改写。

唯一发布的技能为 `web-coding-issue-authoring`，资源位于 `resources/skills/web-coding-issue-authoring/`。入口、references、agents 和 scripts 使用同一个版本，`SKILL.md` 的 `metadata.version` 是版本唯一来源。文件变化必须递增版本；发布后重启服务，不能原地改写已发布版本。技能与安装提示只提供中文，不维护英文副本。

`/skills` 与 `/skills/` 提供无需登录、无需 JavaScript 的 HTML 指南，页面由同一份入口 Markdown 渲染，引用链接指向同一发布版本的文件。`Accept: text/markdown` 返回入口内容，仅用于阅读，不作为单文件安装包。公开路由为：

- `/skills/web-coding-issue-authoring/manifest.json`：最新清单，`Cache-Control: no-cache`。
- `/skills/web-coding-issue-authoring/releases/:version/:digest/package.zip`：完整 ZIP，包含顶层技能目录。
- 同一版本路径下的 `SKILL.md`、`references/*`、`agents/openai.yaml`、`scripts/update-skill.cjs`：发布包白名单内的文件。

旧单文件发布器、`/skills/SKILL.md` 及旧技能安装方式已移除，不提供迁移、重定向或名称兼容。未识别的 `/skills/*` 返回 404，不落入 SPA。

清单包含 schemaVersion、名称、版本、入口/包地址、包大小和 SHA-256，以及每个文件的 path、size、sha256、url。服务实例读取一次完整资源快照；版本与包哈希共同构成不可变 URL，未知版本或文件返回 404。包内不含部署地址、账号信息或凭据，两个部署发布同一内容时 ZIP 哈希相同。服务端仅发布当前快照，部署切换导致旧快照文件不可用时，客户端保留安装版本并重新读取清单，不拼接不同版本。

首次连接必须提供可达的 MCP 地址或安装清单地址。已连接时使用 `whoami.runtime` 和 `whoami.skills`，上传使用 `create_upload_token.uploadUrl`；事项相对链接以当前 runtime.siteOrigin 解析。公开域名继续遵循 PUBLIC_ORIGIN 与可信本机代理校验，不信任任意 Host 或转发头。

安装提示要求先无凭据下载清单，再验证并运行清单中的独立更新脚本。脚本仅需 Node.js 22.13+，无额外依赖；自动安装逐个下载固定版本文件，校验大小与 SHA-256、名称/版本及相对引用，再切换完整目录。安装记录 `.installation.json` 由程序生成，含来源、版本和文件哈希，不含凭据。ZIP 供手动下载与查看，单独解压不等于建立更新记录。

每轮使用检查一次；数值比较版本，相同版本不写、远端更旧不降级、同版本内容变化报错。已安装文件的人工修改、增删或来源变化会中止更新并保留内容。更新使用同级锁与临时目录，下载和校验完成后再次检查本地文件，切换失败恢复原目录；程序不覆盖客户端凭据或其他技能。失败时保留原版本，允许查询和草稿，暂缓业务写操作。进程意外终止留下锁/备份时先核实并恢复，不自动删除。更新依赖客户端网络、运行时和写权限，没有后台更新任务。

内容门禁为：页面需求逐项对应已查看的目标原型或合格示意图及相关状态。Agent 按复杂度选择表达方式：简单的字段删除、新增输入框可用明确增删对象、位置与结果的局部示意图；复杂布局、流程或状态须有对应目标原型，未经处理的现状截图或只圈出待改区域不算合格。可根据现状截图和描述按需生成多个方案供用户选择、调整并确认；用户明确委托的设计选择由 Agent 定稿，简单改动和已有合格图稿不强制多版。需求分支有判定依据、确定动作和客观验收，失败处理与数值口径不能用概括句代替；Bug 的 description、reproductionSteps、expectedResult、actualResult 独立完整，截图可选。提交同时检查附件绑定和正文 Markdown 图片/文件引用，回读确认正式地址及外层语法，裸路径不能当作预览。前端预览与 Agent 文件输入是独立链路；变更解析或分发时须用隔离夹具验证图片输入、普通文件执行端本地路径和失败行为，不启动真实需求验证。仅在用户授权范围内提交，先展示可审阅完整内容；已有对同一份完整内容的授权不重复索取，选定原型或委托设计本身不等于授权发布。以上门禁由 Agent 执行，不代表 MCP 服务端已增加强制内容校验。

职责：storage/skill-package-store.cjs 读取资源、验证引用并打包；application/skill-package-services.cjs 持有发布快照，skill-package-presenter.cjs 生成公开地址与清单；http/skills-page.cjs 适配公开路由和 HTML。回归覆盖完整下载、引用、不同部署/代理地址、旧路由移除、更新失败恢复与本地修改保护；MCP 测试在隔离 PostgreSQL 验证身份发现和需求/Bug 字段往返。
