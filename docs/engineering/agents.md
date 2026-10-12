# CLI Agent 边界

本项目通过显式注册的 Agent provider 执行开发任务。当前唯一实现是 Codex；Claude CLI、pi 尚未接入。需求来源渠道与执行器是两个独立概念，项目业务不识别执行器的原生协议。

## 数据与配置

本次采用新格式，不兼容旧配置/任务，不提供旧键读取、迁移或自动清理。

```js
{
  execution: {
    repository: "/projects/repository", baseRef: "main",
    worktreeRoot: "/projects/worktree", initCommands: [],
    projectName: "example", gitAccountId: "...", remoteUrl: "..."
  },
  agent: {
    provider: "codex", model: "", reasoningEffort: "", permissionMode: "ask",
    startupTimeoutMs: 120000, options: { /* provider 专属启动配置 */ }
  }
}
```

仓库、初始化与 Git 身份属于 `execution`；模型和执行器标识属于 `agent`。需求资料包使用 `prompt`、`images`。新运行记录保存 `agent` 初始选择，`session_id` 是不透明的外部会话标识；`source`、run key 与 worktree 身份独立于 provider。缺失、未知或不匹配的 provider 不得继续执行。查询离线数据库历史不启动 CLI。

Git 账号引用保护读取 `execution.gitAccountId`；凭据临时环境按连接持有并在空闲时刷新。默认新成员目录为 `.web-coding-workspaces`，不移动既有目录。任务分支前缀仍遵循仓库命名约定，不据此判断 provider。

## 注册与会话接口

`src/agents/registry.cjs` 仅显式注册已实现的 provider；不根据用户输入动态加载模块。provider 提供 `create` 及安装检测所需的命令定位。通用执行器要求应用显式注入会话执行接口，不提供隐式 CLI 启动回退。Web 会话通过 Agent 对象调用：

| 接口 | 用途 |
| --- | --- |
| `connect / close / refreshGitCredentials / validateCommand` | 连接与进程生命周期 |
| `listModels / permissionOptions / validateSelection / assertPermissionAvailable / prepareTurn` | 模型、执行权限与具体轮次选择 |
| `createSession / readSession / resumeSession` | 创建、确认空闲与恢复外部会话 |
| `startTurn / steerTurn / interruptTurn` | 启动、补充及停止轮次 |
| `listHistory` | 单页按时间正序返回标准展示条目与不透明 cursor |
| `respond / reject` | 校验并转换交互响应 |

输入为 `{type:'text',text}` 或 `{type:'image',path}`。图片路径必须来自本任务的受验证存储。能力 `history/images/steer/approvals/userInput/resume` 只有显式为 true 才表示支持。执行权限列表按服务端返回值启用；发现失败不能假设 ask/full 可用。

## 事件与呈现

Agent 发出 `event`、`request` 和 `disconnected`。标准事件包括 `turn-started`、`turn-completed`、`item`、`item-delta`、`request-resolved`；共同携带 sessionId，涉及轮次的事件携带 turnId 或 turn 对象。执行器的 `running` 轮次状态与 UI 条目 `inProgress` 状态各自保持定义。

交互请求为 `{id,sessionId,turnId,kind,blocking,...展示字段}`，kind 为 `approval` 或 `user-input`；不支持的请求明确拒绝。ID 不透明，不能在应用或浏览器中还原为原生 RPC ID。协议方法、原生参数和审批响应格式只属于 adapter。数字和字符串形式的原生 ID 不得互相覆盖。

Codex 的历史与通知在 provider 中归一化为现有展示条目。图片引用转换为路径或摘要，再由应用/存储匹配本任务已保存的图片并生成授权 URL；原始内容和本地图片路径不进入公开 DTO。标准通知写入 `agent-events.jsonl` 逻辑日志，历史条目在 PostgreSQL 中独立保存。底层非交互 CLI 模块仅保留独立的协议测试，不从产品入口调用；它通过 `onItem` 提供标准历史条目，存储不解析原生事件。

## 生命周期与验证

应用仍拥有授权、操作互斥、首轮准备、真实 started 回调、迟到响应防护、历史持久化和关闭栅栏。adapter 不得自动重放未确认的轮次，也不得用成功状态填补未知状态。不支持的执行权限不能用自动批准模拟。

事件按任务 key 串行处理；不同会话的历史补齐、持久化和交互互不等待，队列异常只影响所属会话。断线事件快照当前运行态并进入各自队列；继续执行在判断连接状态前等待所属队列处理完毕，避免凭据轮换后误用旧连接。排队中的请求也保留归属，无会话标识的请求完成事件不能越过原请求。删除只等待所属会话，服务关闭仍等待全部队列及已受理工作。

同一任务的启动准备使用操作互斥，直到接受启动后释放；后台执行期间可继续发送补充指令。并发重复启动不能创建第二条流水线或清理原运行态；相同请求指纹的后续重试复用已接受的任务。

架构测试禁止业务模块/前端依赖 Codex RPC。`agent-session.test.cjs` 用完全不实现 RPC 的 fake Agent 验证通用会话路径；provider 测试独立验证 Codex 协议映射。验证仅使用模拟进程、临时 Git 与隔离 PostgreSQL，不执行真实需求。
