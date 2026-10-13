# Agent 供应商管理验收记录

日期：2026-10-13。范围及设计经过用户确认，按“供应商卡片”方案实施。工程契约见 [Agent 供应商](../engineering/agent-suppliers.md)。

## 实现范围

- 管理员维护系统 Codex API Key 供应商：增删改、复制、启停、默认选择、手填或获取模型、思考强度和手动生成检测。
- 内置“服务器现有配置”保留服务账号认证；供应商失败不回退，不转换协议或转发路由。Claude 等 Agent 尚未实现，保留适配器注册边界。
- Key 加密保存且不回显，复制不带 Key；并发修订、管理员权限、CSRF、默认项和活动引用保护均已实现。
- 按会话持有原生连接，切换在下一轮生效；当前输出、审批、提问和补充指令保留原连接。原 session、工作目录、source 和任务身份不变。
- 解析每轮具体模型及强度；无法确认自定义模型默认强度时提示配置或重选，避免沿用上一轮。永久删除任务同时清理供应商引用。
- 页面刷新下一轮模型目录和供应商提示，保留草稿；不兼容的显式模型阻止下一轮发送，不阻止当前轮次补充指令。

## 本地验证

环境：Windows、Node.js 25.8.2、Microsoft Edge、独立 PostgreSQL 17 测试容器。测试数据库使用随机 schema，Git 仓库、供应商 HTTP 和 Agent/Codex 都是隔离夹具。未使用真实供应商 Key、未执行真实需求、未修改 TAPD。

| 检查 | 结果与证据 |
| --- | --- |
| `npx eslint src test web/src web/vite.config.mjs` | 通过 |
| `node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs` | 538 通过、0 失败、0 跳过；`state/agent-supplier-tests-final.log` |
| `npm run build` | 通过；保留原有大于 500 kB 的产物提示；`state/agent-supplier-build.log` |
| Jenkins 浏览器入口 | session、workspaces、dev、accounts、project-collaboration、development-flows、project-editing、visual 全部通过；日志位于 `state/agent-supplier-browser*.log` |
| 响应式及视觉检查 | visual 生成 205 张截图；供应商卡片和编辑弹窗检查 1440／768／390／320px，无横向溢出，Escape、焦点恢复和底部操作可用 |
| Linux | 按用户要求跳过，不宣称跨平台验证完成 |

会话浏览器新增 `session-suppliers.test.cjs`，验证无任务 ID 的供应商 SSE、模型目录更新、当前／下一轮提示、草稿保留、运行中补充指令和空闲后模型不兼容门禁。该回归曾发现无任务 ID 事件访问空 `pendingView` 的错误，已增加存在性判断。

实际界面截图位于 `state/browser/accounts/agent-suppliers-*.png`、`agent-supplier-editor-*.png` 及 `state/browser/session-supplier-pending.png`；统一截图索引为 `state/browser/unified/index.html`。这些是模拟数据下的实现截图，设计阶段的三方案原型另存，不作为实现证据。运行日志及截图忽略提交。

## 部署及限制

升级需执行 `npm run build`、`npm run db:deploy` 并重启服务。迁移 `20261013110000_agent_suppliers` 在既有基线后增加供应商、选择与使用记录，并初始化服务器配置项。备份同时保留数据库、凭据主密钥及原业务 Git／Worktree／Codex 资料。

本次未更新 Linux 上的实际应用服务，也没有进行真实供应商生成验证。第三方 Responses 接口、模型和工具能力仍需管理员填写配置后通过显式检测与实际使用确认；模型列表读取成功不代表生成成功。
