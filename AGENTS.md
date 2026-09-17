# Web Coding

Standalone Node.js 22.13+ CommonJS backend and Vue 3 Web console for requirement channels and Codex sessions.

- Read `README.md`, `docs/engineering/index.md`, and the relevant engineering contracts before editing.
- Keep channel-specific behavior in `src/channels/`; execution, worktrees and session transport remain generic.
- Follow `docs/engineering/architecture.md` for module ownership and dependency boundaries. Use kebab-case JS/CJS filenames, PascalCase Vue components, and place tests under `test/architecture`, `test/unit`, `test/integration` or `test/browser`.
- Keep process entrypoints, argv and terminal output in `src/cli/`; imported entrypoints must be inert. HTTP adapts application services; storage owns disk formats, Git owns repository operations, and application presenters own public response shapes. Do not re-export unrelated helpers or bypass the architecture tests.
- Run `npm run lint`, `npm test`, `npm run build`; Web changes also require `npm run test:web`.
- Tests use fake Codex clients and temporary Git repositories. Never execute a real requirement or modify TAPD to validate implementation changes.
- Local credentials, uploads, runs, logs and screenshots are ignored. Never commit `config/*.local.json`, `state/` or `runs/`.
- Preserve existing session identities, recorded worktree paths and source state. Do not move business worktrees when changing application installation paths.
- Use Conventional Commits with Chinese descriptions.
