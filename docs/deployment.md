# 独立安装与 Windows / Linux / macOS 部署

应用为独立的 `web-coding` 项目。运行代码、前端构建、lint 与测试的依赖都在本项目声明，不需要 Vben、NestJS 或外部 workspace catalog。

## 独立安装

启动需要 Node.js **22.13+**（推荐当前 LTS）、npm、PostgreSQL **17**（当前验证版本）。Prisma 7 只支持 20.19+、22.12+ 和 24.0+，使用 Node 21、23 等非 LTS 主版本时 `npm ci` 会在 Prisma 预安装检查处直接失败，必须改用 22 LTS 或 24 以上版本。Git 与 Codex CLI 可在初始化向导检测和安装，安装器不可用时按提示在服务器处理；实际执行开发前须完成服务账号的 Codex 认证。将应用源码复制到单独目录；不复制 `node_modules`、运行记录和凭据。先设置独立的 `RUNNER_DATA_DIR` 和 `DATABASE_URL`。

```sh
cd /opt/requirement-runner
npm ci
npm run build
npm run db:deploy
npm start -- --port 4317
```

如果本机 npm registry 配置异常，安装时可显式指定 `--registry https://registry.npmjs.org`。依赖由本项目的 `package-lock.json` 锁定，使用 `npm ci` 安装。

Windows 也支持上述 npm 命令。生产部署先构建一次，再运行 `npm start`。

更新源码后需要重新构建前端并重启 Web 服务。服务不会热加载后端代码；只构建或刷新页面可能使新版页面连接旧接口，出现“接口不存在”。确认没有执行中的任务后停止原服务，再从当前安装目录运行 `npm start -- --port 4317`，并刷新浏览器。重启继续使用同一 `RUNNER_DATA_DIR`，保留已有会话及 worktree。

本版本不兼容旧数据：使用新的空 PostgreSQL 数据库/schema 和新的独立 `RUNNER_DATA_DIR`，部署唯一基线 `20261012200000_baseline`。旧迁移链及 SQLite 升级脚本已删除；不提供原地升级、字段转换或旧文件回退。旧数据库、密钥和业务文件留在原处，不自动删除。下述原目录重启和更新步骤仅适用于已采用当前基线的部署。

## 本地 PostgreSQL

可以连接已有的独立 PostgreSQL 数据库，也可以使用仓库的 `compose.yaml` 启动本机数据库。Docker 仅运行数据库，应用仍由 Node.js 运行。

PowerShell 示例：

```powershell
$env:POSTGRES_PASSWORD = '替换为独立随机密码'
docker compose up -d postgres
$encodedPassword = [Uri]::EscapeDataString($env:POSTGRES_PASSWORD)
$env:DATABASE_URL = "postgresql://web_coding:${encodedPassword}@127.0.0.1:5432/web_coding"
npm run db:deploy
```

Linux shell 示例：

```sh
export POSTGRES_PASSWORD='替换为独立随机密码'
docker compose up -d postgres
export DATABASE_URL='postgresql://web_coding:替换为URL编码密码@127.0.0.1:5432/web_coding'
npm run db:deploy
```

密码在连接 URL 中需要百分号编码。默认端口仅绑定 `127.0.0.1:5432`，可通过 `POSTGRES_PORT` 调整。数据库保存在 Docker 命名卷，日常停止用 `docker compose stop`；数据库备份使用 `pg_dump` 等 PostgreSQL 工具。生产环境按运维要求配置连接权限、TLS 和备份。

仓库的 npm 初始化、迁移、开发和启动命令通过 `--env-file-if-exists=.env` 读取安装目录中的可选 `.env`，进程已有环境变量优先；直接调用 Node.js（例如下方 systemd 服务）需显式提供环境变量或环境文件。Docker Compose 也可读取 `.env`，但只设置 `POSTGRES_PASSWORD` 不会自动生成应用所需的 `DATABASE_URL`。

## macOS

