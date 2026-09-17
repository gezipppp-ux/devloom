# Requirement channels and portable execution

> 工作区版：参见 [workspaces.md](./workspaces.md)。生产 Web 的 API 均在 `/api/workspaces/:workspaceId` 下，配置/运行/上传/事件独立。本文旧全局路径仅对应单管理器测试及显式 CLI 配置，不是数据迁移约定。


## 1. Scope / trigger

Applies to `src/channels`, `src/execution/runner.cjs`, `src/config/execution-settings.cjs`, `src/domain/run-identity.cjs`, Git planning and corresponding Web forms in the standalone web-coding repository.

## 2. Signatures

- `ChannelRegistry([channel]).get(id)` and `.list()` provide an explicit extension boundary.
- Channel `resolve(input)` returns `{item,config,session}`; `prepare(context)` returns `{workitem,task,target}`; `transition({session,state,config})` verifies source status. Source-specific credential validation and field mapping remain in adapters.
- `GET /api/requirements?channel=&workspace=&query=` and `GET /api/users?channel=&workspace=&query=` dispatch to the selected source. `POST /api/runs` accepts `channel` (legacy default TAPD).
- `GET /api/settings` returns `{repository,worktreeRoot,baseRef,initCommands,platform}`; `POST /api/settings` accepts only `{repository,worktreeRoot,baseRef,initCommands}` and returns validated canonical settings. Omission preserves initialization configuration for older clients; an empty array disables it.
- `GET /api/settings/refs?repository=<absolute-path>` reads local Git refs for the draft repository without fetch/checkout. Returns `{refs:[{value,label,kind,name}]}`: HEAD, local branches, remote-tracking branches and commit tags. Full ref names disambiguate same-named branches/tags; symbolic remote aliases are omitted. The searchable selector also accepts commit SHA and retains old saved short refs.
- Independent commands: `npm install`, `npm run build`, `npm start -- --port 4317`, `npm test`, `npm run test:web`.

## 3. Contracts

- Core execution/session code must not import TAPD HTTP, user chooser or workflow modules. CLI adapters in `src/cli/tapd/` call explicit channel services or the execution use case in `src/application/tapd-run.cjs`; channel modules never parse process arguments or write terminal output. Add adapters through the composition registry, never load arbitrary modules from browser input.
- `source={channel,scope,id}` persists the origin. TAPD keeps numeric `workspace-id` keys; other channels use channel plus a hash of the scope/ID tuple. Validate keys before constructing any path. Legacy records without source are TAPD.
- Normalized workitems retain `workspace_id` as the scope field for compatibility; other channels may use nonnumeric IDs. Generic task packs use `requirement.json`, falling back to old `tapd-task.json` for history/images.
- Repository selection: channel/scope mapping, legacy TAPD scope mapping, saved Web default, legacy `codex.repository`. Do not infer a target repository from `../../..` or application location. Auth refresh must not invent repository paths.
- Web settings live in `runner.local.json` beside the selected config; only whitelisted execution fields may be exposed or updated. Preserve source credentials byte-for-byte. Settings affect new runs; existing runs keep their recorded session/path/branch.
- Worktree initialization belongs to the generic execution pipeline, after creating the checkout and before starting Codex. `codex.init_commands` / Web `initCommands` are bounded arrays (20 single-line strings, up to 4000 characters each). Empty/legacy configurations skip initialization. Only explicit local settings supply command text; requirement content must never be interpolated. Commands run sequentially in separate host shells (Windows cmd / POSIX sh) at the worktree root, with TAPD environment variables stripped and INIT_CWD set to that root. Any nonzero exit, 15-minute per-command timeout, or abort skips later commands and prevents session creation/source transition. Preserve failed workspaces and do not automatically redispatch. Initialization state and bounded output persist in run.json; initialization.log is capped at 5 MiB. Test real subprocess cwd/order/failure/abort/timeout as well as pipeline ordering and settings compatibility.
- Default worktree root is `~/.codex-workspaces`, overridable by saved `worktreeRoot` or `codex.worktree_root`. Final paths include repository hash and channel-scoped key. Root branch and dirty files must remain untouched.
- Linux paths are case sensitive; Windows drive paths compare case insensitively. Git `worktree list --porcelain -z` avoids quoting ambiguities for Unicode/space paths. Browser paths refer to the service host, not the user's browser machine.
- `RUNNER_DATA_DIR` relocates config/runs without relocating static assets. Package dependencies use real versions; lint/build tools are declared locally. Node 22.13+; avoid PowerShell-only runtime commands.
- `src/codex/command.cjs` resolves both CLI and app-server launch commands: explicit `codex.command`, then `CODEX_BIN`, then service PATH and documented platform installation directories. Invalid explicit overrides fail without fallback. Ignore empty/relative PATH entries; require executable permission on POSIX. Standard npm entry points run with the current Node and argument arrays, never shell wrappers. Windows desktop version paths are discovered without storing a machine-specific path in source. Linux systemd environments may require an explicit PATH/CODEX_BIN; do not assume interactive nvm initialization.
- User selectors debounce remote searches, ignore stale responses, display loading/empty/error states, and clear selected people on source/scope change. Submit exact nick values, not decorated labels. Server revalidates personnel.
- Manual channel requires no TAPD credentials/personnel. Its stable UUID v4 request ID fences retries; title is bounded at 200 characters, Markdown at 60000, and content or images is required. Upload IDs are validated UUIDs, never paths. Raw binary image POST requires the existing origin/token protection and a 10 MiB limit; JSON body limits remain unchanged. Shared image signature validation accepts PNG/JPEG/WebP only. Temporary uploads expire after 24 hours and are cleaned on later uploads; prepare copies images in order into the run directory before dispatch. Transition returns skipped.
- Optional adapter prepare results `worktreeSlug` and `worktreeName` affect new worktree naming only. Manual title slug uses offline pinyin, preserves English words, and adds channel plus 12 hash characters to branches/default folders. Custom name overrides only the last directory component beneath configured root/repository hash; validate 1–64 ASCII alphanumeric/hyphen/underscore characters, alphanumeric first, excluding Windows device names. Reject paths and existing directories; never override root or force reuse. Historical TAPD paths and hashed run identity remain unchanged.

## 4. Validation & error matrix

| Input / condition                         | Behavior                                            |
| ----------------------------------------- | --------------------------------------------------- |
| Unknown channel                           | HTTP 400, no session creation                       |
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
