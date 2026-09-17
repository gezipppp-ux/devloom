# Web Coding · 需求开发工作台

从 TAPD「我的工作 / 待办」检索需求，拉取完整描述和内嵌图片，为指定需求创建独立 Git worktree 和持久化 Codex CLI session。确认 Codex 开始执行后，将需求流转为「开发中」。

应用已分离需求渠道和执行核心，当前接入 TAPD 和手动输入。包可独立安装；Linux 部署与数据目录见 [部署说明](docs/deployment.md)，新增需求渠道见 [扩展契约](docs/channels.md)。

## 手动输入需求

启动 `npm run tapd:web`，在「从需求启动」中选择「手动输入」。填写标题、Markdown 内容，可上传 PNG/JPEG/WebP 图片（最多 20 张，每张 10 MiB），也支持标题加图片的需求。此渠道不需要 TAPD 登录态和开发/测试人员；先在「执行设置」配置目标仓库即可。沿用 worktree 初始化命令、Codex session、实时对话与历史资料，渠道同步显示「无需同步」。

目录默认按标题生成，英文保留、中文转无声调拼音，例如 `manual-xin-zeng-deng-lu-ru-kou-<短标识>`。可填写「worktree 目录名称（可选）」覆盖最后一级目录，例如 `login-entry`；只能填写 1–64 位英文字母、数字、短横线或下划线，以字母或数字开头，不支持路径或系统保留名称。最终位置仍是 `<配置根目录>/<仓库哈希>/<目录名称>`，已有同名目录会报错，不会覆盖。分支始终使用标题及稳定短标识，保持任务独立。

图片上传后可预览、移除；未使用的暂存图片 24 小时后过期，后续上传时清理。已启动任务会将图片复制到运行目录并逐张传给 Codex。启动失败时表单保留内容和任务标识，重试不会重复执行已经创建的任务；图片过期需移除后重新上传。

## 准备

需要 Node.js 22.13+、npm、Git，以及已登录的 Codex CLI（`codex login`）。在独立项目目录执行：

```powershell
cd D:\Projects\web-coding
npm ci
npm run tapd:web
# 使用 TAPD 渠道时才需要初始化认证
npm run tapd:auth:cookie
```

Cookie 初始化前设置 `TAPD_COOKIE_HEADER` 和 `TAPD_WORKSPACE_ID`；Cookie 需包含 `dsc-token`，也可通过 `TAPD_DSC_TOKEN` 单独提供。已有登录态也可执行 `npm run tapd:session`，从开放 CDP 的 Chrome「我的工作」页面捕获会话，默认地址 `http://127.0.0.1:9222`，可用 `TAPD_CDP_URL` 调整。无需安装 Playwright 浏览器。

配置保存在 `config/tapd.local.json`（Git 忽略）。初始化、刷新登录态时会保留已有工作流、图片域名和仓库映射配置。可用 `--config <路径>` 或 `TAPD_CONFIG` 选择其他配置；Cookie 初始化也支持 `TAPD_SESSION_OUTPUT`。格式见 [tapd.example.json](config/tapd.example.json)。

## 使用

在本项目目录运行 `npm run tapd:web` 构建并启动应用；已构建时可运行 `npm start`。认证、排查和脚本命令如下，npm 的参数通过 `--` 分隔。`--config`、`--output` 的相对路径以调用命令时的目录为基准；配置中的仓库路径以配置文件所在目录为基准。

```powershell
# 检索当前账号待办中的需求，自动翻页，按标题包含关系匹配
npm run tapd:search -- --query "登录" --workspace 30141304
npm run tapd:search -- --status developing

# 直接按 ID 读取，需求离开待办后仍可读取
npm run tapd:detail -- --id <需求ID> --workspace <工作区ID>

# 下载图片并生成任务包预览，不启动 Codex、不修改 TAPD
npm run tapd:task -- --id <需求ID>

# 查看可用目标状态及必填人员字段
npm run tapd:transitions -- --id <需求ID>
npm run tapd:users -- --query "姓名或拼音"

# 为明确选择的需求创建 worktree 和 session，然后自动流转
npm run tapd:run -- --id <需求ID>

# 查询运行记录 / 只重试失败的流转
npm run tapd:status -- --id <需求ID>
npm run tapd:retry-transition -- --id <需求ID>
```

