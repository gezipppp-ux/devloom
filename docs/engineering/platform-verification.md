# Windows / Linux / macOS 验证

支持 Node.js 22.13+、Git 和 npm。两个系统使用相同源码、锁文件和验证命令；每台机器分别 `npm ci`，不要跨系统复制 `node_modules`。

## 本机验证

```sh
npm ci
npm run db:generate
npx playwright install chromium
npx eslint src test web/src web/vite.config.mjs
node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs
npm run build
node test/browser/session.test.cjs && node test/browser/workspaces.test.cjs && node test/browser/dev.test.cjs && node test/browser/accounts.test.cjs && node test/browser/project-collaboration.test.cjs && node test/browser/visual.test.cjs
```

测试前设置 `TEST_DATABASE_URL` 为专用 PostgreSQL 连接；测试账号需要在该专用数据库创建／删除 schema 的权限。禁止配置为生产数据库。测试以随机 schema 隔离，应用子进程只接收当前测试 schema 的 `DATABASE_URL`。

上述命令依次执行 lint、全部架构/单元/集成测试、前端构建、Web 功能回归和视觉截图。测试只使用 fake Codex 与临时 Git 仓库，不需要 Codex 登录，不执行真实需求。

Linux 首次运行浏览器测试时，管理员需为测试节点安装 Chromium 系统依赖，例如 `npx playwright install --with-deps chromium`。Windows 默认使用本机 Edge；要使用上面安装的 Chromium，在 PowerShell 设置 `$env:BROWSER_CHANNEL = 'chromium'`；Linux 可在运行上述浏览器脚本前设置 `BROWSER_CHANNEL=chromium`。截图输出到被忽略的 `state/browser/`。

macOS（Intel 或 Apple Silicon）可用于本机验证，命令与 Linux 相同，浏览器默认使用 Chromium（先执行 `npx playwright install chromium`）。macOS 未接入 Jenkins 矩阵，其结果属于本机验证。macOS 默认 APFS 大小写不敏感，而路径身份比较（`shared/paths.cjs`、数据根与仓库登记键）只在 Windows 下忽略大小写，因此同一数据根、仓库或 worktree 只按一种写法配置，不要用大小写区分两个目录。

### Ubuntu 26.04 的浏览器准备

当前锁定的 Playwright 1.59.1 尚未提供 `ubuntu26.04` 下载映射，直接安装会提示 `Playwright does not support chromium on ubuntu26.04-x64`。Ubuntu 26.04 x64 测试节点可显式下载兼容的 Ubuntu 24.04 构建：

```sh
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium
BROWSER_CHANNEL=chromium node test/browser/session.test.cjs && node test/browser/workspaces.test.cjs && node test/browser/dev.test.cjs && node test/browser/accounts.test.cjs && node test/browser/project-collaboration.test.cjs && node test/browser/visual.test.cjs
```

此环境变量仅用于浏览器准备，不修改系统版本。已具备与锁文件版本一致的 Playwright 浏览器缓存时，可直接执行验证。系统仍需具备 Chromium 运行库；后端与前端构建不依赖服务器上的 Chromium。该兼容方式绑定当前 Playwright 版本，升级后应重新验证发行版支持情况。

重点回归包括中文和空格路径、Windows 盘符/UNC/扩展路径、Linux 尾部空格路径、符号链接或 junction、npm Codex 启动器、初始化及 CLI 超时后的子进程停止、并发 JSON 保存、服务关闭和会话切换竞态。显式局域网监听还需通过实际非回环 IP 验证页面、Host/Origin 和令牌校验，以及普通 HTTP 下创建手动需求的请求身份生成。平台专属文件系统/进程测试必须在对应系统运行，给函数传入模拟平台参数不能替代实机结果。

## 双平台 CI

仓库提供 Jenkins Declarative Pipeline，可通过 SCM 从 Gitee 或其他 Git 服务检出。创建使用根目录 `Jenkinsfile` 的 Pipeline，并配置两个独立测试节点：

| 节点标签 | 环境 |
| --- | --- |
| `web-coding-linux` | Linux、受支持的 Node.js LTS、npm、Git、Chromium 系统依赖 |
| `web-coding-windows` | Windows、受支持的 Node.js LTS、npm、Git |

两个节点均需注入专用 `TEST_DATABASE_URL` 并可访问 PostgreSQL；缺少变量将使数据库验证失败。

两个节点均须支持创建本系统的符号链接或 junction；测试目录应位于本地可写磁盘。节点不配置业务 Cookie、Codex 凭据或生产数据目录。流水线并行安装锁定依赖和 Playwright Chromium，并执行 Jenkinsfile 中的校验序列、保存截图。节点版本由运维管理，建议至少保留 Node.js 22 LTS 验证；升级 Node 或依赖时同样跑两端。

Linux CI 优先使用 Playwright 支持的发行版，如 Ubuntu 24.04。若节点为 Ubuntu 26.04 x64，为该 Jenkins 节点配置 `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`，让安装步骤使用上述已验证的兼容构建；不要将此值设置到 Windows 节点。

添加流水线文件不会自动创建 Jenkins 任务。合并前应查看两个平台的实际构建结果；未接入节点或未执行的平台应明确记录为未验证。macOS 目前未接入 CI 矩阵，其结论只来自本机验证，不能声称已由流水线覆盖。

每个平台使用 CI 工作目录下的 `verification/<平台>/` 独立检出。运行前清理该检出中的浏览器截图，归档路径保留平台目录，避免复用旧截图或两端同名截图互相覆盖。
