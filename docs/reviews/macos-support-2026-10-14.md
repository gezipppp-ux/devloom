# macOS（Intel）支持改造与验证

> macOS 未接入 Jenkins 矩阵，本文结论只来自 Intel Mac 本机验证，不能替代双平台 CI。安装与部署以 [部署说明](../deployment.md#macos) 为准。

日期：2026-10-14。环境：macOS / `darwin x64`（Intel Core i7-9750H）、Node.js 22.23.3、npm 10.9.9、PostgreSQL 17.11（Docker `postgres:17`）、Playwright Chromium 147、Git 2.39.2 (Apple Git)、Codex CLI 0.162.1。

## 修复内容

- **初始化向导在 macOS 上无法完成**：`EnvironmentServices.read()` 只把 Windows/Linux 记为 `pass`，其余平台为 `warning`；而 `environmentReadiness()` 要求除「成员目录可写」外的检查全部 `pass`，因此 darwin 上恒为 `false`，`POST /api/system/setup/environment` 与 `complete` 始终返回 409 `SETUP_ENVIRONMENT_REQUIRED`。`environment` 步骤又不在 skip 白名单内，改用 `npm run init:admin` 建号也会被 `SetupServices.gate()` 以 `SETUP_REQUIRED` 拦住全部业务接口。现将 `darwin` 纳入受支持平台并同步检查文案。
- macOS 目录选择器增加主目录、`/Volumes`、`/usr/local` 快捷根，避免只能从 `/` 逐级浏览。
- 环境检测页面与中英 i18n、README、部署说明、用户手册、平台验证和账号数据库契约同步补充 macOS。

## 有意保留的行为

- macOS 未接入自动安装器：`system-tool-updates.cjs` 对非 Windows（除 Linux Git）仍返回不可用，Git、Node.js、Codex CLI 由服务账号用 Homebrew 或 npm 安装；环境检测只呈现版本与更新计划并禁用安装按钮，不影响 `environmentReadiness`。
- 路径身份比较仍只在 Windows 下忽略大小写（`shared/paths.cjs`、数据根与仓库登记键）。macOS 默认 APFS 大小写不敏感，已按「同一目录只按一种写法配置」写入文档，未改变比较语义。
- Codex 自动查找已覆盖 Intel Mac 的 `/usr/local/bin`；Apple Silicon 的 `/opt/homebrew/bin` 仍在回退列表之外，需依赖 `PATH` 或 `CODEX_BIN`。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| `npx eslint src test web/src web/vite.config.mjs` | 通过 |
| `node --test test/architecture/* test/unit/*` | 203 / 203 通过 |
| `node --test test/integration/*` | 372 项：364 通过、6 跳过；2 项时序敏感用例（`dev-server` 端口冲突、`session-lifecycle` 迟到响应）在全量并行下超时，单独运行均通过 |
| `npm run build` | 通过（`web/dist` 2.0 MB） |
| 浏览器套件 | `setup`、`session`、`dev`、`development-flows`、`project-editing`、`i18n` 通过 |
| 端到端初始化 | 真实 Chromium 走 `/setup`，`POST /api/system/setup/environment` 返回 200，向导由 2/7「运行环境」推进到 3/7「成员目录」；面板显示 Git 2.39.2、Codex CLI 0.162.1、PostgreSQL 已连接、npm 10.9.9、Node.js 22.23.3 全部满足要求 |

`test/browser/workspaces.test.cjs` 依赖默认成员目录 `~/.web-coding-workspaces`，在受限制的验证沙箱中不可写；把 `HOME` 指向可写目录后该套件通过。截图证据在被忽略的 `state/macos-evidence/`。

## 与本次改动无关的既有 macOS 失败

`agent-suppliers` 的「输入分隔符在下一个强度输入前保留」断言、`project-releases` 与 `visual` 的焦点恢复断言在 macOS Chromium 上确定性失败。把这四处源码改动 stash 后重跑，三个套件以完全相同的断言再次失败，故与本次改动无关，属既有平台差异。

焦点断言的成因已定位：Chrome on macOS 点击按钮不会让按钮获得焦点，而 `ModalDialog` 用 `document.activeElement` 记录触发元素并在关闭时恢复，macOS 上记录到的是 `body`；键盘用户通过 Tab 聚焦时行为正常。未在 Linux/Windows 上复现确认，也未修改。
