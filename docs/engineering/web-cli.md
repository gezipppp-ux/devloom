# TAPD Web CLI contracts

> 工作区版：参见 [workspaces.md](./workspaces.md)。生产 Web 的 API 均在 `/api/workspaces/:workspaceId` 下，配置/运行/上传/事件独立。本文旧全局路径仅对应单管理器测试及显式 CLI 配置，不是数据迁移约定。


## 1. Scope / trigger

Applies to `src/{app_server,web_sessions,web_store,web_server}.cjs` and `web`. The standalone local Vue console uses Codex app-server JSON-RPC, not a PTY or a deployed NestJS service.

## 2. Signatures

- `npm run tapd:web [--config <file>] [--port 4317]` builds assets and serves loopback HTTP.
- `GET /api/bootstrap` returns `{token,workspace,channels}`; `GET /api/runs` returns `{runs}`.
- `GET /api/stories?workspace=&query=` and `/api/users` reuse saved TAPD credentials server-side.
- `POST /api/runs {id,workspace,developer,tester}` returns `{key,accepted:true}` after validation; preparation then proceeds asynchronously.
- `GET /api/runs/:key` returns normalized history, live overlay, requests, status, readOnlyReason, images, requirement and nextCursor. `requirement` contains full saved description/Markdown/prompt, source URL, captured timestamp, safe image routes and snapshot fallback warning; never expose the whole task JSON or credentials. `GET .../history?cursor=` returns `{items,nextCursor}`.
- `POST .../messages {text}` sends or steers; `POST .../interrupt {}` stops the current turn.
- `POST .../responses {requestId,decision:'accept'|'decline'}` or `{requestId,answers:{questionId:text}}` resolves a pending request.
- `GET /api/events` is SSE; `GET .../images/:index` serves only recorded images under the run directory.

## 3. Contracts

- `key` is the validated run identity: numeric workspace/story for legacy TAPD, channel-prefixed hash for other sources. Browser callers cannot submit arbitrary thread IDs. Explicit execution settings accept validated service-host paths; run/image paths remain bound to recorded runs.
- Every POST requires `x-tapd-token` from bootstrap. Validate Host and any Origin; reject cross-site fetches. Bind to `127.0.0.1` only. JSON bodies are bounded to 256000 bytes with streaming UTF-8 decoding; messages are 1–60000 characters.
- Transport initializes with `initialize` then `initialized`; IDs correlate concurrent RPC. Guard child-process listeners by child identity so closure of an old connection cannot kill its replacement.
- Existing threads use `thread/read` then `thread/resume` with the recorded cwd, `approvalPolicy:on-request`, `sandbox:workspace-write`. New runs inject `startSession` into `runExecution`; `thread/start` returns identity, but only `turn/started` authorizes channel transition. TAPD CLI `runRequirement` wraps this shared pipeline.
- New Web runs validate the Codex executable before claiming ownership or preparing a worktree. Changing a worktree root does not remove existing Git branches or stale registrations. Branch conflicts must preserve previous work and explain cleanup; never force-delete/reuse a branch or redispatch an uncertain run automatically.
- During `initializing`, SSE command items expose live worktree initialization output; snapshots restore them from `run.json` even before a Codex session exists. Sending messages stays disabled. Interrupt aborts the initialization process tree and service shutdown aborts pending preparation. Failed initialization never dispatches Codex or transitions the source. No initialization executes when saving settings or resuming an existing session.
- Input is `[{type:'text',text,text_elements:[]}, ...{type:'localImage',path}]`. Active turns use `turn/steer` with `expectedTurnId`; subsequent turns use `turn/start` on the original thread. Stop uses `turn/interrupt`.
- History uses `thread/items/list {threadId,limit:50,sortDirection:'desc',cursor?}`. Reverse each page for chronological rendering. Preserve pagination cursor when refreshing an expanded history.
- SSE events have `{key,at,type,status,sessionId,turnId,...}`; `item` contains a normalized item; `requests` contains currently valid server requests. Reload fetches canonical history plus live items; pending approvals are never silently replayed after disconnect.
- Render escaped text, including tool output. Bound long text/output. `web-events.jsonl` stores item metadata rather than duplicating the whole growing output for every token.
- Requirement details are a deliberate full-content exception to output truncation: read requirement.json with tapd-task.json legacy fallback, and fall back to run.workitem if the task snapshot is missing/corrupt. Render Markdown/HTML only through the dedicated DOMPurify allowlist; remove scripts, frames, event handlers and styles, allow only safe link protocols, and replace image sources with validated local task image routes. Unmapped images refer readers to local attachments and must not trigger remote requests. Full Codex prompt remains escaped text. Browser regressions cover unsafe HTML, local images, Markdown and legacy/current snapshots; store tests protect long content from truncation.
- Preserve CLI `run.json`; execution and TAPD transition are independent. `web-session.json` holds Web metadata. Validate original Git worktree registration, branch and `.git` before continuation. `web-owner.json` fences other Web processes; `.lock` fences legacy CLI ownership.

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

`test/web.test.cjs` covers RPC correlation, process exit/reconnect, same-thread followups, live deltas, steer/interrupt, startup ordering with images, questions/approval, worktree/ownership fences, pagination and HTTP UTF-8/origin/token/SSE. `test/browser.cjs` uses a fake protocol client and real built page to exercise send/steer/stop/continue, requests, reload and mobile layout. Existing runner tests protect TAPD preflight/write verification.

## 7. Wrong vs correct

Wrong: create a fresh session on every browser message, or transition TAPD as soon as `thread/start` returns.

Correct: retain `session_id`, resume it once, submit turns on that ID, and call the runner's `onStarted` only from an actual `turn/started` notification.
