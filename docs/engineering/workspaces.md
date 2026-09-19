# Application workspaces

> Current production contract: [accounts-and-database.md](./accounts-and-database.md). Workspaces are private to one owner; names are unique per owner. SQLite owns configuration, runs, images and preferences. File names below describe logical record types and explicit file fixtures, not production JSON storage. Global worktree base paths include an immutable member directory before each workspace's relative directory.

## Model and storage

One application workspace owns one repository and one configuration. Application UUIDs are distinct from TAPD numeric project IDs and task worktrees. The production Web server never imports the old global config/runs/uploads. No migration is required.

`<dataRoot>/workspaces/<UUID>/config.json` contains `version:3`, `workspace:{id,name,icon?}`, `codex`, `tapd`, `workflow` and optional `prompt_templates`. Runs and staged uploads live in sibling `runs/` and `uploads/`. Workspace IDs are server-generated UUID v4 values; names are display text, never paths. Names must be nonempty, at most 80 characters and unique. Renaming retains UUID, config, runs and sessions. JSON mutations use temporary files and atomic rename. Workspace data is Git-ignored.

`domain/workspace.cjs` owns identity and input validation; `storage/workspace-store.cjs` owns directory layout and configuration records; `application/workspace-manager.cjs` composes defaults and workspace runtimes. Creation and renaming hold the catalog lock (`workspaces/.catalog.lock`) across name checking and writing, preventing duplicate names across service processes. Individual configuration mutations retain their own short write lock and preserve independently owned settings.

Each context owns its channels, RunStore, SessionManager and lazy Codex client. Switching clients/pages does not close contexts or stop background execution. Shutdown closes every instantiated manager. Workspace selection is carried in URLs, never mutable server-global active state. Independent tabs must remain independent.

When opening the root URL without a workspace parameter, persist the automatically selected workspace with `history.replaceState`, retaining other query parameters and the fragment. Later catalog additions or renames must not change that tab's workspace on refresh.

Switch workspaces in place with `history.pushState`; do not navigate or reload the document. Preserve other query parameters, the fragment and history state, and synchronize selection on `popstate`. Recreate the workspace console by UUID so drafts, requests and SSE subscriptions are scoped to that selection; ignore late responses and stop queued uploads after unmount. Keep the workspace shell visible with a loading state until bootstrap and the initial session list finish, and allow another workspace switch while loading. Saving a name/icon updates the catalog in place and closes the editor without resetting the current console.

The Web shell uses an icon rail for workspace selection next to the project/session pane. Icons expose full names through accessible labels and titles, mark the current workspace, and disambiguate repeated initials with a small index. A gear button beside the project name opens workspace settings; the Basic information section contains the rename action for editing the name and icon. Create and rename use a keyboard-accessible modal; Escape cancels without saving. The rail scrolls vertically on desktop and horizontally on narrow screens. Long project names truncate visually while retaining the full title. Navigation changes must preserve workspace URLs, session identity and background execution.

Workspace icons come from a curated 40-icon SVG component catalog (`@antdv-next/icons`). `shared/workspace-icons.json` defines IDs and Chinese/English search metadata shared by server validation and the Web picker. Persist only an allowed string ID, or null for the default name initial; omitted icon preserves the current selection. Arbitrary SVG, URLs and unknown IDs are rejected before writing. The edit/create dialog provides search, preview and reset. Icon changes do not modify credentials, project settings or session identities.

## API

- `GET /api/bootstrap` returns `{token,workspaces:[{id,name,icon}]}`.
- `GET /api/workspaces` lists workspace summaries without credentials.
- `POST /api/workspaces {name,icon?}` creates an empty workspace.
- `POST /api/workspaces/:id {name,icon?}` updates its display name and icon.
- All settings, refs, requirements, users, runs, messages, interrupts, approvals, images, uploads, bootstrap and SSE use `/api/workspaces/:id/<existing route>`. This includes `execution-options` and per-run `execution-settings`; model/permission updates cannot address a run in another workspace.
- Missing workspace context is rejected. Unknown UUIDs return 404; malformed UUIDs cannot construct paths.
- SSE is delivered only to clients subscribed to the emitting workspace manager. Attachment URLs carry the workspace prefix; image path validation remains inside the selected RunStore.
- Same-origin, socket-local IP/port Host validation and POST token protection apply to creation, settings and Cookie checks as well as execution, including explicit LAN binds.

The injected `manager` server option is a single-context test harness; production startup never uses it to load old records.

## Configuration and execution

### Workspace prompt settings

Prompt templates belong to the selected workspace and are edited in its settings page. `GET/POST /api/workspaces/:id/settings/prompts` use the standard origin and POST token protection. Prompt requests without workspace context are rejected; system settings do not expose root-level prompt configuration.

