# 事项、开发与交付联动验收记录

日期：2026-10-15。用户已批准[闭环方案](../prd/workflow-handoff-closure.md)，并明确允许不兼容历史业务数据。实现规则见[流程动作契约](../engineering/workflow-actions.md)。

## 已实现

- 移除通用“开始处理”；人工流转展示目标状态与下一处理人，使用“更新状态并交接”。
- 认领或指派同步待开发状态与处理人；真实 Agent 开始事件推进开发中。执行事件持久化、去重、重启恢复；受阻时仅重试业务流转。
- 提交交付、开始验证、通过及退回各自原子更新交付、事项状态、处理人、历史和待办。验证结论不再附带可选状态。
- 退回保留开发任务和原交付链；多事项任务支持部分送验及原子批量送验，全部范围结束且执行停止后自动完成任务。
- 自定义流程保留节点、职责、工作类别、资料门禁和不可变版本，增加事件、操作主体、交接规则及规则预览。状态名称不参与事件判断。
- 验证中转派保留进度，开发取消后交回业务负责人协调；重新认领显式创建新任务，不复活旧任务。

## 验证

环境为 Windows、Edge、本机隔离 PostgreSQL schema、临时 Git 和 fake Agent；未执行真实需求或写入 TAPD，未验证 Linux/macOS 实机。

| 检查 | 结果 |
| --- | --- |
| `npx eslint src test web/src web/vite.config.mjs` | 通过 |
| `node --env-file-if-exists=.env --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs` | 620 项通过，0 失败、0 跳过 |
| `npm run build` | 通过，含 Prisma 生成和数据库接口检查 |
| Jenkinsfile 全部 9 个浏览器入口 | session、workspaces、dev、accounts、setup、project-collaboration、development-flows、project-editing、visual 均通过 |
| 视觉 | 344 张常规截图，无溢出或提示重叠；额外检查批量送验弹窗的 1920、2560、1440、1280、768、390、320px 视口 |
| `git diff --check` | 通过 |

新增 10 项联动集成回归覆盖多用户交接、退回重提、无效验证人整笔回滚、改名状态与业务验收、多事项批量原子性、旧执行事件阻塞与重试、并发送验、取消后重领、任务范围修改、验证中转派。项目协作浏览器使用真实 HTTP 和隔离数据库完成“两条事项分派并合并 → fake 执行 → 批量送验 → 逐条验证 → 任务自动完成”，并断言发布后任务仍开放、全部验收后释放认领。

浏览器首次遇到保存后重新打开编辑器的撤销按钮超时，完整复跑通过，未修改该断言。流程发布后读取筛选项的回归曾早于异步流程请求完成，补充等待该请求后保留原名称断言，完整协作用例通过。日志中的远端 502 为已有失败恢复夹具的预期响应。

日志及截图位于忽略的 `state/workflow-final-all-tests.log`、`state/workflow-final-build.log`、`state/workflow-browser-*.log` 和 `state/browser/`，不提交运行资料或连接配置。

## 部署边界

新增迁移 `20261015120000_workflow_handoffs` 与默认流程定义已在隔离环境验证。已有事项、开发任务、交付或修改过系统流程的数据库会拒绝迁移，须使用新数据库或新 schema 初始化；不提供旧业务数据转换，不自动清表。

现有业务数据库未升级或清理，已有 session、source、Git 和 Worktree 路径未移动。部署不包含在本轮代码与回归交付中。
