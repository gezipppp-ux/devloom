# TAPD Runner Contracts

Scope: the independent `web-coding` Node.js 22.13+ CommonJS application. Install from its own package-lock.json using npm ci. NestJS and Vben modules are not dependencies. Playwright is used for capturing an already-authenticated CDP session and browser verification; daily TAPD operations use HTTP.

工作区模型以 [workspaces.md](./workspaces.md) 为准；它取代下述历史全局 Web 配置和运行目录约定。

## Before development

- 项目级 Skills 位于 [工程规范](../../.agents/skills/web-coding-engineering/SKILL.md) 和 [界面规范](../../.agents/skills/web-coding-ui/SKILL.md)，由根目录 AGENTS.md 引用。Skill 提供实施与审查流程，本文所列契约维护详细业务约定；两者随实现同步更新。

- Read [accounts-and-database.md](./accounts-and-database.md) for current account ownership, setting scopes, SQLite persistence, authentication and schema/seed lifecycle. It supersedes historical production JSON/JSONL storage and anonymous HTTP descriptions in the older contracts; native execution/Git locks and session identity rules remain in force.

- Read [architecture.md](./architecture.md) for module ownership, dependency direction, directory layout and test placement before adding or moving code.

- For visual changes, read [ui-design.md](./ui-design.md). Use shared design tokens and form sections across pages; validate responsive screenshots with fixture data.

- Read `README.md` and the task PRD/design for CLI and configuration contracts.
- For Web CLI changes, read [web-cli.md](./web-cli.md) for session identity, streaming, approval and HTTP contracts.
- For source integration, settings or portability changes, read [channels-and-settings.md](./channels-and-settings.md).
- Preserve `tapd.session` and `workflow` settings during authentication refresh. Never commit local credentials, browser state, requirement snapshots or execution logs.
- `npm run tapd:web` builds and starts the service; `npm start` uses built assets. Other CLI scripts use `npm run <script> -- <arguments>`. Resolve explicit input paths against INIT_CWD when available; repository mappings are relative to the configuration file.
- `npm run dev` serves Vite HMR and the API on one development port; `npm run dev:watch` also restarts the backend after source changes. The watch supervisor must shut down its child over IPC and wait for exit before replacement, including on Windows. Neither command automatically resumes interrupted requirements.

## Behavioral invariants

1. TAPD may return either numeric or string zero as its success code, and its `data` may be JSON-encoded. Check nested aggregation responses as well as the outer result. Reject login HTML rather than treating it as empty data.
2. Todo totals can be zero despite nonempty pages. Traverse pages, deduplicate workspace/item identities, and fail on repeated pages or a reached limit. Direct-ID detail and workflow recovery must not require todo membership.
3. Download all HTML/Markdown description images before dispatch. Send local PNG/JPEG/WebP files using individual Codex `--image` arguments. Fail on inaccessible/unsupported images, never silently omit them. `file.tapd.cn` requires the saved Cookie; allow credentials only for `www.tapd.cn` and `file.tapd.cn`, including redirect hops. External attachment hosts require explicit configuration and never receive TAPD cookies.
4. One requirement run owns one persistent CLI session, one identity-scoped `codex/<12-hex-id>` branch and one checkout directly under its configured worktree root as `<prefix-up-to-16>-<12-hex-id>`. The identity includes repository, full application workspace ID and source channel/scope/ID. Resolve the base commit and record it; preflight Windows checkout path lengths before creating the branch or directory. Do not switch, stash or commit the root checkout, or copy its uncommitted changes/secrets into the worktree.
5. Persist dispatch intent before creating the worktree/process. Lock by workspace/item, and never automatically redispatch an existing or uncertain run. Store execution and TAPD-transition states independently.
6. Record `thread.started` first; update TAPD only after `turn.started` for that session. Preflight permitted transitions and required fields before dispatch, reread before mutation, and verify the resulting status after mutation. A process spawn or a session ID alone does not prove execution started.
7. A transition-only retry requires a recorded session and execution-start timestamp, uses the persisted work-item identity, and does not rerun Codex. An already successful transition is not replayed.
8. Spawn with an argument array, no shell, and stdin for the prompt. Remove TAPD credential environment variables. Default model selection comes from the user's Codex configuration. Web defaults to workspace-write with user approval; explicit per-task permission choices follow the Web CLI contract and take effect only on the next turn.

## Verification

Windows / Linux 环境、统一 `npm run verify` 命令和 Jenkins 节点配置见 [platform-verification.md](./platform-verification.md)。

Run `npm test` and `npm run lint`. Tests use Node's test runner, mocked TAPD responses, a fixture Codex process and temporary real Git worktrees. Include coverage for authenticated files/redirects, image-only requirements, failed startup, duplicate suppression and transition retry. Read-only live search/detail/task-preview is appropriate for smoke tests; selecting and executing a real requirement is a separate operation from integrating the runner.

Web changes also require `npm run web:build` and `npm run test:web` (Windows Edge or Linux/macOS Playwright Chromium). Do not start real turns in an already merged requirement to validate the UI.
