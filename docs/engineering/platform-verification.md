# Windows / Linux / macOS 验证

支持 Node.js 22.13+、Git 和 npm。Windows、Linux、macOS arm64/x64 使用相同源码、锁文件和验证命令；每台机器分别 `npm ci`，不要跨系统或架构复制 `node_modules`、生成客户端或浏览器缓存。

## 本机验证

```sh
npm ci
npm run db:generate
npx playwright install chromium
npx eslint src test web/src web/vite.config.mjs
node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs
npm run build
node test/browser/session.test.cjs && node test/browser/workspaces.test.cjs && node test/browser/dev.test.cjs && node test/browser/accounts.test.cjs && node test/browser/setup.test.cjs && node test/browser/project-collaboration.test.cjs && node test/browser/development-flows.test.cjs && node test/browser/project-editing.test.cjs && node test/browser/visual.test.cjs
```

测试前设置 `TEST_DATABASE_URL` 为专用 PostgreSQL 连接；测试账号需要在该专用数据库创建／删除 schema 的权限。禁止配置为生产数据库。测试以随机 schema 隔离，应用子进程只接收当前测试 schema 的 `DATABASE_URL`。

上述命令依次执行 lint、全部架构/单元/集成测试、前端构建、Web 功能回归和视觉截图。测试只使用 fake Codex 与临时 Git 仓库，不需要 Codex 登录，不执行真实需求。

Linux 首次运行浏览器测试时，管理员需为测试节点安装 Chromium 系统依赖，例如 `npx playwright install --with-deps chromium`。Windows 默认使用本机 Edge；要使用上面安装的 Chromium，在 PowerShell 设置 `$env:BROWSER_CHANNEL = 'chromium'`；Linux 可在运行上述浏览器脚本前设置 `BROWSER_CHANNEL=chromium`。截图输出到被忽略的 `state/browser/`。

