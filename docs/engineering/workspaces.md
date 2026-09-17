# Application workspaces

## Model and storage

One application workspace owns one repository and one configuration. Application UUIDs are distinct from TAPD numeric project IDs and task worktrees. The production Web server never imports the old global config/runs/uploads. No migration is required.

`<dataRoot>/workspaces/<UUID>/config.json` contains `version:3`, `workspace:{id,name,icon?}`, `codex`, `tapd`, `workflow`. Runs and staged uploads live in sibling `runs/` and `uploads/`. Workspace IDs are server-generated UUID v4 values; names are display text, never paths. Names must be nonempty, at most 80 characters and unique. Renaming retains UUID, config, runs and sessions. JSON mutations use temporary files and atomic rename. Workspaces are Git-ignored.

Each context owns its channels, RunStore, WebSessions and lazy Codex client. Switching clients/pages does not close contexts or stop background execution. Shutdown closes every instantiated manager. Workspace selection is carried in URLs, never mutable server-global active state. Independent tabs must remain independent.

When opening the root URL without a workspace parameter, persist the automatically selected workspace with `history.replaceState`, retaining other query parameters and the fragment. Later catalog additions or renames must not change that tab's workspace on refresh.

The Web shell uses an icon rail for workspace selection next to the project/session pane. Icons expose full names through accessible labels and titles, mark the current workspace, and disambiguate repeated initials with a small index. Create and rename use a keyboard-accessible modal; Escape cancels without saving. The rail scrolls vertically on desktop and horizontally on narrow screens. Long project names truncate visually while retaining the full title. Navigation changes must preserve workspace URLs, session identity and background execution.

Workspace icons come from a curated 40-icon SVG component catalog (`@antdv-next/icons`). `shared/workspace-icons.json` defines IDs and Chinese/English search metadata shared by server validation and the Web picker. Persist only an allowed string ID, or null for the default name initial; omitted icon preserves the current selection. Arbitrary SVG, URLs and unknown IDs are rejected before writing. The edit/create dialog provides search, preview and reset. Icon changes do not modify credentials, project settings or session identities.

## API

- `GET /api/bootstrap` returns `{token,workspaces:[{id,name,icon}]}`.
- `GET /api/workspaces` lists workspace summaries without credentials.
- `POST /api/workspaces {name,icon?}` creates an empty workspace.
- `POST /api/workspaces/:id {name,icon?}` updates its display name and icon.
- All settings, refs, requirements, users, runs, messages, interrupts, approvals, images, uploads, bootstrap and SSE use `/api/workspaces/:id/<existing route>`. This includes `execution-options` and per-run `execution-settings`; model/permission updates cannot address a run in another workspace.
- Missing workspace context is rejected. Unknown UUIDs return 404; malformed UUIDs cannot construct paths.
- SSE is delivered only to clients subscribed to the emitting workspace manager. Attachment URLs carry the workspace prefix; image path validation remains inside the selected RunStore.
- Same-origin, loopback Host and POST token protection apply to creation, settings and Cookie checks as well as execution.

The injected `manager` server option is a single-context test harness; production startup never uses it to load old records.

## Configuration and execution

`GET/POST .../settings` expose validated repository, worktreeRoot, baseRef, initCommands and read-only platform. Workspace settings update `config.json` and preserve TAPD credentials and metadata. All channels use this one repository; per-channel repository maps are ignored for workspace configurations. Existing sessions and recorded paths remain authoritative.

New branches use `codex/<workspace UUID>/<channel task name>`, paths use `<configured root>/<repository hash>/<workspace UUID>/<task folder>`. Thus identical requirements and custom names in two workspaces cannot collide. Existing source identities retain channel/scope/item meaning inside their workspace; run records additionally persist `workspace_id` for the application UUID.

CLI `--app-workspace <UUID>` / `RUNNER_WORKSPACE` selects the same config and runs. `--workspace` is still a TAPD project ID. Web rejects `--config` and uses the workspace catalog under RUNNER_DATA_DIR.

## Codex model, reasoning and permissions

`GET .../models` reads the current workspace client's `model/list` with pagination. Expose only model ID, display label, supported reasoning efforts, default effort and `isDefault`. Filter hidden models; reject malformed pagination. Discovery never starts a thread/turn or closes the shared client.