执行前在本地配置设置 `workflow.allow_write: true`，并按 `tapd:transitions` 的结果填写 `workflow.target_status`（通常为 `developing`）及 `workflow.fields`。例如人员必填字段可包含 `developer`、`custom_field_one`；使用接口返回的字段名和有效用户值。没有配置目标状态时优先匹配「开发中」名称。启动前会校验可流转状态和必填值，写入后会重新读取状态确认。

`tapd:todo` 保留原有全部工作项查询，支持 `--output <文件>`；`tapd:search` 默认仅需求。检索范围沿用捕获的「我的工作」视图及其筛选条件，并非整个 TAPD 项目的全量需求。`--status` 使用内部状态码。`tapd:run` 仅执行需求且必须显式传 `--id`，不会自动执行第一条搜索结果。多工作区会话需要显式传 `--workspace`。

## 图片

解析 HTML `<img>`（包括 `data-src` / `data-original`）、Markdown 内联和引用式图片；相同 URL 去重并保留顺序。支持 PNG、JPEG、WebP，以及这些格式的 base64 内嵌图片。每张图片最多 10 MiB，每个需求最多 20 张。

图片下载到任务目录的 `images/`，通过逐个 `--image <本地路径>` 传给 Codex session；任务说明保留附件顺序，`tapd-task.json` 记录图片来源和路径。图片下载失败、登录页伪装成图片、格式不支持等情况会中止执行。

默认允许 TAPD 自有域名。若 TAPD 使用外部附件 CDN，在 `tapd.image_hosts` 中加入确切主机名（例如 `cdn.example.com`）；重定向也会检查。Cookie 只发送至 `https://www.tapd.cn` 和需要登录的官方文件域名 `https://file.tapd.cn`，不会转发到外部 CDN。独立附件列表、文档附件和描述之外的图片不自动抓取。

## 一次执行一个 worktree

`codex.repository` 是目标 Git 仓库，旧相对路径仍相对于配置文件目录解析；新安装必须在 Web「执行设置」中选择仓库或显式配置此字段，不再推测父目录。多个 TAPD 项目可以在 `codex.repositories` 按工作区 ID 映射仓库，优先于默认仓库：

```json
{
  "codex": {
    "repository": "D:/Projects/my-project",
    "worktree_root": "E:/CodexWorktrees",
    "repositories": { "30141304": "D:/Projects/vibe-coding" },
    "base_ref": "HEAD",
    "startup_timeout_ms": 120000
  }
}
```

每个需求创建：

- 分支：`codex/tapd-<工作区ID>-<需求ID>`。
- worktree：`<配置根目录>/<仓库路径哈希>/tapd-<工作区ID>-<需求ID>`，默认根目录为 `~/.codex-workspaces`。
- 基点：`codex.base_ref`，默认当前仓库已提交的 `HEAD`。

Web「执行设置」可以保存默认代码仓库、worktree 根目录和基准引用；路径是服务端本机的绝对路径，Windows 可跨盘，Linux 使用 `/srv/...` 一类路径。设置保存到凭据文件同级的 `runner.local.json`，不覆盖 Cookie 或渠道配置，只影响新任务。旧任务包括以前的仓库内 worktree 都继续使用已记录路径。

### Worktree 初始化命令

在 Web「执行设置」的「Worktree 初始化命令」中每行填写一条，例如：

```sh
pnpm install
pnpm build
```