macOS（Intel 或 Apple Silicon）命令与 Linux 相同，浏览器默认使用 Chromium（先执行 `npx playwright install chromium`）。安装步骤及 Homebrew/launchd 路径见 [部署说明](../deployment.md#macos)。Apple Silicon 使用原生 arm64 Node，Intel 使用 x64 Node，以 `node -p process.arch` 核对；Rosetta 模拟不能替代 Intel 实机结果。测试临时目录先解析真实路径，避免 macOS `/var` 与 `/private/var` 别名导致错误断言；专门的 Worktree 别名回归仍验证原记录路径、续聊身份和删除边界。macOS 默认 APFS 大小写不敏感，而路径身份比较（`shared/paths.cjs`、数据根与仓库登记键）只在 Windows 下忽略大小写，因此同一数据根、仓库或 worktree 只按一种写法配置，不要用大小写区分两个目录。

### Ubuntu 26.04 的浏览器准备

当前锁定的 Playwright 1.59.1 尚未提供 `ubuntu26.04` 下载映射，直接安装会提示 `Playwright does not support chromium on ubuntu26.04-x64`。Ubuntu 26.04 x64 测试节点可显式下载兼容的 Ubuntu 24.04 构建：

```sh
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium
BROWSER_CHANNEL=chromium node test/browser/session.test.cjs && node test/browser/workspaces.test.cjs && node test/browser/dev.test.cjs && node test/browser/accounts.test.cjs && node test/browser/setup.test.cjs && node test/browser/project-collaboration.test.cjs && node test/browser/development-flows.test.cjs && node test/browser/project-editing.test.cjs && node test/browser/visual.test.cjs
```

此环境变量仅用于浏览器准备，不修改系统版本。已具备与锁文件版本一致的 Playwright 浏览器缓存时，可直接执行验证。系统仍需具备 Chromium 运行库；后端与前端构建不依赖服务器上的 Chromium。该兼容方式绑定当前 Playwright 版本，升级后应重新验证发行版支持情况。

重点回归包括中文和空格路径、Windows 盘符/UNC/扩展路径、Linux 尾部空格路径、符号链接或 junction、npm Codex 启动器、初始化及 CLI 超时后的子进程停止、并发 JSON 保存、服务关闭和会话切换竞态。显式局域网监听还需通过实际非回环 IP 验证页面、Host/Origin 和令牌校验，以及普通 HTTP 下创建手动需求的请求身份生成。平台专属文件系统/进程测试必须在对应系统运行，给函数传入模拟平台参数不能替代实机结果。

## 多平台 CI

仓库提供 Jenkins Declarative Pipeline，可通过 SCM 从 Gitee 或其他 Git 服务检出。创建使用根目录 `Jenkinsfile` 的 Pipeline，并配置四个独立测试节点：

| 节点标签 | 环境 |
| --- | --- |
| `web-coding-linux` | Linux、受支持的 Node.js LTS、npm、Git、Chromium 系统依赖 |
| `web-coding-windows` | Windows、受支持的 Node.js LTS、npm、Git |
| `web-coding-macos-arm64` | Apple Silicon Mac、原生 arm64 Node.js LTS、npm、Git |
| `web-coding-macos-x64` | Intel Mac、x64 Node.js LTS、npm、Git |

所有节点均需注入专用 `TEST_DATABASE_URL` 并可访问 PostgreSQL；缺少变量将使数据库验证失败。

所有节点均须支持创建本系统的符号链接或 junction；测试目录应位于本地可写磁盘。节点不配置业务 Cookie、Codex 凭据或生产数据目录。流水线并行安装锁定依赖和 Playwright Chromium，并执行 Jenkinsfile 中的校验序列、保存截图。节点版本由运维管理，建议至少保留 Node.js 22 LTS 验证；升级 Node 或依赖时同样运行全部平台；macOS 安装阶段会核对实际 Node 平台与架构，标签与运行时不匹配即失败。

Linux CI 优先使用 Playwright 支持的发行版，如 Ubuntu 24.04。若节点为 Ubuntu 26.04 x64，为该 Jenkins 节点配置 `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`，让安装步骤使用上述已验证的兼容构建；不要将此值设置到 Windows 或 macOS 节点。

添加流水线文件不会自动创建 Jenkins 任务。合并前应查看四个节点的实际构建结果；缺少对应标签的节点会使该矩阵项等待，不能将未接入节点或未执行的平台声称为已验证。

每个平台使用 CI 工作目录下的 `verification/<平台>/` 独立检出。运行前清理该检出中的浏览器截图，归档路径保留平台目录，避免复用旧截图或不同平台同名截图互相覆盖。

## 2026-10-14 macOS 本机记录

实机为 macOS 26.6.2 / arm64，原生 Node.js v22.22.1。PostgreSQL 17.11 使用 Colima 上的 `postgres:17` arm64 容器，只监听本机 5433，专用测试库由 `TEST_DATABASE_URL` 提供；业务数据库、已有会话和 worktree 不参与验证。

| 检查 | 实测结果 |
| --- | --- |
| 安装锁定依赖、Prisma 客户端与 Chromium | `npm ci`、`npm run db:generate`、`npx playwright install chromium` 通过，Chromium 使用 mac-arm64 构建 |
| ESLint、架构／单元／集成与构建 | ESLint 和 `npm run build` 通过；589 项测试中 583 通过、6 个 Windows 专属用例跳过、0 失败 |
| 生产服务启动／停止／再次启动 | 在含中文与空格的独立数据目录、随机测试 schema 中两次启动 `src/cli/web.cjs`；初始化状态接口和构建后的 Vue 页面可访问，SIGTERM 正常关闭并释放同一端口 |
| npm Codex 首次安装与确切版本更新 | 临时全局 prefix 中安装 0.162.0、更新到 0.162.1，安装归属和更新后版本校验通过；临时安装与配置在检查后清理 |
| 原生 Codex app-server 启动 | Homebrew arm64 Codex 0.162.1 和更新后的 npm Codex 均完成 initialize / initialized；稳定协议支持供应商覆盖与 auto_review |
| 对话与项目流程 | Jenkinsfile 的九个浏览器入口通过，包含初始化、环境安装／更新、会话创建／发送／补充／审批／停止／续聊、图片、账号、项目协作、工作区、开发服务及流程 |
| 视觉 | 344 张截图检查通过，覆盖桌面、平板、移动、双语及主题，没有页面溢出或提示重叠 |

本轮修复：新图片草稿不再等待忽略 abort 的旧会话上传响应；成员和版本弹窗显式保存鼠标触发按钮并恢复焦点，适应 macOS 点击不自动聚焦的行为。回归夹具统一 Git 账号临时目录的真实路径；Mac 光标移动使用 Cmd+方向键，画布操作按实际缩放尺寸取点，并在下拉关闭后再调整视口。真实 Git 回归继续覆盖目录别名下的 Worktree 识别、原记录路径保留、定向删除及仓库／标记替换防护。

命令日志与探针脚本保存在本机忽略目录 `state/verification/macos-arm64/`，截图位于 `state/browser/`。对话执行回归使用 fake Codex／Agent、临时 Git 和随机 PostgreSQL schema；原生 CLI 检查只生成协议或初始化连接，不创建真实 thread、不调用模型。当前服务账号的现有 Codex 登录探针未通过；实际模型对话仍需服务账号认证或已配置的原生 API Key 供应商。Homebrew 管理的 Codex、Git 与 Node.js 按部署契约由 Homebrew 维护，网页不会以 npm 覆盖其安装。

此前缺少 `TEST_DATABASE_URL` 的失败记录已由上述专用数据库实测取代。未运行 Intel Mac、Windows、Linux 或远端 Jenkins 节点，双架构参数模拟和 CI 配置不作为这些平台的实测证据。

### macOS 双架构复核

当前实现同时支持 macOS Apple Silicon（arm64）与 Intel（x64）。再次执行 Codex 定位、npm 定位、安装／更新门禁、Agent 适配、app-server 生命周期及会话启动的 8 个单元／集成测试文件，69 项全部通过；其中 Homebrew 的两种路径通过模拟文件系统与架构参数分别覆盖，子进程测试实际运行在上述 arm64 本机。

锁文件同时包含 `@rolldown/binding-darwin-arm64` / `binding-darwin-x64` 和 `lightningcss-darwin-arm64` / `darwin-x64` 的原生可选依赖；npm 官方 Codex 0.162.1 元数据也分别声明 `@openai/codex-darwin-arm64` 与 `@openai/codex-darwin-x64`。安装时由原生 Node 选择对应依赖。Jenkins 的 `macos-arm64`、`macos-x64` 两项均在安装前核对 `process.platform` 与 `process.arch`；Intel 实机的安装、构建与端到端运行仍需在对应节点执行后才能标记为实测通过。
