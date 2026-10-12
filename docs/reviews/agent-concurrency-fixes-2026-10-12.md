# Agent 会话并发问题修复（2026-10-12）

修复本轮 review 确认的两项 P2，并处理验证中发现的同任务重复启动问题。本轮生产代码调整限于 `SessionEvents` 和 `SessionManager`，不修改前端、数据库格式或执行器协议。

## 修复结果

| 问题 | 修复后的行为 | 回归证据 |
| --- | --- | --- |
| Git 凭据刷新后，消息可能先于断线状态更新发送 | 断线分别进入所属任务队列；继续执行在判断连接状态前等待该队列，再连接、恢复原 session 并发送 | A 的断线持久化阻塞时，B 仍依次连接、读取、恢复、启动；A 迟到完成不覆盖 B 的连接状态 |
| 单条会话的历史补齐阻塞其他会话事件 | 按任务 key 串行处理，历史、审批、输出和持久化各自保序；错误只影响所属会话 | A 历史挂起时，B 审批、流输出、完成及单会话等待均正常；全局关闭仍等待 A |
| 同 key 并发启动覆盖并清理原运行态 | 凭据刷新后，对启动准备阶段按 key 互斥；接受启动后即释放操作锁 | 同时启动只创建一条流水线，忙时重复请求明确失败；相同指纹稍后重试复用，所有权不变，当前轮仍可接收补充指令 |

事件入队时捕获运行态身份，旧事件不能写入同 key 的替代实例；排队中的交互请求保留归属，不带 sessionId 的请求完成事件仍排在原请求之后。单会话删除只等待所属队列，关闭服务继续等待全部队列和已接受操作。

新增 10 项回归分布于：

- `test/unit/session-event-isolation.test.cjs`：6 项事件隔离、保序、异常和归属测试。
- `test/integration/session-event-concurrency.test.cjs`：1 项凭据轮换与恢复测试。
- `test/integration/session-launch-concurrency.test.cjs`：3 项重复启动、重试及凭据刷新顺序测试。

## 验证

- Windows、Node.js 22.22.0、隔离 Docker PostgreSQL 17（55439）。所有执行器与外部需求均使用模拟数据，未执行真实需求或修改 TAPD。
- 全量 ESLint 及最终增量 ESLint 通过。
- 架构、单元、集成测试 **461/461 通过**，无失败、跳过或取消。日志：`state/agent-concurrency-fixes/node-tests.log`。
- `npm run build` 通过，保留现有构建块大小提示。日志：`state/agent-concurrency-fixes/build.log`。
- Jenkinsfile 的 8 个浏览器入口全部通过：session、workspaces、dev、accounts、project-collaboration、development-flows、project-editing、visual；视觉检查生成 147 张截图，自动检查未发现溢出或说明重叠。日志为同目录 `browser-*.log`。
- 当前机器未安装 Jenkins 所选的 Playwright Chromium，首次启动在打开浏览器前失败；随后使用仓库支持的 Windows Edge 完成上述全部检查。没有改动测试断言。

测试浏览器与子服务均已退出，本轮独立测试容器 `web-coding-agent-concurrency-tests` 已清理，业务 PostgreSQL 保持运行。没有修改业务数据库，没有提交或推送。本地 4318 服务未重启；新后端代码需在重启后生效。Linux 本轮未实测。
