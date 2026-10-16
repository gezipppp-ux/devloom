# MCP 发布说明

本说明依据 2026-10-15 的 DevLoom MCP 契约与工具 schema 编写。实际工具、权限和约束以当前连接返回结果为准；不为不存在的接口编造参数。

## 连接与资料来源

- 当前站点和 MCP 地址分别取当前连接 `whoami` 返回的 `runtime.siteOrigin`、`runtime.mcpUrl`；不得使用固定 IP、从项目名称猜地址或混用另一个实例的返回值。首次配置使用用户提供的 MCP 地址；多个连接无法确定时请用户选择。
- 控制台“个人设置 → MCP 接入”创建个人 Token。使用支持 Streamable HTTP 的客户端，配置 `Authorization: Bearer <MCP_TOKEN>`；只接受 POST，无持久会话或旧 SSE。
- 按 [安装与更新](updating.md) 通过 `whoami.skills.manifestUrl` 核对本技能的完整版本；本文件随技能包一起发布，不依赖另一份基础技能。工具参数以当前客户端暴露的 schema 为准，上传限制以 `whoami.upload` 为准。来源或版本无法核实时保留技能与草稿，继续只读查询，暂缓提交。
- 调用 `whoami` 并查看客户端暴露的工具及 schema；`tools/list` 是 MCP 协议方法，不是另一个叫 `tools/list` 的业务工具。客户端已提供工具定义时直接检查，不臆造工具调用。
- 真实 Token 只留在客户端凭据配置或必要的临时进程变量中，不能写入 skill、事项、URL、日志或聊天输出。
- 每次使用检查 `whoami.token.expiresAt`，剩余不足 7 天时提醒更新；已过期停止业务调用。用户要求且客户端支持时，在到期前 3 天安排一次提醒，已进入该时间段则当场提醒。提醒只包含站点、到期时间和设置入口，不含 Token；不支持调度时如实说明。

所有工具需要 `read`；创建需 `issues.write` 及项目 `issue.create`；上传凭据需 `files.upload` 及项目 `issue.view`、`issue.create` 或 `issue.edit`；指派需 `issues.assign` 及项目 `issue.assign`。有效权限是 Token 与当前账号项目权限的交集，不由“产品 / 运营 / 研发”称谓决定。

## 先查询后发布

| 顺序 | 工具和参数 | 使用结果 |
| --- | --- | --- |
| 1 | `whoami({})` | 确认当前账号、Token scope、项目范围和上传约定 |
| 2 | `list_projects({query})` | 取得真实 projectId；同名项目须核对，不能取第一个就提交 |
| 3 | `list_releases({projectIds:[projectId],status:"active"})` | 只关联本项目 active 版本；没有指定版本可不关联 |
| 4 | `list_project_members({projectId})` | 解析职责、关注人和用户明确指定的开发负责人；ID 不能用姓名代替 |
| 5 | `get_issue_workflow({projectId,type})` | 读取相应类型当前已发布流程 |
| 6 | `search_issues({projectId,type,query,includeArchived:true})` | 用对象、动作、异常等关键词查重，必要时多组搜索，避免因版本筛选漏掉旧事项 |
| 7 | `get_issue({projectId,issueId})` | 核实相似事项的正文、状态、版本与附件，判断重复或独立范围 |

分页以 `nextOffset` 为准；非 null 时作为下一次 `offset`，不凭本页条数判定已经查全。默认每页 30，`limit` 最大 100。搜索没有命中时如实说“当前查询未找到”，不承诺系统绝对没有重复。

没有指定版本可以不关联；用户明确要求的版本不存在时先说明，不擅自换版本。只有用户要求新建版本时才用 `create_release`，需要 `releases.write` 和 `release.manage`，名称如 `v1.2` 或 `v1.2.3`；新建版本也需要独立稳定的 UUIDv4 `requestId`。

## 流程门禁与人员

从 `workflow.versions` 找到 `version === workflow.publishedVersion` 的 `definition`，检查初始节点 `kind: initial`、`allowAssignment`、`allowDevelopment` 和相关 `transitions[].requiredFields`、职责及交付门禁。

