# Requirement channels and portable execution

> 生产 Web 以项目协作为入口，显式开发任务使用 /api/projects/:id/tasks；会话与代码使用 /api/workspaces/:workspaceId。项目配置通过项目权限和 revision 更新并同步到成员空间。旧全局路径仅供显式 CLI／测试配置，不是迁移或生产兼容入口。


## 1. Scope / trigger

Applies to `src/channels`, `src/execution/runner.cjs`, `src/config/execution-settings.cjs`, `src/domain/run-identity.cjs`, Git planning and corresponding Web forms in the standalone web-coding repository.

## 2. Signatures

- `ChannelRegistry([channel]).get(id)` and `.list()` provide an explicit extension boundary.
- Channel `resolve(input)` returns `{item,config,session}`; `prepare(context)` returns `{workitem,task,target}`; `transition({session,state,config})` verifies source status. Source-specific credential validation and field mapping remain in adapters.
- `agentConfig(configOrState)` exposes `{provider,model,reasoningEffort,permissionMode,startupTimeoutMs,options}`; `executionOptions(config)` exposes repository, worktree, initialization and Git-account settings independently. Only `agent` / `execution` are supported. `agent.provider` must be explicitly configured; `options` holds only provider launch configuration. `taskPrompt(task)` reads only `prompt`. No old configuration or task fields are read, mirrored or migrated.
- `GET /api/requirements?channel=&workspace=&query=` and `GET /api/users?channel=&workspace=&query=` dispatch to the selected source. The production project task API selects the source snapshot; `POST /api/runs` with `channel` exists only in explicit test/CLI harnesses.
- `GET /api/settings` returns `{repository,worktreeRoot,baseBranch,initCommands,platform}`; In explicit test/CLI harnesses, `POST /api/settings` accepts only `{repository,worktreeRoot,baseBranch,initCommands}` and returns validated canonical settings. Omission preserves initialization configuration for older clients; an empty array disables it.
- `GET /api/settings/branches` reads cached origin branches without fetch/checkout. Returns `{branches:[{value,label,name}]}` with short branch names; symbolic aliases, tags, local-only branches and other remotes are omitted. A typed branch need not exist in the cache: execution fetches the exact remote branch. `execution.baseBranch` replaces `baseRef`; HEAD, SHA and ref expressions are rejected, with no compatibility fallback.
- Independent commands: `npm install`, `npm run init:admin`, `npm run build`, `npm start -- --port 4317`; validation uses the direct commands in Jenkinsfile.

## 3. Contracts

