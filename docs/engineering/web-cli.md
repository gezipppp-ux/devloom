# TAPD Web CLI contracts

> Production HTTP now uses authenticated Fastify sessions and private workspace authorization; history reads SQLite. See [accounts-and-database.md](./accounts-and-database.md). Historical JSON/JSONL references below name logical record types or explicit fixtures. The execution, Git identity and channel transition invariants continue to apply.

> 工作区版：参见 [workspaces.md](./workspaces.md)。生产 Web 的 API 均在 `/api/workspaces/:workspaceId` 下，配置/运行/上传/事件独立。本文旧全局路径仅对应单管理器测试及显式 CLI 配置，不是数据迁移约定。


## 1. Scope / trigger

Applies to `src/codex/app-server-client.cjs`, `src/application/session-manager.cjs`, `src/storage/run-store.cjs`, `src/http/server.cjs` and `web`. The standalone local Vue console uses Codex app-server JSON-RPC, not a PTY or a deployed NestJS service.

Process startup lives in `src/cli/web.cjs`. The HTTP module exports an inert server factory and adapts application services. Session commands, event handling, queries and public response shapes are separated in `src/application/`; disk formats remain in `RunStore`, and repository/worktree identity checks live in `src/git/`. Shutdown stops accepting requests before closing SSE and session managers, so EventSource reconnections cannot keep the service alive.

Closing a session manager fences in-flight validation/resume/start operations, drains already-started channel callbacks and transport shutdown, then releases ownership. `AppServerClient.close()` is terminal; accidental disconnects can reconnect. A completed first turn cannot start another turn until the execution runner finishes persisting its result and releases its lock; steering an active first turn remains supported.

## 2. Signatures

- `npm run tapd:web -- [--host 0.0.0.0] [--port 4317]` builds assets and starts HTTP. CLI startup defaults to `0.0.0.0` for direct IPv4 LAN access; `--host 127.0.0.1` limits access to the local machine. `--config` remains CLI-only and is rejected by Web startup.
- `npm run dev -- [--host 127.0.0.1] [--port 5173]` serves Vite HMR, API and SSE through one HTTP server, retaining origin and token checks. Development also accepts port `0` for an ephemeral port. `npm run dev:watch` accepts the same arguments and restarts this child after backend CJS/shared JSON changes, requesting shutdown over IPC before replacement. A backend restart interrupts active turns and initialization, preserves recorded identities, and lets Vite reconnect and reload the page with a fresh bootstrap token. It never automatically resumes or redispatches a requirement. Frontend HMR alone does not restart the backend. Production startup, CSP and static assets remain unchanged.
- `GET /api/bootstrap` returns `{token,workspace,channels}`; `GET /api/runs` returns `{runs}`.
- `GET /api/stories?workspace=&query=` and `/api/users` reuse saved TAPD credentials server-side.
- `POST /api/runs {id,workspace,developer,tester,supplementaryInstructions?,model?,reasoningEffort?,permissionMode?}` returns `{key,accepted:true}` after validation; preparation then proceeds asynchronously. Manual requirements use the same execution settings. TAPD accepts optional `supplementaryInstructions` text (up to 60000 characters, trimmed; blank or omitted keeps existing behavior). It is saved as `workitem.supplementary_instructions` and appended separately to the first Codex prompt without changing upstream TAPD content. Nonblank supplements may supply execution content when the original description and images are empty. The requirement DTO exposes `supplementaryInstructions` as escaped plain text, including snapshot fallback; the creation form clears it when channel, project or requirement ID changes.
- `GET /api/execution-options` returns `{permissionModes:[{id,label,description,available,reason?}]}`. Permission IDs are `ask`, `auto`, `full`; omitted creation permission defaults to `ask`.
- `POST /api/runs/:key/execution-settings {model?,reasoningEffort?,permissionMode?}` saves a validated patch and returns `{executionSettings:{model,reasoningEffort,permissionMode},pending:boolean}`. Reject unknown fields, invalid values and unsupported native auto review.
- `GET /api/runs/:key` returns normalized history, live overlay, requests, status, readOnlyReason, images, requirement and nextCursor. Detail and list also expose `executionSettings` (next-turn selection), `activeExecutionSettings` (active turn selection or null), and `settingsPending` (an active turn uses different settings). `requirement` contains full saved description/Markdown/prompt, source URL, captured timestamp, safe image routes and snapshot fallback warning; never expose the whole task JSON or credentials. `GET .../history?cursor=` returns `{items,nextCursor}`.
- `POST .../messages {text?,images?:string[]}` sends or steers. Text is at most 60000 characters; either nonblank text or at least one image is required. `images` contains at most 20 distinct image IDs uploaded to this run. Existing text-only clients remain compatible. `POST .../interrupt {}` stops the current turn.
- `POST .../message-images` uploads a raw PNG/JPEG/WebP body of at most 10 MiB and returns `{id,name,size,contentType,url}`. `GET .../message-images/:id` serves the recorded attachment in the same workspace/run. Uploading does not start or resume a Codex turn.
- `POST .../responses {requestId,decision:'accept'|'decline'}` or `{requestId,answers:{questionId:text}}` resolves a pending request.
- `GET /api/events` is SSE; `GET .../images/:index` serves only recorded images under the run directory.