macOS 支持 Apple Silicon（arm64）和 Intel（x64），安装、构建和启动使用同一份源码与锁文件。Jenkins 已配置两个独立架构的验证入口，需分别配置对应节点；只有实际执行的结果才算验证通过。

| 机器 | 原生 Node.js 架构（`node -p process.arch`） | Homebrew 默认目录 |
| --- | --- | --- |
| Apple Silicon | `arm64` | `/opt/homebrew` |
| Intel | `x64` | `/usr/local` |

在服务账号下安装 Homebrew 后，可按以下方式准备 Node.js 22 LTS 与 Git；`brew --prefix` 同时适用于两种架构：

```sh
brew install node@22 git
export PATH="$(brew --prefix node@22)/bin:$(brew --prefix)/bin:$PATH"
node -p 'process.platform + "/" + process.arch + " " + process.version'
git --version
npm install --global @openai/codex
```

Apple Silicon 建议使用原生 arm64 终端、Node.js 和 Homebrew；Rosetta 下的 x64 Node 会按 Intel 环境运行并选择 x64 npm 原生依赖。切换 Node.js 架构或主版本后，在应用目录重新执行 `npm ci` 和 `npm run build`，不要在两种架构间复制 `node_modules`、`generated` 或浏览器缓存。锁文件包含两种 macOS 架构的 Vite/Rolldown 原生依赖，安装时保留 npm optional dependencies。

PostgreSQL 17 可使用本机服务或 Docker Desktop。仓库 Compose 的 `postgres:17` 镜像支持 amd64/arm64，按宿主机选择，不要强制指定 `linux/amd64`。使用 Docker 时：

```sh
export POSTGRES_PASSWORD='替换为独立随机密码'
docker compose up -d postgres
# 集成测试需要独立测试库，compose 只创建业务库
docker compose exec postgres createdb -U web_coding test_web_coding
export TEST_DATABASE_URL='postgresql://web_coding:替换为URL编码密码@127.0.0.1:5432/test_web_coding'
```

- 使用满足要求的 Node.js LTS（22.13+），并执行通用安装步骤中的 `npm ci`、`npm run build`、`npm run db:deploy` 和 `npm start`。
- Codex CLI 也可用 Homebrew 安装。使用服务器现有认证时在服务账号下完成 `codex login`；系统 API Key 供应商遵循 [Agent 供应商](engineering/agent-suppliers.md)。自动查找保留显式配置与服务 PATH 的优先级；arm64 进程额外搜索 `/opt/homebrew/bin`，Intel/Rosetta 使用 `/usr/local/bin`。自定义安装可设置 `CODEX_BIN`。
- npm 在 PATH 中缺失时会检查当前 Node 所在目录及其 `lib/node_modules/npm`，支持 Homebrew 与 nvm 的标准布局；npm 脚本通过当前 Node 执行。
- 环境检测支持确认归属的 npm 全局 Codex 安装／更新及 npm 更新；Homebrew 管理的 Codex、Git 与 Node.js 使用原安装工具维护，页面不会用 npm 覆盖 Homebrew 二进制，也不会自动提权。Codex 登录可在向导中选择稍后完成。
- 数据目录与成员目录不要放在桌面、文稿、下载或 iCloud 同步目录：终端或 launchd 启动的服务进程会触发 macOS 隐私授权，云同步还会干扰 `node_modules`、`.git` 和 worktree。
- 常驻服务可用下方的 launchd 配置，需显式提供 `PATH` 与固定的 `RUNNER_DATA_DIR`；launchd 不会读取交互式 shell 的 nvm 或 Homebrew 初始化。Git、初始化命令和目标项目工具都依赖服务 PATH。
- macOS 默认 APFS 大小写不敏感，而路径身份比较只在 Windows 下忽略大小写；同一数据根、仓库或 worktree 只按一种写法配置。
- 若拉取镜像时报 `error getting credentials`（Docker Desktop 的 `credsStore` 凭据助手异常，公共镜像并不需要凭据），可让本次命令使用不含该字段的配置目录：`DOCKER_CONFIG=/path/to/config docker compose up -d postgres`，其中 `config/config.json` 只保留 `{"auths":{}}`、`{"currentContext":"desktop-linux"}`，并把 `~/.docker/cli-plugins` 链接到该目录的 `cli-plugins`；也可以直接重启 Docker Desktop 修复凭据助手。