新任务先创建 worktree，再逐条执行初始化，全部成功后才创建 Codex session。每条命令都从该 worktree 根目录启动，不继承上一条的 `cd` 或环境变量修改；需要时使用 `cd 子目录 && 命令` 写在同一行。Windows 使用 cmd，Linux 使用 `/bin/sh`，请填写对应系统支持的命令。命令以服务用户身份执行，来源仅为执行设置，不从 TAPD 需求文本读取。

最多 20 条、每条 4000 字符，每条超时 15 分钟。网页显示命令、实时输出和退出码，并可点击「停止」取消初始化；服务正常关闭也会停止初始化进程。失败、停止或超时后跳过后续命令，不启动 Codex、不流转 TAPD，保留工作区供排查。已有运行记录不会自动重跑初始化，避免重复副作用；尚无 session 的失败任务需检查并清理后重新启动。

留空表示跳过，只影响后续新任务。CLI 可在 `codex.init_commands` 配置字符串数组；Web 保存的 `initCommands` 优先，空数组明确禁用。任务的 `run.json` 保存初始化状态及每条命令最近 20000 字符的输出，`initialization.log` 保存合并输出（最大 5 MiB）；刷新网页后仍可查看。

Codex 在新 worktree 内执行，根目录不会切换分支，也不会 stash、提交或带入根目录未提交的改动。worktree 共享 Git 对象和历史，各自持有独立工作目录及分支。完成后保留 worktree 供检查和手动合并；runner 不自动提交、推送、创建 PR、合并或删除 worktree。新 worktree 中的依赖及本地环境文件需要按项目约定准备，不会自动复制根目录的 Cookie、`.env` 或 `node_modules`。

## Codex 与运行记录

使用 `codex -a never exec --json --sandbox workspace-write`，提示词走 stdin，图片走 `--image`，继承本机登录和模型配置。可用 `codex.model` 指定模型。Web 与 CLI 共用可执行文件查找：`codex.command` 优先，其次 `CODEX_BIN` 环境变量；均未设置时从服务 PATH、当前 Node 所在目录和常见安装目录自动查找。Linux 检查执行权限；Windows 支持原生程序、标准 npm `codex.cmd` 对应的 JS 入口及桌面版安装目录。npm JS 入口通过当前 Node 执行，不启动 shell。其他启动方式仍可配置 `command` 与 `command_args`。

这是持久化 CLI session，可通过 `codex resume <session_id>` 继续；不保证自动显示为桌面应用侧栏中的任务。收到 `thread.started` 时保存 session ID，收到 `turn.started` 后才流转 TAPD。命令会一直运行至该轮执行结束，请保持终端运行。

每个需求的记录在 `runs/<工作区ID>-<需求ID>/`：

| 文件                          | 内容                                                   |
| ----------------------------- | ------------------------------------------------------ |
| `run.json`                    | session、worktree、分支、基点，以及执行/流转的独立状态 |
| `tapd-task.json` / `task.md`  | 完整详情、图片清单和提示词                             |
| `images/`                     | 提交给 Codex 的本地图片                                |
| `events.jsonl` / `stderr.log` | Codex 原始事件与错误日志                               |
| `final.md`                    | Codex 最终回复                                         |
| `preview/`                    | `tapd:task` 的预览，不覆盖已执行任务包                 |

已有运行记录时不会再次启动会话。流转失败可用 `tapd:retry-transition` 重试，使用已保存的需求身份；Codex 执行失败不会自动回滚 TAPD 状态。退出码 0 表示 Codex 该轮完成且流转成功，并不代表需求已通过人工验收。

若进程异常终止，`.lock` 或 `starting/running` 记录可能保留。先检查事件日志、session 和 worktree，确认没有仍在运行的进程；只在确认后移除遗留 `.lock`。已记录执行开始的任务可单独重试流转。需要继续代码工作时进入原 worktree 并 `codex resume <session_id>`；不要删除运行记录来自动重跑不确定的会话。

## 对话式 Web CLI

在仓库根目录运行：

