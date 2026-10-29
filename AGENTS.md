# DevLoom

Standalone Node.js 22.13+ CommonJS backend and Vue 3 Web console for requirement channels and Codex sessions.

- For implementation, refactoring and code review, apply the repository skill [.agents/skills/web-coding-engineering/SKILL.md](.agents/skills/web-coding-engineering/SKILL.md). For Vue UI work, also apply [.agents/skills/web-coding-ui/SKILL.md](.agents/skills/web-coding-ui/SKILL.md) and the project visual reference [.agents/skills/neutral-workbench/SKILL.md](.agents/skills/neutral-workbench/SKILL.md); they use repository-owned design tokens and do not require a personal skill installation.
- Read `README.md`, `docs/engineering/index.md`, and the relevant engineering contracts before editing.
- Current production account ownership, Fastify/PostgreSQL persistence and settings scopes follow `docs/engineering/accounts-and-database.md`, which supersedes historical anonymous HTTP and JSON/JSONL storage descriptions.
- Keep channel-specific behavior in `src/channels/`; execution, worktrees and session transport remain generic.
- Follow `docs/engineering/architecture.md` for module ownership and dependency boundaries. Use kebab-case JS/CJS filenames, PascalCase Vue components, and place tests under `test/architecture`, `test/unit`, `test/integration` or `test/browser`.
- Name all test files, including browser suites and their assertion modules, `<kebab-case>.test.cjs` (for example `test/browser/account-preferences.test.cjs`). Fixtures and shared helpers belong in `test/fixtures` or `test/support` and use `<kebab-case>.cjs`. Update imports, CI commands and documentation when renaming tests.
- Keep process entrypoints, argv and terminal output in `src/cli/`; imported entrypoints must be inert. HTTP adapts application services; storage owns disk formats, Git owns repository operations, and application presenters own public response shapes. Do not re-export unrelated helpers or bypass the architecture tests.
- Run `npx eslint src test web/src web/vite.config.mjs`, `node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs`, and `npm run build`; Web changes also require the browser checks invoked by Jenkinsfile.
- Tests use fake Codex clients and temporary Git repositories. Never execute a real requirement or modify TAPD to validate implementation changes.
- Local credentials, uploads, runs, logs and screenshots are ignored. Never commit `config/*.local.json`, `state/` or `runs/`.
- Preserve existing session identities, recorded worktree paths and source state. Do not move business worktrees when changing application installation paths.
- Use Conventional Commits with Chinese descriptions.

## 代码简洁性约定

1. 防止过度防御：不要为猜测出来、几乎不会发生的竞态或安全边界情况增加复杂度。确有必要时，先说明具体会怎样出错、发生概率及判断依据、预计增加多少代码，经用户同意后再实现；严禁为了“理论上更稳”私自膨胀代码。
2. 控制改动范围：围绕当前任务实施，不要悄悄扩大改动范围。
3. 入口单次校验：外部传入的数据只在入口边界校验一次，向内部传递已经确定类型的值，依靠类型系统流转，禁止层层重复判断或反复做防御性检查。
4. 拒绝提前抽象：单次使用的简单逻辑就近内联，不提前拆分无意义的 helper。只有逻辑会复用、封装了确实复杂的逻辑，或者代表一个能清楚命名的概念时，才抽取函数。
5. 主流程清晰：主函数只写正常流程，校验和细节放到其下方的小函数中；函数拆分仍须符合上述抽象条件，能用单个函数清晰实现的简单逻辑不要硬拆。
6. 控制异常处理：非必要不用 try/catch。
7. 注释说明约束：只注释不明显的约束和反直觉的行为，不给显而易见的代码写注释。
8. 从源头修改生成文件：自动生成的文件不要手改，应修改源头后重新生成。
9. 测试真实实现：测试应调用真实实现，不要把业务逻辑复制一份放进测试；尽量少用 mock。
10. 遵循仓库流程：按仓库现有的流程实施，不引入仓库未使用的工具或流程。