- `requiredFields` 在相应流转时检查，不是要求创建时把未来交付材料全部填完。本技能的内容门禁独立执行，接口字段可省略不代表本技能可以省略。
- 既有事项绑定创建时的流程版本，更新时不能用最新流程替代原绑定版本。
- `reporterId`、`businessOwnerId` 默认当前账号；`qaOwnerId`、`acceptanceOwnerId` 默认未指定。开发负责人用 `developerId`，必须为有效且 `canAssign: true` 的成员，其他职责不要求具备开发资格。
- 设置他人职责、非空关注人或开发负责人需要额外指派权限。不要为了通过权限校验把用户指定的人换成当前账号。
- 仅在用户要求且初始节点及相关门禁允许时，创建参数才携带 `developerId`；否则正常创建未指派事项。用户要求的指派被拒绝时说明具体门禁，不自行删掉指派要求重发。
- MCP 不提供手动流转、启动开发、删除附件或版本编辑 / 归档接口。创建或指派只保存事项或生成待开发任务，不启动 Agent、不建立开发 worktree。需要这些后续动作时引导到控制台。

## 内容映射与默认值

`create_issue` 结构必填为 `projectId`、`requestId`、`type`、`title`；`type` 是 `requirement` 或 `bug`。本技能还要求需求的描述与验收、Bug 的四项专用内容和修复验证达到正文规范。

| 字段 | 使用规则 |
| --- | --- |
| `title` | 非空，最多 200 字，表达具体变化或异常 |
| `description` | 需求背景、范围、规则、实施依赖、原型清单；Bug 环境、影响和上下文 |
| `acceptanceCriteria` | 需求 AC 用例或 Bug 修复验证，不只写“见正文” |
| `reproductionSteps` | Bug 前置条件、编号步骤；需求仅在当前流程另有要求时补充 |
| `expectedResult` / `actualResult` | Bug 的预期依据与观察事实分别填写 |
| `priority` | `low / normal / high / urgent`，默认 `normal`；表示处理优先级 |
| `severity` | `minor / normal / major / critical`，默认 `normal`；Bug 的影响程度 |
| `releaseId` | 本项目 active 版本 UUID；不指定则未关联，不能把环境中的故障版本自动作为目标修复版本 |
| `dueDate` | 有依据的截止日期 `YYYY-MM-DD`；未约定则省略，不按优先级编造排期 |
| `tags` | 最多 12 个，每个最多 30 字；只用实际相关标签 |
| 职责字段 | 使用已查询的有效成员 ID；没指定 QA、验收人或开发人时不要虚构安排 |
| `watcherIds` | 最多 50 个不同的有效成员 ID；必须在授权范围内添加 |
| `attachmentIds` | 本次待绑定附件 ID，最多 20 个且合计不超过 20 MiB；与正文引用一致 |

五个 Markdown 文本字段（description、acceptanceCriteria、reproductionSteps、expectedResult、actualResult）每项最多 60000 字。创建不能提交 `status`、`workflowVersionId`、处理人或执行状态。展示草稿时说明将使用的默认值，不把默认优先级说成业务已确认。

## 附件：本地核验 → 临时 Token → HTTP 上传 → 事项绑定

完成内容和附件检查后，调用 `create_upload_token({projectId})` 取得 `uploadToken`、`uploadUrl`、`expiresAt`。这只申请凭据，不会上传文件；Token 仅限该项目上传，最长 24 小时且不晚于父 MCP Token 到期。

将返回的临时 Token 安全传给上传进程。确认 `uploadUrl` 与当前 `runtime.siteOrigin` 同源，向该地址 POST 原始文件二进制，文件名进行 URL 编码。原 MCP Token 不能上传；上传 Token 不能调用 MCP。不可传 multipart、base64 或把客户端路径塞进 MCP 参数。

PowerShell 操作示意（变量需来自实际查询和文件，不能原样把说明文字提交）：