`POST .../runs` accepts optional `model`, `reasoningEffort` and `permissionMode` strings for both TAPD and manual requirements. Each new requirement form defaults to blank model/effort (local Codex defaults) and `ask` permission. The linked dropdowns retain current draft values on discovery failure, allow retry, and clear an unsupported effort when changing model. An explicit effort requires a concrete model. Every submitted explicit selection is validated against the catalog before resolving the channel or claiming a run; blank model/effort is resolved against effective config and catalog defaults before starting a turn. Unsupported combinations and invalid types are rejected.

Workspace settings neither expose nor accept model/effort. Old workspace values are ignored when starting Web tasks and removed on the next project settings save; existing run snapshots remain untouched. New Web runs snapshot model, reasoning effort and permission mode in `run.json.codex`. Subsequent choices live in `execution-settings.json`, with current and next-turn semantics defined in [web-cli.md](./web-cli.md). Each new turn explicitly sends resolved model/effort and selected approval/sandbox settings on the same thread. Run summaries retain the original `codex` model/effort for context and expose current choices separately as `executionSettings`, `activeExecutionSettings` and `settingsPending`. CLI supplies `-c model_reasoning_effort=...` as an argument for explicit CLI configuration. Verify same-workspace task isolation, defaults ignoring stale settings, invalid selections, offline discovery, both input channels, active-turn staging and continuation after reconnect.

## TAPD settings contract

Channel-specific validation and credential maintenance live in `src/channels/tapd/settings.cjs`. Other execution/session code remains source-independent.

- `GET .../settings/tapd`: `{workspaceId,hasCookie,targetStatus,imageHosts}`; never return Cookie or DSC token.
- `POST .../settings/tapd`: accepts `{workspaceId,cookie?,clearCookie?,targetStatus?,imageHosts?}`. Blank/omitted Cookie preserves the existing secret; `clearCookie:true` removes it. A supplied Cookie must be single-line, bounded, and include `dsc-token`. Rebuild the session using the shared auth utilities, preserve other workspace configuration.
- `POST .../settings/tapd/check`: validates and checks the draft with a one-item read-only TAPD todo request. Blank Cookie uses stored credentials. Return a bounded success message or sanitized failure; never echo upstream response text or secrets. Do not save, create a task, start Codex or perform a workflow mutation. Empty todo lists count as successful API access, not proof of individual requirement write permission.
- TAPD project binding is displayed read-only in the task form. The adapter validates search, user lookup and task resolution against the saved binding; changing the request body cannot escape it.
- TAPD saves take effect immediately; existing executions retain the config/session captured at dispatch. Project execution changes affect new runs.

## Verification

Run lint, unit tests, build and both browser suites through `npm run test:web`. `test/integration/workspaces.test.cjs` exercises same-requirement execution in shared repositories with real temporary worktrees and separate fake clients, interruption independence, settings and uploads, SSE/HTTP scope, credential masking/preservation/clearing, draft checks, expired/non-JSON responses, atomic persisted reload and invalid IDs. `test/browser/workspaces.cjs` exercises the actual create/switch/rename/settings flows, Cookie draft success/failure, bound TAPD project, per-task model selection, manual images and background execution across switching/reloading. No live requirement or TAPD mutation is permitted for validation.


## Local task classification and human progress

`shared/task-metadata.json` defines local task types (requirement/bug/other) and human progress (in_progress/review/merge/done/on_hold). These are separate from Codex execution and channel workflow states. New Web tasks default to in_progress; subsequent completion, interruption, failure and continuation never mutate the human choice.

Optional `metadata:{type?,progress?}` on POST runs is validated before resolving the source and removed from channel input. After ownership is claimed it is saved before asynchronous preparation. Each run stores classification in `task-metadata.json`, separately from execution-owned run.json and web-session.json, using atomic writes. Existing records read default requirement/in_progress (bug if the original item type is bug) without migration writes or inference from execution results.

`POST .../runs/:key/metadata {type?,progress?}` updates existing records with whitelisted enums, preserving omitted fields. Token/origin checks and workspace scoping apply. Missing run returns 404; invalid fields return 400 without writes. Local labels remain editable even when the original worktree is unavailable; updating them does not resume Codex, claim execution ownership, move files or change the upstream source. Lists and details return a metadata object. A scoped SSE event `{type:"metadata",key,metadata,at}` updates classification without overwriting runtime status, turn IDs or messages.

The sidebar offers type/progress/no grouping, collapsible groups with counts, and separate type/progress badges plus Codex execution text. Browser storage remembers grouping per workspace. Only user-selected metadata is persisted; grouping does not change task ownership or identity. Verify rejection, source isolation, defaults, full-pipeline completion/continuation preserving human progress, HTTP scope and SSE, both start channels, grouping, cross-tab updates, reload and mobile layout.