### macOS 登录后常驻服务

以下 LaunchAgent 示例在服务账号登录后运行，退出登录会停止。将 `runner`、安装位置和 Node 路径替换为实际值；Intel 将 `/opt/homebrew` 换为 `/usr/local`，nvm 则使用当前版本的绝对路径。先在安装目录 `.env` 中配置 `DATABASE_URL` 与固定的绝对 `RUNNER_DATA_DIR`，完成构建和迁移。`.env` 只允许服务账号读取，不提交到仓库。

先创建目录，再将配置保存为 `~/Library/LaunchAgents/com.web-coding.plist`：

```sh
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/web-coding"
```

plist 不会展开 `~`、`$HOME` 或 shell 命令：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.web-coding</string>
  <key>WorkingDirectory</key><string>/Users/runner/apps/web-coding</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/opt/node@22/bin/node</string>
    <string>--env-file=/Users/runner/apps/web-coding/.env</string>
    <string>/Users/runner/apps/web-coding/src/cli/web.cjs</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>4317</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ExitTimeOut</key><integer>120</integer>
  <key>StandardOutPath</key><string>/Users/runner/Library/Logs/web-coding/stdout.log</string>
  <key>StandardErrorPath</key><string>/Users/runner/Library/Logs/web-coding/stderr.log</string>
