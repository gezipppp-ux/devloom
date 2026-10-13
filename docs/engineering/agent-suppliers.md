# Agent 供应商

供应商属于系统设置，只允许管理员维护。`agent.provider` 仍表示 CLI 执行器类型，`supplier` 表示 API 服务配置。当前只注册 Codex 的直连 Responses 能力；没有协议转换、路由、自动故障转移或 Claude 执行实现。

## 管理与部署

管理员在 `/system?tab=agent-suppliers` 使用供应商卡片管理 API Key 配置：新增、编辑、复制、启停、删除、设为默认、获取模型和手动生成检测。复制不包含密钥，编辑留空保留原密钥。获取模型仅返回候选项，管理员勾选后保存；无法获取时可手填。思考强度和默认值按供应商实际能力填写，不从模型名推断。

内置“服务器现有配置”不可编辑、删除，初始为默认，使用运行服务账号已有的 Codex 配置及认证。管理员可显式切回；API Key 失败不会自动回退。该选项的认证检查位于环境检测，不提供网页登录，也不声称登录检查等于生成成功。

升级运行 `npm run build`、`npm run db:deploy` 后重启服务。迁移 `20261013110000_agent_suppliers` 添加配置、选择、使用记录并初始化内置项，不改写既有迁移。凭据使用现有 AES-256-GCM 主密钥，备份仍需同时保留 PostgreSQL 和 `secrets/database.key`（或对应环境密钥）。

## 数据和 API

`AgentSupplier` 保存结构化模型目录、加密 Key、普通修订号和运行修订号。名称及备注修改只增加普通修订；地址、Key、模型目录和默认模型变更增加运行修订。`AgentSupplierSelection` 按 Agent 类型保存默认项及选择修订号。写操作在短 Serializable 事务中检查修订，冲突返回 409。

`AgentSupplierUse` 按工作区和 run key 保存供应商引用、随机轮次租约及 reserved/active/idle/unknown 状态。事务中预留轮次与删除引用检查互斥；运行、交互和结果不明确时不可删除。完成事件处理后释放引用。未知状态在人工继续、原生会话确认空闲后才能重新绑定；经现有删除门禁确认可永久删除的任务，与使用引用在同一事务中清理。默认项必须先显式切换才能停用或删除。历史脱敏快照不依赖供应商外键。

管理员 API 位于 `/api/system/agent-suppliers`，包含 GET 列表、POST 新建及 `/:id` 编辑，以及 `/:id/activate`、`/:id/delete`、`/:id/duplicate`、`/models`、`/check`。变更需 CSRF；服务重新检查管理员身份。外部网络操作不占事务，结束后复核身份与保存配置的修订号。地址拒绝内嵌凭据、查询和片段；带 Key 请求禁止重定向。响应体上限 1 MiB，超时 20 秒，外部错误正文不进入接口响应。

管理 DTO 只含 `hasApiKey`；成员执行选项和会话只含供应商 ID、名称、类型、认证模式和运行版本。生成检测仅提交固定的“Reply with OK.”，限制 128 输出 token，不带任务、仓库或图片。成功要求完整的 Responses 文本结果；HTTP 200 或模型列表可读都不能代替生成成功。

## 会话生命周期

数据库模式的 `SessionManager` 使用 `AgentSessionManager` 为每个 run key 持有独立原生连接。命令和事件队列通过上下文明确归属，审批同时按原请求对象绑定连接。发现模型与权限使用独立连接，切换期间过期发现结果被拒绝。空闲连接 60 秒后释放，释放与恢复之间有关闭栅栏。

首次准备和每次空闲续聊冻结供应商及运行版本、预留使用记录。新轮次必要时关闭本会话旧连接，在同一个 `session_id` 和 cwd 上恢复，其他任务连接不受影响。运行中的补充指令、审批和提问继续交给原连接。首轮流水线、事件落库及交互未结束或原生状态未知时不切换。连接失败不换 session、不自动重放。

`execution-settings.json` 逻辑文档保存 `initialSupplier`、最近实际 `supplier` 和实际执行选择；`turn-configuration` 逻辑日志按真实开始事件保存每轮供应商、模型、强度。初始任务配置和 source/run key/Worktree/分支不变。会话 DTO 提供 `activeSupplier`、`nextSupplier`、`supplierPending`；切换事件刷新模型及提示，不清空用户草稿。

未指定模型使用当前供应商默认值；显式模型或强度不兼容时拒绝发送，用户重新选择。强度依次使用显式选择、管理员配置的模型默认值、Codex 模型目录中同 ID 的有效默认值。无法确定或超出配置的支持范围时阻止发送，提示配置默认值或重选，不用 null 继承上一轮强度。系统切换不会改写个人偏好。执行权限维持 Agent 原生校验。

Codex 子进程通过非秘密 `-c` 参数配置专用 provider，Key 仅放入该子进程环境。start/resume 显式指定目标 provider；切回内置项使用 `config/read` 解析原生 provider。共享 `config.toml`、`auth.json` 和 `CODEX_HOME` 不改变。依赖安装版本提供 start/resume 配置覆盖；缺失时提示升级。第三方接口的工具和模型兼容性仍取决于供应商本身。

## 验证

`agent-suppliers.test.cjs` 覆盖输入、HTTP 权限、CSRF、数据库加密、修订、租约删除保护、过期检测和 Responses 响应校验。`agent-supplier-sessions.test.cjs` 通过 fake Agent/Codex 验证会话身份、并行会话、审批、steer、连续切换、Key 轮换、未知状态、不重试及迟到事件。`codex-app-server.test.cjs` 验证密钥不在参数中、共享 home 不变和错误脱敏。账号浏览器入口包含供应商交互及 1440/768/390/320px 截图检查。

测试只用隔离 PostgreSQL、临时目录和假接口，不执行真实需求，不产生真实供应商费用。会话浏览器入口另验证供应商 SSE、草稿保留和当前轮次补充指令；实际验证范围与结果见 [验收记录](../prd/agent-supplier-verification.md)。
