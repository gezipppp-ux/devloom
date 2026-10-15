# macOS（Intel）支持改造与验证

> 本文记录 2026-10-14 的 macOS 兼容改造与当时的验证结果。同日稍后的 `462771b` 扩展了 Apple Silicon 支持并把 macOS 纳入 Jenkins 矩阵，被取代的结论在文末「后续更新」标注；当前行为以 [部署说明](../deployment.md#macos) 为准。

日期：2026-10-14。环境：macOS / `darwin x64`（Intel Core i7-9750H）、Node.js 22.23.3、npm 10.9.9、PostgreSQL 17.11（Docker `postgres:17`）、Playwright Chromium 147、Git 2.39.2 (Apple Git)、Codex CLI 0.162.1。

## 修复内容

- **初始化向导在 macOS 上无法完成**：`EnvironmentServices.read()` 只把 Windows/Linux 记为 `pass`，其余平台为 `warning`；而 `environmentReadiness()` 要求除「成员目录可写」外的检查全部 `pass`，因此 darwin 上恒为 `false`，`POST /api/system/setup/environment` 与 `complete` 始终返回 409 `SETUP_ENVIRONMENT_REQUIRED`。`environment` 步骤又不在 skip 白名单内，改用 `npm run init:admin` 建号也会被 `SetupServices.gate()` 以 `SETUP_REQUIRED` 拦住全部业务接口。现将 `darwin` 纳入受支持平台并同步检查文案。
- macOS 目录选择器增加主目录、`/Volumes`、`/usr/local` 快捷根，避免只能从 `/` 逐级浏览。
- 环境检测页面与中英 i18n、README、部署说明、用户手册、平台验证和账号数据库契约同步补充 macOS。

## 有意保留的行为

- macOS 没有 Git 与 Node.js 的系统安装器：`system-tool-updates.cjs` 对非 Windows（除 Linux Git）返回不可用，Git、Node.js 由服务账号用 Homebrew 安装。Codex 与 npm 走 npm 全局路径，macOS 上可正常安装与更新（`updateAvailable` 为真），无需系统安装器。
- 路径身份比较仍只在 Windows 下忽略大小写（`shared/paths.cjs`、数据根与仓库登记键）。macOS 默认 APFS 大小写不敏感，已按「同一目录只按一种写法配置」写入文档，未改变比较语义。
- Codex 自动查找覆盖 Intel Mac 的 `/usr/local/bin`（Apple Silicon 的 `/opt/homebrew/bin` 由后续 `462771b` 补齐，见文末）。

## 验证结果（`f772659`，即纳入 master 之前的版本）

| 项目 | 结果 |
| --- | --- |
| `npx eslint src test web/src web/vite.config.mjs` | 通过 |
| `node --test test/architecture/* test/unit/*` | 203 / 203 通过 |
| `node --test test/integration/*` | 372 项：364 通过、6 跳过；2 项时序敏感用例（`dev-server` 端口冲突、`session-lifecycle` 迟到响应）在全量并行下超时，单独运行均通过 |
| `npm run build` | 通过（`web/dist` 2.0 MB） |
| 浏览器套件 | `setup`、`session`、`dev`、`development-flows`、`project-editing`、`i18n` 通过 |
| 端到端初始化 | 真实 Chromium 走 `/setup`，`POST /api/system/setup/environment` 返回 200，向导由 2/7「运行环境」推进到 3/7「成员目录」；面板显示 Git 2.39.2、Codex CLI 0.162.1、PostgreSQL 已连接、npm 10.9.9、Node.js 22.23.3 全部满足要求 |

`test/browser/workspaces.test.cjs` 依赖默认成员目录 `~/.web-coding-workspaces`，在受限制的验证沙箱中不可写；把 `HOME` 指向可写目录后该套件通过。截图证据在被忽略的 `state/macos-evidence/`。

当时在 macOS 上确定性失败的三个断言（`agent-suppliers` 的输入分隔符、`project-releases` 与 `visual` 的焦点恢复）已由后续 `462771b` 修复，根因分别是行尾快捷键差异、临时目录符号链接与「点击按钮不聚焦」，见下。

## 后续更新（同日 `462771b fix(macos): 兼容 Apple Silicon 与 Intel 并修复会话交互`）

- **Apple Silicon**：darwin 且 `process.arch` 为 `arm64` 时在 POSIX 回退目录前追加 `/opt/homebrew/bin`，Intel/Rosetta 进程仍用 `/usr/local/bin`；未找到 Codex 的报错补充 launchd。
- **npm 解析**：`findExecutable` / `npmCommand` 支持回退到运行中 Node 的目录与 POSIX `lib/node_modules`，适配 launchd 缺少 nvm/Homebrew `PATH` 的场景。
- **焦点恢复**：`ModalDialog` 新增 `returnFocus` 属性，恢复前检查 `isConnected`；此前以 `document.activeElement` 记录触发元素，在 macOS 上点击按钮不聚焦时记到的是 `body`。
- **测试平台差异**：`agent-suppliers` 在 darwin 用 `Meta+ArrowRight` 代替 `End`；`dev.test.cjs` 改用 `fs.realpathSync.native(os.tmpdir())` 解决 macOS `/var` 指向 `/private/var` 导致的路径比对失败。
- **CI**：Jenkinsfile 矩阵增加 `macos-arm64`、`macos-x64`，并断言运行节点的 Node 架构与目标一致；需要实际配置对应节点。
- **文档**：`deployment.md` 的 macOS 小节重写为双架构安装、Rosetta 说明、launchd LaunchAgent 与 Docker 约定；README、平台验证、渠道与设置、工程索引、账号与数据库同步更新。

## master 上的复测（本次）

| 项目 | 结果 |
| --- | --- |
| `npx eslint src test web/src web/vite.config.mjs` | 通过 |
| architecture + unit | 220 / 220 通过 |
| `node --test test/integration/*` | 382 项：376 通过、6 跳过、0 失败 |
| `npm run build` | 通过 |
| 浏览器套件 | `accounts`、`project-collaboration`、`visual`、`workspaces`、`theme`、`setup`、`i18n` 全部通过 |

macOS 环境判定（真实代码路径）：操作系统 `pass`，Codex/npm `updateAvailable` 为真，`environmentReadiness` 为真。