## 3. Contracts

- `key` is the validated run identity: numeric workspace/story for legacy TAPD, channel-prefixed hash for other sources. Browser callers cannot submit arbitrary thread IDs. Explicit execution settings accept validated service-host paths; run/image paths remain bound to recorded runs.
- Every POST requires `x-tapd-token` from bootstrap. `src/cli/web.cjs` defaults to `0.0.0.0`; the `createWebServer()` HTTP factory retains `127.0.0.1` as its internal default for embedding and tests. Explicit `--host` accepts an IPv4/IPv6 literal, including wildcard binds. Validate the Host IP and port against the request socket's local address/port (normalizing IPv4-mapped IPv6), require any Origin to match the validated HTTP origin, and reject cross-site fetches. Forwarded headers never authorize a Host. JSON bodies are bounded to 256000 bytes with streaming UTF-8 decoding; messages are 1–60000 characters.
- Transport initializes with `initialize` then `initialized`; IDs correlate concurrent RPC. Guard child-process listeners by child identity so closure of an old connection cannot kill its replacement.
- Existing threads use `thread/read` then `thread/resume` with the recorded cwd and selected permissions. New runs inject `startSession` into `runExecution`; `thread/start` returns identity, but only `turn/started` authorizes channel transition. TAPD CLI `runRequirement` wraps this shared pipeline.
- Permission mapping is centralized in `codex/permissions.cjs`: `ask` uses `on-request`, reviewer `user`, sandbox `workspace-write`; `auto` uses `on-request`, reviewer `auto_review`, the same sandbox; `full` uses `never`, reviewer `user`, sandbox `danger-full-access`. Each `turn/start` explicitly sets approval policy, reviewer and `sandboxPolicy`, so reducing permissions does not inherit a previous full-access turn. Limited turns use the recorded worktree as writable root and disable network access. Native Codex remains responsible for enforcement and any managed policy restrictions.
- Confirm `auto_review` support by generating the installed executable's stable protocol schemas, checking start/resume/turn fields, and caching by executable identity. This read-only discovery never creates a thread or executes a requirement. Failure disables `auto`; never substitute automatic acceptance of browser approval requests.
- Save execution preferences in `execution-settings.json` as `{selection,active}` through RunStore atomic writes. Preserve the creation snapshot in `run.json.codex`, session identity, source and recorded paths. Missing preferences use original model/effort and default permission `ask` for legacy records. Session ownership and the same command mutex protect setting changes; refuse removed worktrees, foreign owners and preparation/initialization.
- Settings changes during a running turn or pending approval only save the next-turn selection and publish `execution-settings` SSE. They do not resolve approvals or interrupt/steer a turn. Supplementary instructions use `turn/steer` with no settings parameters. The next `turn/start` applies the latest saved settings on the same thread/worktree. Clearing a model/effort resolves the effective native config or catalog default into concrete turn values, because omitted/null fields can retain prior thread overrides. Fail visibly if defaults cannot be resolved.
- New Web runs validate the Codex executable before claiming ownership or preparing a worktree. Changing a worktree root does not remove existing Git branches or stale registrations. Branch conflicts must preserve previous work and explain cleanup; never force-delete/reuse a branch or redispatch an uncertain run automatically.
- During `initializing`, SSE command items expose live worktree initialization output; snapshots restore them from `run.json` even before a Codex session exists. Sending messages stays disabled. Interrupt aborts the initialization process tree and service shutdown aborts pending preparation. Failed initialization never dispatches Codex or transitions the source. No initialization executes when saving settings or resuming an existing session.
- Input is `[{type:'text',text,text_elements:[]}, ...{type:'localImage',path}]`, omitting the text part for image-only messages. Active turns use `turn/steer` with `expectedTurnId`; subsequent turns use `turn/start` on the original thread. Stop uses `turn/interrupt`.
- Conversation attachments are channel-independent and persisted under the owning run, separately from the original requirement snapshot. Accept only server-generated image IDs belonging to that run, never browser-supplied paths or URLs. Uploads and sends respect session ownership, preparation, read-only state and pending approvals. History and SSE expose attachment URLs through the application presenter, preserving images on refresh and reconnect without exposing arbitrary local files.
- The composer accepts clipboard image files and file selection, previews/removes attachments, and supports image-only sends. Ordinary text paste keeps native textarea behavior. Enter sends, Shift+Enter inserts a newline, and IME confirmation or repeated keydown events never send. Uploading or failed attachments block both the send button and Enter until resolved; upload retry and failed sends retain the draft. Async uploads and successful sends stay scoped to the original workspace/run selection and cannot mutate a newly opened draft.
- History uses `thread/items/list {threadId,limit:50,sortDirection:'desc',cursor?}`. Reverse each page for chronological rendering. Preserve pagination cursor when refreshing an expanded history.
- SSE events have `{key,at,type,status,sessionId,turnId,...}`; `item` contains a normalized item; `requests` contains currently valid server requests. Reload fetches canonical history plus live items; pending approvals are never silently replayed after disconnect.
- The browser ignores superseded view/list responses and preserves newer SSE fields, metadata and items received while a snapshot is pending. Initial selection follows the same rule, and history pagination remains scoped to its selection. A delayed snapshot must not resurrect an ended turn or an already resolved approval.
- Render escaped text, including tool output. Bound long text/output. `web-events.jsonl` stores item metadata rather than duplicating the whole growing output for every token.
- Requirement details are a deliberate full-content exception to output truncation: read requirement.json with tapd-task.json legacy fallback, and fall back to run.workitem if the task snapshot is missing/corrupt. Render Markdown/HTML only through the dedicated DOMPurify allowlist; remove scripts, frames, event handlers and styles, allow only safe link protocols, and replace image sources with validated local task image routes. Unmapped images refer readers to local attachments and must not trigger remote requests. Full Codex prompt remains escaped text. Browser regressions cover unsafe HTML, local images, Markdown and legacy/current snapshots; store tests protect long content from truncation.
- Preserve CLI `run.json`; execution and TAPD transition are independent. `web-session.json` holds Web metadata. Validate original Git worktree registration, branch and `.git` before continuation. `web-owner.json` fences other Web processes; `.lock` fences legacy CLI ownership.
- Serialize `run.json` mutations with the short-lived `run.json.lock` directory. Continuation updates only execution fields; channel synchronization updates only transition fields against the latest saved record, including transition-only CLI retries. Use unique temporary files and atomic rename. Never hold this write lock across network calls. A lock left by a crashed writer fails closed with its path; remove it only after confirming all writers have stopped.
- Reclaim dead Web owners under the exclusive `web-owner-recovery` guard, rereading ownership inside it. A leftover recovery guard also requires checking stopped services before cleanup. Continuation must verify the target directory's actual Git common directory, branch and worktree backlink, not just a stale registration. After awaiting initial channel synchronization, completion handlers must still belong to the current turn before updating runtime or execution state.

