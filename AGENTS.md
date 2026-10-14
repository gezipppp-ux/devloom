# Web Coding

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