</dict>
</plist>
```

在服务账号的终端执行：

```sh
plutil -lint "$HOME/Library/LaunchAgents/com.web-coding.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.web-coding.plist"
# 停止服务；更新或修改 plist 后先停止，再重新 bootstrap
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.web-coding.plist"
```

修改运行环境前等待任务空闲。安装目录可以调整，数据库、数据根、业务仓库与已有 worktree 路径保持原位。

## 持久化与配置

安装目录、运行数据、业务仓库和 worktree 可以分别放在不同位置：

| 内容            | 示例                          |
| --------------- | ----------------------------- |
| 应用安装        | `/opt/requirement-runner`     |
| 运行数据        | `/var/lib/requirement-runner` |
| 业务 Git 仓库   | `/srv/repos/product`          |
| Worktree 根目录 | `/srv/worktrees`              |

启动前设置 `RUNNER_DATA_DIR` 为独立运行数据目录，`DATABASE_URL` 指向新的 PostgreSQL 数据库。业务数据通过 Prisma 保存，独立凭据主密钥位于 `secrets/database.key`。`workspaces/` 仅保留执行图片缓存和必要锁。未设置数据目录时使用应用目录；静态页面始终取自安装包的 `web/dist`。账号与升级完整约定见 [账号与数据库](engineering/accounts-and-database.md)。

首次启动打开服务的 `/setup` 页面，通过向导创建管理员、检测并安装工具、设置成员目录、创建产品及研发部门，可跳过测试账号和首个项目。保存并退出后管理员再次登录可继续，密码不存为草稿。初始管理员创建入口仅在全新空部署开放，创建后永久关闭。

运维也可使用 `npm run init:admin` 交互创建管理员，再登录网页继续配置。管理员管理项目无需部门，参与开发需分配部门及相应项目权限。普通成员不能自行创建空间，拥有代码操作权限后自动分配个人开发空间。当前基线上已有业务数据的部署不会强制初始化；不覆盖现有部门、成员、项目和路径。

Web 不接受 `--config`。不要将凭据写入 service 文件或版本控制。

登录 Codex 的用户必须与运行服务的用户一致。管理员在「系统设置」维护成员目录基础路径并查看 Git 环境；开发成员在「个人设置」维护多个 Git 主机账号和独立提交作者，在项目开发空间选择本人账号验证实际仓库并准备克隆。非开发成员无需 Git 或 Codex。初始化命令和提示词在项目设置中维护。新目录为 `<成员目录>/projects/<仓库目录名>/members/<用户名>/{repository-<准备修订号>,worktree/<任务>}`。仓库目录名取 Git 地址末尾的仓库名（去掉 `.git`），同名时给后创建项目加短后缀并持久化，用户名取登录名；Windows 保留用户名使用安全编码。本版目录规则不兼容历史项目、工作区与任务数据；请使用全新数据库，迁移遇到这些历史记录会明确拒绝，不自动删除数据或搬移目录。准备失败保留原目录，明确重试使用新目录；已就绪空间的记录路径保持不变。SSH 生成需要服务器安装 OpenSSH（`ssh-keygen`）。Linux 路径区分大小写，不接受 Windows 盘符路径。

Windows 路径需带完整盘符（例如 `D:\repos\project`）或使用 UNC 共享路径；`\repos\project`、`/repos/project` 依赖当前磁盘，不能作为明确的服务端绝对路径。中文、空格和 Windows 扩展路径可用于仓库及 worktree。Linux 保留路径中的空格并按大小写匹配。

配置、任务和工作区名称使用 PostgreSQL 短事务及唯一约束更新。升级前停掉旧服务及 CLI，完成数据库、密钥和工作目录备份，执行 `npm run build` 和 `npm run db:deploy`。启动只校验迁移状态和文件校验和、补齐默认设置，发现未部署或失败的迁移时拒绝启动；不回退旧 SQLite，不自动删除业务 Worktree。不要在生产运行 `db push` 或 `migrate reset`。

Web 与 CLI 自动定位 Codex 的顺序：

1. `agent.options.command`，其次环境变量 `CODEX_BIN`。显式配置不可用时直接提示修正，不回退到其他程序。
2. 服务进程的 `PATH`。
3. 当前 Node 所在目录、`~/.local/bin`、`~/.npm-global/bin`。
4. macOS arm64 先检查 `/opt/homebrew/bin`；随后 Linux/macOS 检查 `/usr/local/bin`、`/usr/bin`、`/bin`。macOS x64 不自动搜索 arm64 Homebrew 目录。Windows 检查 `%APPDATA%/npm` 和 `%LOCALAPPDATA%/OpenAI/Codex/bin`（包含按修改时间从新到旧检查的版本子目录）。

Linux/macOS 候选必须具有执行权限；npm 的 `codex.js` 入口通过当前 Node 启动，避免依赖 shell 初始化。Windows 标准 npm `codex.cmd` 也使用相邻 `node_modules/@openai/codex/bin/codex.js`，不会执行任意 `.cmd`、`.bat`、`.ps1` 内容。

迁移到 Linux 时删除原 Windows 的 `agent.options.command`（以及与原安装绑定的 `agent.options.command_args`），再启用自动查找。systemd 不会自动读取 `.bashrc` 或 nvm 初始化脚本；如果 Codex 安装在另一套 Node 或自定义目录中，需要在 service 中添加该目录到 `PATH`，或设置 `Environment=CODEX_BIN=/absolute/path/to/codex`。修改 service 后执行 `systemctl daemon-reload` 并重启服务；Web 中保存工作区配置无需重启；手动修改 Codex 启动程序路径后需要重启。

现有 session 不会因为设置改动而迁移。PostgreSQL 备份之外应单独保管凭据主密钥。恢复执行需要对应的 Codex 用户数据、业务仓库与 Worktree Git 元数据；仅恢复数据库不足以恢复执行，路径不一致的历史会话保持只读。

## Linux 常驻服务

以普通用户 `runner` 为例，先确保其拥有数据目录、目标仓库与 worktree 根目录的读写权限，并配置好 Codex 登录与 PATH。以下 systemd 配置中的安装路径、Node 路径与用户应按实际机器调整：

```ini
[Unit]
Description=Requirement runner Web CLI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=runner
WorkingDirectory=/opt/requirement-runner
Environment=RUNNER_DATA_DIR=/var/lib/requirement-runner
EnvironmentFile=/etc/requirement-runner/environment
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node /opt/requirement-runner/src/cli/web.cjs --port 4317
Restart=on-failure
TimeoutStopSec=120
UMask=0077