- Core execution/session code must not import TAPD HTTP, user chooser or workflow modules. Channel modules never parse process arguments or write terminal output. Add adapters through the composition registry, never load arbitrary modules from browser input.
- Execution selects an explicitly registered agent provider before preparing materials, Git operations or process launch. Only Codex is implemented; unknown explicit provider values fail rather than silently selecting Codex. Missing providers are rejected; new configuration composition explicitly selects Codex. New run snapshots save `agent:{provider,model,reasoningEffort,permissionMode}` and retain all source/session/worktree identities. Provider-specific protocol and launch conversion belong to the provider adapter.
- Channel task packs expose `prompt` and local `images` without CLI flags or vendor-specific prompt semantics. Workspace persistence and `executionConfig` both use `execution` / `agent`; task packs use only `prompt`. There are no vendor aliases or historical fallback reads. Existing data is not automatically migrated or deleted.
- `source={channel,scope,id}` persists the origin. TAPD keeps numeric `workspace-id` keys; other channels use channel plus a hash of the scope/ID tuple. Validate keys before constructing any path. Legacy records without source are TAPD.
- TAPD fusion keeps channel `tapd` and a numeric project scope, but its local task ID is `fusion-<UUID-v4>` and its run key is `tapd-<32-hex-hash>`. Individual TAPD source identities remain numeric and are recorded in the task's ordered `sources` collection. Legacy single-source keys, sessions, branches and paths never change when requirements are appended. Fusion-specific validation, fetching, prompt semantics and image preparation belong to `channels/tapd/`; generic execution only claims the channel-provided source identities.
- TAPD fusion input is `{requestId,title,items:[{id,type?}],supplementaryInstructions?}` in addition to the existing channel/workspace/execution selection. The UI does not ask for a category or relationship. Search results retain their internal types; untyped direct IDs try story, bug and board_card detail reads without depending on todo membership. Only empty/detail-level rejections permit trying another type; transport, outer login and identity failures stop immediately. If all types fail, report the failures instead of omitting a source. Legacy optional `fusionMode:'duplicate'|'sequence'` payloads retain their fingerprints, but no longer control prompt selection.
- Each batch and final task membership allow at most 20 distinct sources from the bound project. Prepare raw sources and preserve order, full metadata and individual image mappings in `task.requirements`. Render the captured `tapd_fusion` template once with the ordered source materials, unified supplement and globally numbered, source-attributed images; never concatenate per-source `tapd` prompts. Both creation and append use this template. A batch allows at most 20 images and a 240000-character complete prompt. Reject any missing/failed material or excess instead of truncating. Repeated creation with the same request and payload returns the existing task; altered payloads cannot reuse that identity.
- Normalized workitems retain `workspace_id` as the scope field for compatibility; other channels may use nonnumeric IDs. Generic task packs use `requirement.json`, falling back to old `tapd-task.json` for history/images.
- Repository selection uses the saved Web workspace configuration. Do not infer a target repository from `../../..` or application location. Auth refresh must not invent repository paths.
- Production settings live in PostgreSQL Project.settings and synchronize to member execution contexts. Only project.configure can update or read sensitive configuration; TAPD credentials are encrypted and masked. Explicit CLI/file fixtures may use runner.local.json. Settings affect new runs and prepared additions; existing runs keep their recorded session/path/branch.
- Worktree initialization belongs to the generic execution pipeline, after creating the checkout and before starting the selected agent. `execution.initCommands` / Web `initCommands` are bounded arrays (20 single-line strings, up to 4000 characters each). An empty initialization configuration skips initialization. Only explicit local settings supply command text; requirement content must never be interpolated. Commands run sequentially in separate host shells (Windows cmd / POSIX sh) at the worktree root, with TAPD environment variables stripped and INIT_CWD set to that root. Any nonzero exit, 15-minute per-command timeout, or abort skips later commands and prevents session creation/source transition. Preserve failed workspaces and do not automatically redispatch. Initialization state and bounded output persist in run.json; initialization.log is capped at 5 MiB. Test real subprocess cwd/order/failure/abort/timeout as well as pipeline ordering and settings compatibility.
- Production project member roots use <memberStorageRoot>/projects/<projectId>/members/<userId>; each accepted preparation uses repository-<space-revision>, and worktree remains a fixed child directory. Failed preparation directories are retained; an explicit retry gets a new directory, while ready spaces keep their recorded repository path. Each task uses one direct child <prefix-up-to-16>-<12-hex-task-id> below worktree. UUIDs determine the boundary, and names never relocate it. Recorded existing session, branch and path remain unchanged. Root branch and dirty files must remain untouched.
- Linux paths are case sensitive; Windows drive paths compare case insensitively. Git `worktree list --porcelain -z` avoids quoting ambiguities for Unicode/space paths. Browser paths refer to the service host, not the user's browser machine.
- `RUNNER_DATA_DIR` relocates config/runs without relocating static assets. Package dependencies use real versions; lint/build tools are declared locally. Node 22.13+; avoid PowerShell-only runtime commands.
- `src/codex/command.cjs` resolves both CLI and app-server launch commands: explicit `agent.options.command` for the Codex provider, then `CODEX_BIN`, then service PATH and documented platform installation directories. Invalid explicit overrides fail without fallback. Ignore empty/relative PATH entries; require executable permission on POSIX. Standard npm entry points run with the current Node and argument arrays, never shell wrappers. Windows desktop version paths are discovered without storing a machine-specific path in source. Linux systemd environments may require an explicit PATH/CODEX_BIN; do not assume interactive nvm initialization.
- TAPD is read-only: `capabilities.assignees` is false; resolve does not require personnel or enable workflow writes, prepare does not read workflow, and transition always returns skipped. Search includes all todo types and statuses; the application presenter adds local run progress within the current workspace. Old workflow configuration never authorizes writes.
- For channels that require assignees, user selectors debounce remote searches, ignore stale responses, display loading/empty/error states, and clear selected people on source/scope change. Submit exact nick values, not decorated labels. Server revalidates personnel.
- Manual channel requires no TAPD credentials/personnel. Its stable UUID v4 request ID fences retries; title is bounded at 200 characters, Markdown at 60000, and content or images is required. Upload IDs are validated UUIDs, never paths. Raw binary image POST requires the existing origin/token protection and a 10 MiB limit; JSON body limits remain unchanged. Shared image signature validation accepts PNG/JPEG/WebP only. Temporary uploads expire after 24 hours and are cleaned on later uploads; prepare copies images in order into the run directory before dispatch. Transition returns skipped.
- Optional adapter prepare results `worktreeSlug` and `worktreeName` supply the task directory prefix only. Manual title slug uses offline pinyin and preserves English words; the planner truncates automatic prefixes to 16 characters and removes trailing separators. Custom prefixes accept 1–16 ASCII alphanumeric/hyphen/underscore characters, alphanumeric first, excluding Windows device names. The planner always appends a 12-hex digest of canonical repository identity, full application workspace ID and source channel/scope/ID. Branches use only `codex/<digest>`, independent of title/prefix. Reject paths, existing directories and branches; never override root or force reuse. No legacy naming fallback or migration is implemented; source/run identities remain unchanged.

## 4. Validation & error matrix

| Input / condition                         | Behavior                                            |
| ----------------------------------------- | --------------------------------------------------- |
| Unknown channel                           | HTTP 400, no session creation                       |
| Unknown agent provider                    | Explicit error before material/Git/process side effects |
| Missing target repository                 | Explicit settings error, no guessed parent checkout |
| Relative Web path / Windows path on Linux | Rejected                                            |
| Invalid Git root/ref / unwritable root    | Settings save rejected                              |
| Extra settings keys                       | Rejected, credentials unchanged                     |
| Removed original worktree                 | Read-only history, no relocation                    |
| Unconfirmed execution start               | No source transition                                |
| Same ID from different sources            | Distinct run/worktree identities                    |

## 5. Good / base / bad cases

Good: a test tracker with `DEV-42` runs without TAPD credentials through the same worktree/session pipeline.
Base: the existing TAPD numeric key continues to display the original historical images/session.
Bad: saving a new root must not move a running or archived worktree or change its session cwd.

## 6. Required tests

`test/integration/channel-isolation.test.cjs`: real Git checkout outside repo; second channel; settings persistence without credential changes; ownership/history compatibility; Windows/Linux path rules; source-aware HTTP and tokens; external data root. Browser tests cover searches, actual nick payloads, stale response suppression, scope resets and save/reload settings. Verify a package copy outside the repository with npm install/lint/test/build so parent tools cannot mask coupling.

## 7. Wrong vs correct

Wrong: the Web controller imports TAPD users and constructs `custom_field_one`, or creates checkouts relative to its own installation folder.

Correct: the controller resolves a registered source, the adapter maps source-specific fields, and the execution core uses configured repository/root with a persisted source identity.