```powershell
# 首次发送前确定并保存；重试时不重新生成 uploadId。
$uploadId = [guid]::NewGuid().ToString()
$uploadName = [Uri]::EscapeDataString([IO.Path]::GetFileName($prototypePath))
$uploadUrl = $uploadGrant.uploadUrl + '?name=' + $uploadName
$uploadHeaders = @{
  Authorization = "Bearer $env:DEVLOOM_UPLOAD_TOKEN"
  'Idempotency-Key' = $uploadId
}
# prototypePath 为本地实际文件；mimeType 按真实格式填写。
$uploadResult = Invoke-RestMethod -Method Post -Uri $uploadUrl `
  -Headers $uploadHeaders -ContentType $mimeType -InFile $prototypePath
```

`$uploadGrant` 为本次工具返回结果；确认地址仍属于当前 `runtime.siteOrigin`。`$env:DEVLOOM_UPLOAD_TOKEN` 由工具结果注入当前临时进程，不输出其内容。示例中的 `$prototypePath` 只是 HTTP 客户端读取文件的路径，不是 MCP 参数。

- MIME：PNG `image/png`，JPEG `image/jpeg`，WebP `image/webp`，PDF `application/pdf`，HTML `text/html`，ZIP `application/zip`，TAR `application/x-tar`，TAR.GZ `application/gzip`；未知格式 `application/octet-stream`。
- 每文件一个稳定 UUIDv4 上传标识；成功保存 `attachmentId`、`markdown` 和 `expiresAt`。Token 可以在有效期内复用，上传标识不能跨文件复用。
- 单文件最多 10 MiB，本次创建 / 编辑最多 20 个且总计 20 MiB；每人有效暂存最多 100 MiB。暂存文件须在上传后 24 小时内绑定，该时限与 Token 到期独立。
- 使用上传结果的 `markdown` 写入正文，并将对应 `attachmentId` 放入 `attachmentIds`；可修改说明文字，不改链接目标和图片/文件语法。图片用 `![说明](attachment:ID)`，其他文件用 `[说明](attachment:ID)`。必须同时检查正式绑定与正文引用，不能二选一。
- 只能绑定同一上传账号、同一项目的附件；已经绑定别的事项的文件不能直接复用。对另一事项复用同一资料时需重新上传并取得新的附件 ID。
- 正式附件需要登录与项目权限，不是公开图床。执行时 PNG / JPEG / WebP 可作为图片输入，其他文件通过执行端本地路径读取；上传不证明内容已解析。

### 正文预览与 Agent 文件输入分别检查

创建示意（ID 只表示占位，实际提交必须来自本次上传）：

```json
{
  "description": "## 目标原型\n![失败状态及处理操作](attachment:图片附件ID)\n\n[可交互原型包](attachment:文件附件ID)",
  "attachmentIds": ["图片附件ID", "文件附件ID"]
}
```

- MCP 将 `attachment:ID` 替换为正式 `/api/projects/项目ID/files/附件ID` 地址，保留外层 Markdown；它不会替裸路径自动补 `![]()`。提交正文不能写成“原型附件：/api/...”或“原型附件：attachment:ID”，也不能把应展示的引用放进反引号/代码块。普通文件不冒充图片，Markdown 链接可下载并不表示该格式一定支持内嵌预览。
- 提交前逐个附件检查类型、正文 Markdown 与 `attachmentIds`。更新已有附件引用时，保留已核实的正式 Markdown 地址；若改用 `attachment:ID`，仍需按工具约定携带对应 ID，不能虚构或跨事项复用。
- 回读时同时核对正式附件记录和正文：图片保留 `!` 前缀及完整 Markdown 图片语法，普通文件保留 Markdown 链接语法；目标地址为本事项实际附件的正式 `/api/projects/.../files/...` 路径，且不再残留 `attachment:`。只看到附件列表、`images` 元数据或 HTTP 成功，不能证明正文可预览。有可用的已登录界面时检查渲染；否则明确只验证了绑定与 Markdown，未做浏览器预览。
- 前端附件 URL 用于受鉴权展示，不是 Agent 可直接读取的文件路径。开发执行由 DevLoom 将正式附件落到执行端：图片传为图片输入，其他文件通过提示词中的可读取本地路径交给 Agent。不得用提报电脑上的路径、仅聊天中存在的文件或 `/api/...` 裸地址替代正式附件。正文可预览也不证明 Agent 已收到文件。
- 若任务包含修改 Markdown 解析、附件提取或执行分发，必须使用隔离夹具分别验证图片输入和普通文件本地路径、内容可读及失败不静默丢弃；不能只验证前端。单纯提报不为验证附件而启动真实开发；在尚未执行时说明只完成发布侧检查。

## 提交、回读和失败恢复

1. 门禁通过且完整内容已获发布授权后，为本次写操作生成并保存 UUIDv4 `requestId` 和全部最终参数；它与上传标识、JSON-RPC ID 分开。不要保存凭据。
2. 调用 `create_issue`。检查工具的 `isError` 及 `error.status/code/message`，不能把收到 HTTP 响应就当业务成功。
3. 成功后用 `get_issue` 回读：逐项核对类型、标题、正文、专用字段、验收、日期、版本、人员和附件数量、名称。按上节检查正式 Markdown 图片/文件引用及其对应附件，不能只比链接目标而漏掉外层语法。
4. 使用实际站点地址解析返回的 `issue.url` 给用户链接；说明已绑定的原型 / 证据及是否指派。若部分字段不符，报告真实差异并按授权修正，不假装核验通过。

| 情况 | 处理 |
| --- | --- |
| 创建超时或响应丢失 | 先 `get_request_result({projectId,requestId})`；找到则读取原结果，再 `get_issue` 核验。未找到也只用原 requestId 和全部原参数重试 |
| 创建已成功，回读失败 | 报告“已创建，详情核验未完成”，保留返回的事项 ID 和链接，后续只补做读取，不再次创建 |
| 网络持续失败 | 查询原请求并最多追加一次原样重试；仍无法确定时保留 requestId、参数和已上传附件信息，报告“结果待核实”，不循环创建 |
| 上传超时 | 同一项目、文件、名称、MIME 与原上传标识重试；同样以一次原样重试为限，仍失败则保留草稿 |
| 上传 Token 过期 | 重新申请 Token，沿用原上传标识和文件；不等于附件已过期 |
| 410 暂存附件过期 | 先查原创建请求是否已成功；确认未成功后，用新上传标识重传。新附件 ID 会改变创建参数，确认旧操作未成功后才形成新的写操作与 requestId |
| 401 / 403 / 普通 404 | 核对凭据、scope、项目权限与对象归属；不要换账号、删材料或绕过权限 |
| `get_request_result` 返回 404 | 只表示未查到已提交成功结果，不授权更换 requestId 重发 |
| 409 | 先查原请求；相同标识参数不同需找回原参数，不能盲目换 ID。修订冲突按下文合并处理，维护或流程门禁按具体错误解决 |
| 上传、绑定或成员校验失败 | 创建为原子操作，不能声称部分发布成功；保留草稿和有效暂存资料，说明失败项 |

更新已授权补充的事项时，先 `get_issue` 取得 `revision`，用 `update_issue({projectId,issueId,requestId,revision,...变更字段})`；只提交有意修改的字段。`type`、`status`、`developerId` 不能通过该工具修改。

更新中省略字段表示保留；`tags`、`watcherIds` 是整组替换，先合并原有内容；`attachmentIds` 是追加，空数组不能删除附件。`releaseId`、`qaOwnerId`、`acceptanceOwnerId` 可用 null 清空，`dueDate` 可用 null 或空字符串清空，不能顺手重置用户未要求变更的字段。

修订冲突时先确认原操作没有成功，再重新读取、比较并合并用户授权的变更；不得覆盖他人的修改。合并产生了新的实质决策时展示差异待确认，随后用新的 requestId 提交新操作。转派用 `assign_issue`，已有任务还需其 `taskRevision`；只允许尚未启动的独立事项任务转派，合并任务按控制台限制处理。
