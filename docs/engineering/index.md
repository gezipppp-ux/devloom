# DevLoom Contracts

Scope: the independent `devloom` Node.js 22.13+ CommonJS application. Install from its own package-lock.json using npm ci. NestJS and Vben modules are not dependencies. Playwright is used for isolated browser verification.

工作区模型以 [workspaces.md](./workspaces.md) 为准；它取代下述历史全局 Web 配置和运行目录约定。

## Before development

- 会话内 HTML 预览、调整面板、状态持久化及反馈续聊遵循[交互预览契约](./session-previews.md)。已确认「随聊调整」布局；Agent 适配与宿主渲染分离。

- 事项职责、节点处理动作、个人工作台三栏、统一通知和指定交付验证人遵循[流程动作契约](./workflow-actions.md)。这取代旧的参与人/开发负责人混用与首页按资源类别分栏规则。

- 系统供应商、原生直连、密钥及下一轮会话切换遵循 [Agent 供应商](./agent-suppliers.md)；首期仅实现 Codex，不提供路由转换。

- 外部 Agent 的 MCP 接入、个人 Token 和临时令牌 HTTP 附件上传与公开 Skills 指南遵循 [MCP 契约](./mcp.md)；不复用浏览器 CSRF token，也不自动启动开发。

- 当前版本仅支持全新部署，不兼容或迁移旧数据。数据库使用单一安装基线，旧 PostgreSQL 迁移链及 SQLite 脚本已删除；运行时不推断旧来源或回退旧任务文件。以 [PostgreSQL 接入](./postgresql.md) 为准。

- 发布版本、可编排事项流程和先认领后启动的开发任务以[生命周期 PRD](../prd/project-lifecycle.md)为准，取代历史固定状态和从事项直接执行的交互。流程归属系统设置，管理员统一发布，项目只使用已发布版本；最新验收见[系统流程记录](../reviews/system-workflows-2026-10-12.md)。

- 项目协作目标与分项进度见 [PRD](../prd/project-collaboration.md) 和[实施清单](../prd/project-collaboration-implementation.md)。已确认 PostgreSQL + Prisma、平铺部门和项目权限；各阶段完成前不得把目标需求当作已上线能力。Prisma 基础约定见 [PostgreSQL 接入](./postgresql.md)。

- 项目级 Skills 位于 [工程规范](../../.agents/skills/web-coding-engineering/SKILL.md) 和 [界面规范](../../.agents/skills/web-coding-ui/SKILL.md)，由根目录 AGENTS.md 引用。Skill 提供实施与审查流程，本文所列契约维护详细业务约定；两者随实现同步更新。

- Read [accounts-and-database.md](./accounts-and-database.md) for current account ownership, setting scopes, PostgreSQL persistence, authentication and schema/seed lifecycle. It supersedes historical production JSON/JSONL storage and anonymous HTTP descriptions in the older contracts; native execution/Git locks and session identity rules remain in force.

- Read [architecture.md](./architecture.md) for module ownership, dependency direction, directory layout and test placement before adding or moving code.

- For visual changes, read [ui-design.md](./ui-design.md). Use shared design tokens and form sections across pages; validate responsive screenshots with fixture data.

- [B 方案 UI 重构](../prd/ui-refactor.md)已获用户确认并接入正式 Vue。新的 UI skills 依据选定方案重写；跨项目聚合、交付验收和国际化遵循[实施记录](../prd/ui-refactor-implementation.md)。

- Read `README.md` and the task PRD/design for CLI and configuration contracts.
- For Web CLI changes, read [web-cli.md](./web-cli.md) for session identity, streaming, approval and HTTP contracts.
- For source integration, settings or portability changes, read [channels-and-settings.md](./channels-and-settings.md).
- 日常 npm 命令为 `init:admin`、`dev`、`dev:watch`、`build` 和 `start`；Prisma 使用 `db:generate`（生成客户端）和 `db:deploy`（部署版本化迁移）。生产环境先构建再启动，通过 `/setup` 完成首次初始化。运行参数由对应入口解析。
- `npm run dev` serves Vite HMR and the API on one development port; `npm run dev:watch` also restarts the backend after source changes. The watch supervisor must shut down its child over IPC and wait for exit before replacement, including on Windows. Neither command automatically resumes interrupted requirements.

## Behavioral invariants

1. Only the manual source adapter is registered. Removed TAPD routes and settings must not return or fetch external source data.
2. Preserve historical source identities, snapshots and session directories. Do not replay uncertain work or contact retired sources.
3. Validate all uploaded images before dispatch and send them as local PNG/JPEG/WebP attachments. Never silently omit failed or unsupported images.
4. One requirement run owns one persistent CLI session, one identity-scoped `codex/<12-hex-id>` branch and one checkout directly under its configured worktree root as `<prefix-up-to-16>-<12-hex-id>`. The identity includes repository, full application workspace ID and source channel/scope/ID. Resolve the base commit and record it; preflight Windows checkout path lengths before creating the branch or directory. Do not switch, stash or commit the root checkout, or copy its uncommitted changes/secrets into the worktree.
5. Persist dispatch intent before creating the worktree/process. Lock by workspace/item, and never automatically redispatch an existing or uncertain run. Preserve historical channel-transition records separately from execution.
6. Record `thread.started` first and confirm execution only on `turn.started` for that session. Manual tasks skip external transitions.
7. A transition-only retry requires a recorded session and execution-start timestamp, uses the persisted work-item identity, and does not rerun Codex. A successful or skipped transition is not replayed.
8. Spawn with an argument array, no shell, and stdin for the prompt. Remove TAPD credential environment variables. Default model selection comes from the user's Codex configuration. Web defaults to workspace-write with user approval; explicit per-task permission choices follow the Web CLI contract and take effect only on the next turn.

## Verification

Windows / Linux / macOS 环境和 Jenkins 节点配置见 [platform-verification.md](./platform-verification.md)；CI 矩阵包含 macOS arm64 与 x64，实际覆盖取决于对应节点是否接入并执行；模拟架构参数不能替代实机结果。

Run the direct eslint and Node test commands from Jenkinsfile. Tests use Node's test runner, a fixture Codex process, isolated PostgreSQL and temporary real Git worktrees. Cover removed routes, manual tasks, image validation, failed startup, duplicate suppression and historical identity preservation. Never execute a real requirement for validation.

Web changes also require `npm run build` and the browser scripts in Jenkinsfile (Windows Edge or Linux/macOS Playwright Chromium). Do not start real turns in an already merged requirement to validate the UI.

- [CLI Agent 边界](./agents.md)：执行配置、provider 接口、标准事件、能力声明及无历史兼容约束。