[Install]
WantedBy=multi-user.target
```

`/etc/requirement-runner/environment` 由运维创建并限制读取权限，包含 `DATABASE_URL=postgresql://...`，可按需要配置外部 `RUNNER_ENCRYPTION_KEY`；不要提交该文件。初始化管理员、部署迁移与服务启动必须使用相同数据库、运行目录和密钥。

CLI 启动默认监听 `0.0.0.0`，上述 npm 命令和 systemd 配置均可通过 `http://<Linux主机IP>:4317` 直接访问，例如 `http://192.168.0.27:4317`。`0.0.0.0` 是监听地址，浏览器应使用主机实际 IP。

```sh
npm start -- --port 4317
```

仅需本机访问时，显式指定回环地址：

```sh
npm start -- --host 127.0.0.1 --port 4317
```

systemd 部署时可在 `ExecStart` 的 Node 命令后追加 `--host 127.0.0.1`，重新加载 unit 后重启服务。已有 `RUNNER_DATA_DIR` 保持不变。在个人电脑也可通过 SSH 隧道访问：

```sh
ssh -N -L 4317:127.0.0.1:4317 runner@your-server
```

然后打开 `http://127.0.0.1:4317` 登录。远程正式部署使用 HTTPS 反代：设置 `PUBLIC_ORIGIN=https://coding.example.com`，应用绑定 `127.0.0.1`，代理保留公开 Host 并发送 `X-Forwarded-Proto: https`。该模式仅接受本机代理连接，Cookie 设置 Secure；不能信任任意客户端提供的转发头。账号隔离是应用访问控制，执行仍共享主机身份，适合受信任成员。

`--host` 接受 IPv4/IPv6 地址字面量。未配置 `PUBLIC_ORIGIN` 时，服务校验 Host 中的 IP、端口与连接实际到达的本机地址一致，不从转发头推断访问来源。配置公开来源时采用前述本机反代校验；两种模式均保留 Origin、跨站请求及 POST 令牌校验。

直接嵌入或测试 `createWebServer()` 时，HTTP 工厂内部仍默认监听 `127.0.0.1`；CLI 入口负责传入默认值 `0.0.0.0`。

## 验证

初始化和 CLI 超时/停止时，Linux/macOS 终止独立进程组，Windows 使用 `taskkill /t` 清理普通子进程树。初始化适用于安装、构建等有明确结束时间的命令；主动脱离进程组的守护程序需要由独立服务管理。

```sh
npm run db:generate
npx eslint src test web/src web/vite.config.mjs
node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs
npm run build
npx playwright install --with-deps chromium
node test/browser/session.test.cjs
node test/browser/workspaces.test.cjs
node test/browser/dev.test.cjs
node test/browser/accounts.test.cjs
```

测试必须设置 `TEST_DATABASE_URL` 指向独立测试数据库。测试创建并清理随机 schema，不应使用生产连接或生产运行目录。

浏览器 smoke 在 Linux/macOS 默认使用 Playwright Chromium；Windows 默认使用本机 Edge。`BROWSER_CHANNEL` 可显式选择已安装的浏览器渠道。执行核心与 HTTP 测试不依赖浏览器或真实模型。

完整检查由 Jenkinsfile 按上述同一顺序执行，并额外包含视觉截图。Windows / Linux / macOS 双架构 CI 节点准备和运行步骤见 [平台验证说明](engineering/platform-verification.md)。

Ubuntu 26.04 使用当前 Playwright 版本安装测试浏览器时，需要显式选择兼容下载目标；具体命令见平台验证说明中的 Ubuntu 26.04 小节。