```powershell
npm run tapd:web
# 指定配置和端口
npm run tapd:web -- --config config/tapd.local.json --port 4317
```

打开终端显示的 `http://127.0.0.1:4317`。命令先构建 Vue 页面，再启动本地服务；保持服务进程运行。关闭浏览器不停止任务；正常退出服务会请求中断当前执行，session 和 worktree 保留，可重启服务后继续。

- 左侧选择原有 TAPD 会话，查看历史回复、命令输出、文件修改、需求图片、session ID 和 worktree 路径。
- 展开「工作区与需求资料」可查看任务启动时保存的完整需求正文、抓取时间、原需求链接和图片附件；正文支持 HTML/Markdown、列表及表格，图片使用本地下载文件。下方可展开「发送给 Codex 的完整内容」核对完整提示词，不截断正文或提示词。支持历史 `tapd-task.json` 和新的 `requirement.json`，快照缺失时回退到运行记录中的正文并显示提示；展示的是启动时快照，不会自动从 TAPD 刷新。
- 下方输入框向同一个 session 发送指令；执行中变为「补充指令」，支持 Ctrl+Enter。停止只中断当前一轮，之后仍在同一 session/worktree 继续。
- Codex 发起的命令/文件审批和问题会显示在会话中，显式回复后才继续；未支持的交互请求会被拒绝并显示错误。
- 「从需求启动」选择 TAPD 渠道，支持检索待办或直接填写需求 ID。开发和测试人员支持姓名/拼音搜索，从结果中选择；切换工作区会清空旧选择，服务端启动前仍会重新验证人员。点击「创建 session 并开始开发」即执行图文抓取、独立 worktree 创建和开发中流转；此操作为本次运行启用 `allow_write`，不修改本地配置。人员字段沿用当前项目的 `developer`、`custom_field_one` 和 `owner`。
- 已移除或未注册的 worktree 只读；仍持有 `.lock` 的旧 CLI 运行不能同时接管。原 CLI 活动记录可通过「刷新」查看。

Web 接入使用 `codex app-server --stdio`，继承本机 Codex 登录与模型设置，通过 `thread/resume` 续接已有 CLI session，通过 `localImage` 传入已下载的需求图片。需要支持 `thread/items/list`、`turn/steer` 等接口的 Codex 版本；协议不兼容会显示错误，不会自动换 session。Web 使用 `on-request` 审批及 `workspace-write` 沙箱，CLI 原有行为不变。

自动查找失败时，错误会提示配置服务 PATH 或 `CODEX_BIN` / `codex.command`。显式路径失效不会自动切换程序；迁移到 Linux 前移除 Windows 的 `codex.command`，即可启用自动查找。安装并登录 Codex 的用户须与服务用户一致，详见 [部署说明](docs/deployment.md)。修改配置或环境变量后重启服务。

服务仅绑定 `127.0.0.1`，校验 Host/Origin，写入请求需要页面初始化令牌。请使用终端显示的地址；不支持公网部署。`web-session.json` 保存会话状态，`web-events.jsonl` 保存操作及事件元数据，完整消息以 Codex 历史为准。`web-owner.json` 防止多个 Web 服务接管同一 session，进程失效后可重新取得所有权。网页不会自动合并、删除分支或验收需求。

## 验证

```powershell
npm test
npm run lint
npm run web:build
npm run test:web
```

测试覆盖分页、HTTP 响应差异、图片和认证边界、Codex 启动事件、幂等及流转重试，并在临时 Git 仓库里验证真实 worktree 隔离。Codex 和 TAPD 写入使用模拟实现，不会执行线上需求。

Web 测试还覆盖 RPC、续聊、中断、审批、同源保护和 worktree 校验。`test:web` 在 Windows 使用本机 Edge，在 Linux/macOS 使用 Playwright Chromium，与模拟会话，验证真实页面交互，截图输出至忽略的 `state/browser/`，不调用真实 TAPD 写入或模型执行。