GET returns `{templates:{manual,tapd},catalog,maxLength:20000}`. Each catalog entry has label, defaultTemplate and placeholders (`name`, `label`, `required`, `example`). POST accepts a partial `{manual:string|null,tapd:string|null}` and returns the same shape; null removes the corresponding override. Store overrides under `prompt_templates` in the selected workspace's `config.json` using atomic read-modify-write. Preserve omitted channels, workspace metadata, credentials and execution configuration; responses never expose credentials. Unconfigured channels use built-in templates. Other workspaces remain unchanged.

Templates use literal `{{name}}` placeholders. Both channels require title/content/images; TAPD additionally requires supplement. Optional image_count/image_list expose the count and ordered list; TAPD also offers id/workspace_id/url. The images value is the full channel-specific explanation/list; supplement is its complete delimited block or empty text. Reject unknown settings keys, invalid types, blank/oversized templates, unknown/malformed placeholders and missing required placeholders before writing. Render once without expression evaluation or expansion of substituted requirement text.

`shared/prompt-templates.json` owns the catalog, domain owns pure validation/rendering, config owns configuration operations, and channel adapters capture effective workspace templates at resolution. Task packages supply channel-specific values from that captured configuration. Workspace application services present the settings API. Saving affects only new tasks in that workspace; persisted prompts, images, identities, paths and follow-up messages remain unchanged. CLI execution and task previews use templates from the selected configuration, including `--app-workspace`. Preview shows fixture text; restoring defaults changes the draft until explicitly saved.

### Workspace execution settings

`GET .../settings` exposes repository, worktreeDirectory, worktreeBasePath, computed read-only worktreeRoot, worktreePathMode (`relative`), baseRef, initCommands and platform. `POST .../settings` accepts repository, worktreeDirectory, baseRef and initCommands; absolute worktreeRoot writes are rejected for workspaces. Store the normalized relative directory as `codex.worktree_directory` in `config.json`, defaulting to `w-<first 8 workspace UUID characters>`. Preserve TAPD credentials and metadata. All channels use this one repository; per-channel repository maps are ignored for workspace configurations. Existing sessions and recorded paths remain authoritative.

New branches use `codex/<12-hex-task-id>`, paths use `<system base>/<workspace relative directory>/<prefix-up-to-16>-<12-hex-task-id>`. The task digest includes canonical repository identity, full workspace UUID and full source channel/scope/ID. The compact workspace default is only a readable prefix; isolation comes from the full task identity. Branch names do not depend on title/custom prefix. Reject existing target paths or branches. Do not add old naming fallbacks or migration logic. Source identities retain channel/scope/item meaning inside their workspace; run records additionally persist `workspace_id` for the application UUID.

On Windows, inspect the resolved target commit before making checkout directories or branches. Check UTF-16 absolute path lengths for tracked files (259 maximum) and checkout directories, including submodule gitlinks (247 maximum), reporting the offending relative path and advising a shorter system base/workspace directory. Read NUL-delimited Git entries with their types without the synchronous output-buffer limit; empty trees that Git does not materialize are ignored. This check does not cover future install/build output and does not alter Git/OS long-path configuration.

### System Worktree storage

`GET/POST /api/system/settings` are global routes available before creating any workspace. They return `{worktreeBasePath,platform}`; POST accepts only `{worktreeBasePath}`. The base defaults to `~/.codex-workspaces` and is persisted atomically in `<dataRoot>/system-settings.json`, separately from all workspace credentials. Require an absolute service-host path, create missing directories on save, verify write access and store the canonical real path. Apply the usual origin/Host checks and POST page token. New runs reload this setting; saving never moves existing paths or changes their sessions.

`GET /api/system/directories?path=<absolute>&offset=0&limit=100` lists host directories, with `{path,parentPath,roots:[{name,path}],directories:[{name,path}],offset,hasMore}`. Limit is bounded to 200. Omitted path selects the saved base if present, otherwise the service user's home. Return only directories, support POSIX root and Windows drive/UNC roots, and report missing/inaccessible locations. It is a server directory browser, not an upload or a browser-machine folder picker.