## 4. Validation & error matrix

| Condition                     | Result                                        |
| ----------------------------- | --------------------------------------------- |
| Removed/unregistered worktree | History readable, mutations refused           |
| Active external CLI/Web owner | No concurrent resume/start                    |
| Unknown/expired request ID    | No response forwarded                         |
| Unsupported server request    | JSON-RPC error, visible UI error, no approval |
| Wrong origin/token            | HTTP 403                                      |
| Invalid body/fields           | HTTP 400                                      |
| Missing run/asset             | HTTP 404                                      |
| RPC timeout/disconnect        | Explicit error, no automatic redispatch       |
| History unavailable           | Warning with legacy CLI event fallback        |

## 5. Good / base / bad cases

- Good: interrupt turn A, send another instruction, start turn B in the same thread/worktree.
- Base: open completed CLI history without resuming or executing anything.
- Bad: a leftover folder after Git worktree removal must not authorize continuation in the root checkout.

## 6. Required tests

`test/integration/web-sessions.test.cjs` covers RPC correlation, process exit/reconnect, same-thread followups, live deltas, steer/interrupt, startup ordering with images, questions/approval, worktree/ownership fences, pagination and HTTP UTF-8/origin/token/SSE. `session-settings.test.cjs` additionally covers setting validation, staging, permissions, persistence, identity preservation and write failures. `test/browser/session.cjs` uses a fake protocol client and real built page to exercise send/steer/stop/continue, requests, next-turn settings, reload and mobile layout. Existing runner tests protect TAPD preflight/write verification.

## 7. Wrong vs correct

Wrong: create a fresh session on every browser message, or transition TAPD as soon as `thread/start` returns.

Correct: retain `session_id`, resume it once, submit turns on that ID, and call the runner's `onStarted` only from an actual `turn/started` notification.
