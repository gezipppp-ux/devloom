# 需求渠道扩展契约

`src/channels/registry.cjs` 是显式注册入口；当前渠道为 TAPD 和手动输入。新增渠道时实现适配器并加入注册表，不需要修改 Codex 传输、会话控制或执行核心。模拟第二渠道的完整验证见 `test/decoupling.test.cjs`，手动渠道验证见 `test/manual.test.cjs`。

## 分层

- `channels/tapd.cjs`：TAPD 登录读取、需求检索、人员验证、图文任务包和状态流转。复用现有 TAPD HTTP 模块。
- `channels/manual.cjs`：标题/正文验证、图片暂存与任务包、标题拼音命名；无需 TAPD 凭据，渠道同步返回 skipped。
- `execution_runner.cjs`：幂等、锁、Git worktree、session 启动次序与记录持久化；通过适配器回调同步渠道状态。
- `web_sessions.cjs`：原 session 续聊、实时输出、中断、审批和问题回复。
- `web_server.cjs`：同源保护、HTTP/SSE、静态资源及按渠道转发请求。
- `settings.cjs`：只包含执行位置与基准引用，独立于渠道凭据。
- `tapd_runner.cjs`：旧 TAPD CLI 的兼容入口，转发至通用执行核心。

## 渠道对象

| 方法/字段                                  | 契约                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `id`                                       | 小写字母开头，后续字母/数字/连字符，最多 32 字符                                                            |
| `capabilities`                             | `{search:boolean,assignees:boolean}`；决定 Web 是否展示检索与人员选择                                       |
| `describe()`                               | `{id,label,workspace,scopeLabel,capabilities}`，不包含凭据                                                  |
| `search({workspace,query})`                | 标准化 `[{id,workspace,title,status}]`                                                                      |
| `searchUsers({workspace,query})`           | `[{id,nick,name}]`；nick 为实际写入渠道的人员值                                                             |
| `resolve(input)`                           | 验证 Web 输入和人员，返回 `{item,config,session}`；`session` 是仅供后台使用的渠道上下文，不是 Codex session |
| `validate(config)`                         | 可选，执行或重试前检查渠道写入权限                                                                          |
| `prepare({session,item,directory,config})` | 返回 `{workitem,task,target}`；下载图片、准备提示词、验证渠道能否流转                                       |
| `transition({session,state,config})`       | 执行并验证渠道状态同步，返回可公开记录的结果；无状态同步的渠道可返回 `{status:'skipped'}`                   |

`item/workitem` 兼容既有记录，使用 `{id,workspace_id,title,...}`；`workspace_id` 对应渠道内的项目或作用域，不要求是数字。`task` 必须提供 `{execution_ready,blocked_reason?,codex_prompt,images:[{path,...}]}`，图片应放在当前任务目录下。素材应在 prepare 中准备完整，失败则中止，不应静默丢图。

TAPD 的开发人员、测试人员和 owner 字段只由 TAPD 适配器映射，通用执行层不识别这些字段。Web 提交 `{channel,id,workspace,developer?,tester?}`；不支持人员选择的渠道无需这些字段。

## 身份与历史

新增记录包含 `source:{channel,scope,id}`。TAPD 的任务 key 继续为 `<workspace>-<id>`，其他渠道使用 `<channel>-<scope/id的SHA256前32位>`，避免跨渠道 ID 冲突与路径注入。缺少 source 的旧记录按 TAPD 解释。通用 `requirement.json` 保存任务包；读取旧任务时兼容 `tapd-task.json`。

调用 `thread/start` 只证明 session 已创建，只有 `turn/started` 确认执行开始后才同步渠道状态。执行结果与渠道同步结果分开保存；同步失败不能重新创建 session。未知渠道会被拒绝，HTTP 输入不能指定任意代码模块或 session ID。

## 仓库与路径

映射优先级为 `codex.repositories['<channel>:<scope>']` → TAPD 旧 `codex.repositories['<workspace>']` → Web 默认仓库 → `codex.repository`。不再根据父目录层级猜测仓库。

worktree 默认根目录为 `~/.codex-workspaces`，可通过 Web「执行设置」保存覆盖值；未保存 Web 配置时可用 `codex.worktree_root`。最终位置为 `<root>/<repository-path-hash>/<channel-key>`。每次运行保存最终绝对路径；改配置仅影响新任务，历史任务续用原位置。

手动渠道的 `prepare` 还返回可选的 `worktreeSlug` 和 `worktreeName`。前者决定可读分支及默认目录名称（渠道前缀、标题拼音、身份哈希末 12 位）；后者只覆盖目录的最后一级名称，必须经共享跨平台名称校验。不能由浏览器传入完整路径。TAPD 原有命名不变，运行 key 仍独立使用身份哈希。

手动 Web 请求为 `{channel:'manual',requestId,title,content,images,worktreeName?}`。requestId 是表单创建时生成的 UUID v4，失败重试保持不变。标题最多 200 字、正文最多 60000 字，正文和图片至少一项非空。`images` 是最多 20 个上传 ID，不能提交任意文件路径。`POST /api/channels/manual/images` 使用原始二进制请求体，要求同源和 `x-tapd-token`，按 10 MiB 限制并检查图片签名；返回 `{id,extension,bytes}`。上传保存在数据目录 `state/manual-uploads`，24 小时过期，后续上传时清理。执行前复制到任务目录，确保原始图片在历史资料及 Codex 输入中可用。