Relative directory components accept both `/` and `\`, normalize storage to `/`, and use the host path API to join the base and components. Reject absolute paths, empty components, `.`/`..`, control/illegal characters, Windows device names, surrounding whitespace and trailing dots. Validate lexical and real-path containment, including existing symlink ancestors and the full task plan before worktree creation. An absolute path cannot override the base and traversal cannot escape it. CLI explicit non-workspace configs retain their separate worktreeRoot behavior.

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


## Repository updates and Worktree deletion

All Git endpoints remain workspace-scoped and use the standard Host/Origin and POST token protections. No endpoint accepts arbitrary repository paths, remote URLs or Git commands. Repository operations use the saved workspace repository; task operations use the recorded original repository/path/branch, even after workspace settings change.

- `GET .../repository/git` returns repository, baseRef, branch, remote, named remotes, upstream, canUpdate, updateReason and lastFetchedAt/lastFetchedRemote. Remote URLs and credentials are not exposed.
- `POST .../repository/git/fetch {remote}` fetches/prunes only an existing remote. `POST .../repository/git/update {remote?}` fetches the configured upstream and updates the currently checked-out local base branch with `--ff-only --no-overwrite-ignore`. Omitted remote uses that branch's configured remote. Reject dirty/untracked files, detached/non-current/non-local bases, Git operation markers, locks, missing upstream, changed HEAD during fetch and divergence. Never switch, stash, reset, force-push or create a conflict-resolution workflow. Network commands run asynchronously with timeout and interactive credentials disabled.
- `GET .../runs/:key/git` returns path, branch, HEAD, upstream, unpublished, ahead/behind, changedFiles, untrackedFiles, ignoredFiles, clean, statusToken, canDelete and deleteReason, plus recorded deletion progress. changedFiles counts tracked files; the UI adds untrackedFiles for the uncommitted total. Ignored entries may be directories. No remote upstream (including tracking a local branch) means unpublished and null counts. A deleted remote upstream returns unknown counts and a warning; an otherwise verified task can still be removed after explicit risk acknowledgement. Other Git/identity read failures block deletion, never report zero. Refreshing status does not fetch or start Codex.
- `POST .../runs/:key/worktree/delete {expectedHead,statusToken,confirmBranch,discardChanges}` deletes the recorded task Worktree and its local branch. Require full branch-name confirmation and a fresh snapshot. Local/unpublished/unpushed/ignored content requires explicit discard acknowledgement. Reject active/preparing tasks, pending requests, execution locks, another service owner and a Codex session that cannot be verified idle. Claim session ownership and serialize mutations by the real shared Git common directory across workspaces/processes.

Deletion verifies the original Git worktree registration, branch, common directory and backlink, rejects the main checkout, symlink replacements, locked worktrees and unfinished Git operations. Confirmation fingerprints include descendant metadata inside ignored directories without following links. Scanning is bounded; when a complete fingerprint cannot be produced, preserve already verified Git status and disable deletion with a reason rather than accepting a partial token. Use `git worktree remove`, followed by local branch deletion; there is no raw recursive filesystem fallback. Force deletion is limited to explicit discard acknowledgement. Never delete remote branches or infer that task progress is complete.

Persist intent and progress in `worktree-deletion.json` separately from immutable run/session identities. Directory removal and branch deletion are separate recorded stages. Partial cleanup can retry only while the original path remains absent, the branch is not checked out elsewhere and its HEAD still matches the recorded deletion. Restart recovery handles a persisted intent whose directory removal completed before the progress write. Reappearing paths or changed branches block recovery. Deleted tasks remain visible with history/materials and a read-only reason; resume, images and execution-setting writes are rejected even if someone later recreates the old path. Scoped SSE announces deletion so other tabs refresh.

The Web app has no merge or conflict-resolution button. Users instruct Codex in the existing task session when they want merge/conflict work.

## Local task classification and human progress

`shared/task-metadata.json` defines local task types (requirement/bug/other) and human progress (in_progress/review/merge/done/on_hold). These are separate from Codex execution and channel workflow states. New Web tasks default to in_progress; subsequent completion, interruption, failure and continuation never mutate the human choice.

Optional `metadata:{type?,progress?}` on POST runs is validated before resolving the source and removed from channel input. After ownership is claimed it is saved before asynchronous preparation. Each run stores classification in `task-metadata.json`, separately from execution-owned run.json and web-session.json, using atomic writes. Existing records read default requirement/in_progress (bug if the original item type is bug) without migration writes or inference from execution results.

`POST .../runs/:key/metadata {type?,progress?}` updates existing records with whitelisted enums, preserving omitted fields. Token/origin checks and workspace scoping apply. Missing run returns 404; invalid fields return 400 without writes. Local labels remain editable even when the original worktree is unavailable; updating them does not resume Codex, claim execution ownership, move files or change the upstream source. Lists and details return a metadata object. A scoped SSE event `{type:"metadata",key,metadata,at}` updates classification without overwriting runtime status, turn IDs or messages.

The sidebar offers type/progress/no grouping, collapsible groups with counts, and separate type/progress badges plus Codex execution text. Browser storage remembers grouping per workspace. Only user-selected metadata is persisted; grouping does not change task ownership or identity. Verify rejection, source isolation, defaults, full-pipeline completion/continuation preserving human progress, HTTP scope and SSE, both start channels, grouping, cross-tab updates, reload and mobile layout.
