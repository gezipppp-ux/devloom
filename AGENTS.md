# Web Coding

Standalone Node.js 22.13+ CommonJS backend and Vue 3 Web console for requirement channels and Codex sessions.

- For implementation, refactoring and code review, apply the repository skill [.agents/skills/web-coding-engineering/SKILL.md](.agents/skills/web-coding-engineering/SKILL.md). For Vue UI work, also apply [.agents/skills/web-coding-ui/SKILL.md](.agents/skills/web-coding-ui/SKILL.md); it uses repository-owned design tokens and does not require a personal skill installation.
- Read `README.md`, `docs/engineering/index.md`, and the relevant engineering contracts before editing.
- Current production account ownership, Fastify/SQLite persistence and settings scopes follow `docs/engineering/accounts-and-database.md`, which supersedes historical anonymous HTTP and JSON/JSONL storage descriptions.
- Keep channel-specific behavior in `src/channels/`; execution, worktrees and session transport remain generic.
- Follow `docs/engineering/architecture.md` for module ownership and dependency boundaries. Use kebab-case JS/CJS filenames, PascalCase Vue components, and place tests under `test/architecture`, `test/unit`, `test/integration` or `test/browser`.
- Keep process entrypoints, argv and terminal output in `src/cli/`; imported entrypoints must be inert. HTTP adapts application services; storage owns disk formats, Git owns repository operations, and application presenters own public response shapes. Do not re-export unrelated helpers or bypass the architecture tests.
- Run `npm run lint`, `npm test`, `npm run build`; Web changes also require `npm run test:web`.
- Tests use fake Codex clients and temporary Git repositories. Never execute a real requirement or modify TAPD to validate implementation changes.
- Local credentials, uploads, runs, logs and screenshots are ignored. Never commit `config/*.local.json`, `state/` or `runs/`.
- Preserve existing session identities, recorded worktree paths and source state. Do not move business worktrees when changing application installation paths.
- Use Conventional Commits with Chinese descriptions.
