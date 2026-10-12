# CLI Agent 解耦验收（2026-10-11）

[PRD](../prd/cli-agent-decoupling.md)实施完成，接口和职责见[CLI Agent 边界](../engineering/agents.md)。当前仅接入 Codex，没有实现 Claude CLI、pi，也没有增加不可用的执行器选项。

## 实现与审查结果

- 通用业务、执行流程、存储和前端通过 Agent 接口及标准事件/交互 DTO 工作。Codex 原生协议、模型发现、命令审批和输入转换封装在适配器内。
- 配置改用 `execution` / `agent`，需求资料使用 `prompt`，运行记录保存 provider 与初始选择。不提供旧字段回退或数据迁移，不删除旧业务数据。缺失、未知或不匹配的 provider 拒绝执行。
- 注册表不提供 `runTask`。通用流水线必须显式注入 `startSession`，缺失时在资料与 Git 准备前失败，不会隐式启动原生 CLI。
- 保留真实启动后来源流转、迟到响应防护、首轮结束锁、关闭等待、空闲凭据刷新和数据库历史离线读取。会话身份、工作树路径和来源状态不因适配层重写。
- 适配器审查修复了请求归属、重复及复用 ID、关闭后晚到事件与异步拒绝等待。数字和字符串原生请求 ID 分别保存，响应必须属于当前待处理请求。
- 前端按服务端能力启用图片、恢复、审批和轮次补充。权限发现失败会禁止启动新轮次，但不会阻止对正在运行的轮次发送补充指令。
- 架构测试约束通用模块不能导入 Codex 实现或调用原生 RPC；独立 fake Agent 不实现原生 `request()`，直接验证生产 `SessionManager` 的通用路径。

## 验证证据

环境为 Windows、Node.js 22.22.0、隔离 Docker PostgreSQL 17、临时 Git 和模拟 Agent；Linux 本轮未实测。

| 检查 | 结果 |
| --- | --- |
| `npx eslint src test web/src web/vite.config.mjs` | 通过 |
| 架构、单元、集成全量测试 | 451/451 通过，无失败、跳过或取消 |
| 最终测试支架改动后的增量 ESLint 与会话回归 | 通过，20/20 测试通过 |
| `npm run build` | 通过，保留现有构建块大小提示 |
| Jenkinsfile 浏览器入口 | session、workspaces、dev、accounts、project-collaboration、development-flows、project-editing、visual 全部通过 |
| 视觉检查 | 147 张截图，无自动检查发现的溢出或说明重叠；人工检查桌面/手机个人设置、桌面审批及 320px 提问界面 |

全量后端日志为 `state/agent-decoupling/node-tests.log`，最终增量日志为 `state/agent-decoupling/contract-recheck.log`，浏览器日志为同目录下的 `browser-*.log`。日志和截图位于忽略目录，不提交仓库。

早期验证发现一个旧夹具仍向生产会话管理器传入已删除的 `client` 参数，意外启动真实 app-server 进行模型发现；已停止该测试进程树，没有执行真实需求。所有相关夹具已改为显式注入模拟 Agent；测试支架缺少模拟依赖时直接失败，防止再次隐式启动真实 CLI。修正后的全量和最终增量验证均通过，没有修改 TAPD。

## 交付状态

本次测试容器 `web-coding-agent-decoupling-tests` 使用独立端口 55439，验证完成后清理；业务 PostgreSQL 保留。代码未提交或推送。

本轮没有重启 4318 本地服务，其 Node 进程仍运行改造前的后端。前端构建产物已更新；要使用完整的新版本仍需重启后端，并使用新格式配置和任务记录。没有对本地业务环境执行数据迁移或清库。
