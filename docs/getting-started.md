# DevLoom 安装与配置

本文保留完整的环境准备、首次初始化、配置和开发验证说明。项目介绍见 [README](../README.md)，日常操作见 [使用手册](user-guide.md)，各平台常驻服务配置见 [部署说明](deployment.md)。

## 目录

- [环境要求](#环境要求)
- [安装项目](#安装项目)
- [初始化与首次启动](#初始化与首次启动)
- [首次登录后的配置](#首次登录后的配置)
- [启动方式与常用命令](#启动方式与常用命令)
- [配置与环境变量](#配置与环境变量)
- [数据目录与备份](#数据目录与备份)
- [服务器部署与访问](#服务器部署与访问)
- [更新与升级](#更新与升级)
- [常见问题](#常见问题)
- [项目结构与开发验证](#项目结构与开发验证)

## 环境要求

以下软件需要安装在**运行 DevLoom 服务的机器上**；仅通过浏览器访问的成员不需要在自己电脑上安装这些运行依赖。

| 项目 | 要求 | 用途 |
| --- | --- | --- |
| 操作系统 | Windows、Linux 或 macOS（Intel / Apple Silicon），使用可写的本地安装与数据目录 | 应用运行与任务执行；CI 配置覆盖 Windows、Linux、macOS arm64/x64，需对应实机节点 |
| Node.js | **22.13.0 或更高版本**，使用 22 LTS 或 24 以上的偶数主版本 | 后端、Vite 构建与脚本运行；Prisma 7 拒绝 Node 21、23 等非 LTS 主版本，`npm ci` 会直接失败 |
| npm | 随 Node.js 安装，并能访问 npm registry | 按锁文件安装依赖 |
| PostgreSQL | **17**（当前验证版本），独立数据库及账号 | 业务数据、会话、日志和附件持久化 |
| Git | 已安装且可从服务进程的 `PATH` 找到，支持 `git worktree` | 克隆仓库、创建任务分支及工作目录 |
| Codex CLI | 已安装，并在运行服务的同一操作系统账号下完成认证 | 通过 `codex app-server --stdio` 执行任务 |
| OpenSSH | 使用 SSH Git 账号时需要 `ssh` 和 `ssh-keygen` | 生成密钥与访问 SSH 仓库 |
| 浏览器 | 现代桌面或移动浏览器 | 登录与使用 Web 工作台 |
| 网络 | 可访问 npm、业务 Git 服务、Codex 服务 | 安装、克隆与执行 |

目标项目需要的 Java、Python、pnpm、编译器等工具，也要在服务端另外安装。DevLoom 只提供任务工作台，不会自动安装所有业务项目的运行环境。磁盘需要容纳依赖、数据库、项目仓库和多个任务 worktree，具体容量取决于仓库规模。

首次启动前需准备 Node.js、npm 和 PostgreSQL。初始化向导会检测 Git / Codex，并在安装器可用时按展示的确切版本安装缺失工具；Codex 登录可稍后完成，实际开始开发前仍需认证。

### 检查运行环境

管理员可在「系统设置 → Agent 供应商」选择 Codex API Key 直连配置或“服务器现有配置”。API Key 模式要求供应商提供原生 Responses 接口；支持手填／获取模型及手动生成检测，检测可能产生少量费用。切换不打断当前轮次，失败不自动回退；配置和升级说明见 [Agent 供应商](engineering/agent-suppliers.md)。Codex CLI 仍需安装；只有使用服务器现有认证时才需要在服务账号下完成对应登录。

管理员登录后可打开「系统设置 → 环境检测」（`/system?tab=environment`，旧地址 `/environment` 自动跳转），检测服务端 Codex CLI、npm、Git、Node.js 的版本、Codex 登录状态和目录写权限。点击「检查最新版本」查询官方来源；Node.js 以最新 LTS 为更新目标，网络异常会显示检查失败。

标准 npm 全局安装的 Codex CLI、npm 可在页面确认后更新到展示的确切版本；执行中或等待审批的任务、克隆会阻止更新，更新期间暂不接受新的写入操作。关闭页面不会取消安装，返回页面可继续查看进度。安装使用当前服务账号权限，不自动提权；失败后请检查网络、目录权限和 Node.js 兼容性。Windows 的 Node.js 支持 nvm 1/2 或已识别的 winget 安装，Git 支持已识别的 winget 安装，均使用同一更新按钮。macOS（Intel 或 Apple Silicon）支持确认归属的 npm 全局 Codex 安装／更新及 npm 更新；Homebrew 管理的 Codex、Git 与 Node.js 使用原安装工具维护。Codex 自动查找覆盖 Apple Silicon 的 `/opt/homebrew/bin` 与 Intel 的 `/usr/local/bin`；npm 也会检查当前 Node 的安装目录。双架构安装与 launchd 配置见 [macOS 部署](deployment.md#macos)。Node.js 完成后显示「已安装，待重启生效」；重启服务后才使用新运行时，跨主版本升级还需重新安装应用依赖。其他平台或无法确认归属的安装禁用按钮并说明原因，不展示更新指引。已有会话不会自动执行。

基础检测不验证所有业务工具链、SSH 和外部服务网络连通性；仍需按实际项目配置。

在终端中执行：

```sh
node --version
npm --version
git --version
codex --version
```

安装或认证 Codex CLI 的方法见 [Codex CLI 官方文档](https://developers.openai.com/codex/cli/)。使用“服务器现有配置”的登录认证时，在**实际运行服务的账号下**完成登录；系统 API Key 供应商无需此步骤：

```sh
codex login
```

若使用 SSH Git 账号，还应确认 `ssh`、`ssh-keygen` 可用。Windows 可用 `Get-Command ssh, ssh-keygen`，Linux 可用 `command -v ssh ssh-keygen` 检查。

Git 登录凭据与提交作者是两类配置。若任务需要提交代码，可在服务账号下配置实际提交身份；仓库自身的配置优先：

```sh
git config --global user.name "你的提交姓名"
git config --global user.email "你的提交邮箱"
```

## 安装项目

### 1. 获取源码

在计划存放应用的父目录中执行：

```sh
git clone https://gitee.com/____gezi/web-coding.git devloom
cd devloom
```

源码远程地址仍沿用现有仓库，克隆时将本地目录命名为 `devloom`。需要使用 SSH 时，可改用仓库的 SSH 地址 `git@gitee.com:____gezi/web-coding.git`，并确保当前账号拥有仓库访问权限。也可以获取源码压缩包并解压，然后进入包含 `package.json` 的目录。既有安装的目录和数据保持原位，详见 [改名与既有安装](deployment.md#项目改名与既有安装)。

### 2. 安装依赖

```sh
npm ci
```

使用仓库自带的 `package-lock.json` 安装锁定版本。不要跨 Windows / Linux 复制 `node_modules`，应在目标机器重新安装。首次部署需要执行前端构建，因此此阶段应安装开发依赖，不要使用 `--omit=dev`。

若机器的 npm registry 配置不可用，可按网络条件指定 registry：

```sh
npm ci --registry https://registry.npmjs.org
```

安装后运行 `npm run db:generate` 生成并编译 Prisma 客户端；`npm run build` 也会执行此步骤。

## 初始化与首次启动

这里有两种不同的“初始化”：**应用初始化**负责数据库和管理员，只在首次部署时操作；**工作区初始化命令**会在每个新任务的 worktree 中执行，用于安装业务项目依赖，后文单独说明。

### 1. 选择运行数据目录

建议将应用源码、应用数据和业务工作目录分开存放。例如：

| 内容 | Windows 示例 | Linux 示例 |
| --- | --- | --- |
| 应用安装目录 | `D:\apps\devloom` | `/opt/devloom` |
| 应用数据目录 | `D:\devloom-data` | `/var/lib/devloom` |
| 成员目录基础路径 | `D:\wt` | `/srv/devloom` |

`RUNNER_DATA_DIR` 用于指定应用数据目录；成员目录基础路径则由管理员登录后在页面设置，两者用途不同。未设置 `RUNNER_DATA_DIR` 时，数据保存在应用安装目录。

以下两组命令按操作系统选择一组，在项目根目录执行。示例目录应由运行服务的账号拥有读写权限；Linux 的 `/var/lib` 等目录通常需要管理员预先创建并授权。

**Windows PowerShell：**

```powershell
$env:RUNNER_DATA_DIR = 'D:\devloom-data'
$env:DATABASE_URL = 'postgresql://web_coding:替换为URL编码密码@127.0.0.1:5432/web_coding'
New-Item -ItemType Directory -Force -Path $env:RUNNER_DATA_DIR | Out-Null
npm run build
npm run db:deploy
npm start -- --host 127.0.0.1 --port 4317
```

**Linux shell：**

```sh
export RUNNER_DATA_DIR=/var/lib/devloom
export DATABASE_URL='postgresql://web_coding:替换为URL编码密码@127.0.0.1:5432/web_coding'
mkdir -p "$RUNNER_DATA_DIR"
npm run build
npm run db:deploy
npm start -- --host 127.0.0.1 --port 4317
```

环境变量示例只对当前终端及其子进程有效。换终端启动时需要重新设置；配置常驻服务时，应将相同值写入服务的环境配置。

### 2. 创建初始管理员

打开服务的 `/setup` 页面，在网页中创建管理员：

- 登录名默认 **`admin`**，可修改；显示名称与登录名分别填写。
- 密码长度为 **6–256 个字符**，两次输入必须一致。
- 没有预置密码；创建后自动登录，继续检测并安装缺失的 Git / Codex、配置成员目录、创建产品部门与研发部门。
- 可选创建「测试#产品」「测试#研发」及第一个项目，并分配对应权限；测试账号首次登录须改密。
- 已完成步骤自动保存，「保存并退出」保留非敏感草稿。密码不会保存为草稿。
- 仅全新空部署可创建初始管理员；已有账号后，请登录继续配置。

`npm run init:admin` 仍可作为运维入口：交互创建固定登录名 `admin`，两次输入密码且不回显，不接受命令行参数。随后登录网页继续初始化。已有账号不会被重置；已有业务数据的部署不会强制进入向导。

先创建空 PostgreSQL 数据库，运行 `npm run db:deploy` 部署版本化表结构；启动时校验迁移并补齐默认设置，未部署或升级失败会拒绝启动。**初始化管理员和启动服务必须使用同一个 `DATABASE_URL`、`RUNNER_DATA_DIR` 及凭据主密钥。** 可使用 [Docker Compose 配置](../compose.yaml) 启动本地数据库，步骤见[部署说明](deployment.md)。

### 3. 构建并打开页面

`npm run build` 将前端输出到 `web/dist`；`npm start` 启动正式服务并读取这些静态资源。看到终端输出监听地址后，打开：

[http://127.0.0.1:4317](http://127.0.0.1:4317)

首次启动打开 `/setup` 创建管理员；已创建账号时使用自己的登录名和密码。保持服务终端运行；在前台启动时，按 `Ctrl+C` 可正常关闭服务。关闭浏览器不会停止已启动的后台任务，关闭服务会中断正在初始化或执行的任务，之后可在原会话继续，程序不会自动重跑需求。

## 首次登录后的配置

1. 在「系统设置」指定成员项目与任务目录基础路径。建议使用较短目录，例如 Windows 的 `D:\wt`，并确认服务账号有写入权限。
2. 在「部门与权限」创建平铺部门，勾选可用功能上限；在「账号管理」为成员设置用户名、显示名称及部门。用户名用于登录，显示名称用于展示，可在个人设置修改。管理员管理项目不要求所属部门，参与开发仍需部门与项目成员授权。
3. 管理员从「全部项目」查看和管理所有项目，普通成员从「我的项目」进入获授权项目。管理员或获授创建项目资格的成员填写项目名称、说明和 Git 仓库地址即可创建项目。项目不归属部门，一个项目管理一个仓库，支持 HTTP(S) 和 SSH 地址，地址中不填写密码或令牌。
4. 创建者成为负责人，在「成员」中添加参与者并分配权限；项目授权不得超过成员所属部门上限。仓库地址由项目设置管理，分配开发空间后不可更换。
5. 非开发成员可直接维护需求、Bug、评论、交付与资产，无需配置 Git。开发成员在「个人设置」维护 Git 主机、个人 HTTP/SSH 凭据及独立的提交作者身份。
6. 在项目「开发空间」选择自己的 Git 账号并准备仓库。系统自动分配空间，验证实际仓库读取权限后异步克隆；准备失败需显式处理或重试，不会借用管理员凭据。
7. 项目负责人在「设置」维护每行一条的 worktree 初始化命令、提示词。初始化命令在每个新任务的独立 worktree 中运行，输出保存在该任务记录里。
8. 在项目「需求」或「Bug」创建事项，填写正文、验收标准或复现步骤。
9. 为事项设置目标发布版本。选择同版本的一条或多条事项，认领或指派为待开发任务；此时无需准备 Git。执行人在任务详情准备个人空间、选择远端分支并明确开始开发。每次开始保存内容快照，同一事项同时只允许一个未结束任务，完成或取消后释放认领；后续资料显式追加和发送。
10. 开发结果通过交付记录供项目成员查看。需求的验收、Bug 的验证由独立权限控制；执行结束不会自动完成业务事项。

管理员在「系统设置 → 流程编排」统一维护需求与 Bug 的状态图、连线、操作权限和退回原因，保存草稿后发布。项目统一使用系统流程，已有事项保留创建时的流程版本。项目发布版本中的事项都已完成或取消且开发任务均已结束后，可整体归档为只读，恢复后继续维护。

「项目资产」保存备忘录、文档附件、环境地址和非生产账号密码／Token。敏感值单独授权、加密保存并记录访问审计；普通列表及历史不返回明文。项目资产不会自动加入 Codex 上下文。

开发空间和任务目录使用稳定项目／用户身份，重命名项目不会搬移已有目录。成员移除、部门撤权或项目归档后保留历史和文件，后续访问与执行由服务端重新校验；已有执行的停止以实际结果为准。

## 启动方式与常用命令

所有命令都在项目根目录执行，并使用本次部署选定的 `RUNNER_DATA_DIR`。

| 命令 | 用途 | 默认监听 |
| --- | --- | --- |
| `npm ci` | 安装锁文件中的依赖 | 无 |
| `npm run init:admin` | 交互创建初始管理员 | 无 |
| `npm run db:generate` | 生成并编译 Prisma CommonJS 客户端 | 无 |
| `npm run db:deploy` | 部署 PostgreSQL 版本化迁移 | 无 |
| `npm run build` | 生成客户端并构建正式前端到 `web/dist` | 无 |
| `npm start` | 启动正式服务，需先构建 | `0.0.0.0:4317` |
| `npm run dev` | 前端热更新，后端保持运行 | `0.0.0.0:5173` |
| `npm run dev:watch` | 前端热更新，后端源码变化后自动重启 | `0.0.0.0:5173` |

### 正式运行

```sh
# 本机访问
npm start -- --host 127.0.0.1 --port 4317

# 局域网访问，监听所有 IPv4 网卡
npm start -- --host 0.0.0.0 --port 4317
```

局域网其他电脑使用 `http://服务器实际IP:4317` 访问，不要将 `0.0.0.0` 当作浏览器地址。`--host` 接受 IP 地址字面量，正式服务端口范围为 1–65535。npm 命令中的 `--` 用于将后续参数传给应用。

### 本地开发

```sh
npm run dev
# 或开启后端自动重启
npm run dev:watch
# 仅允许本机访问，或自定义端口
npm run dev:watch -- --host 127.0.0.1 --port 5173
```

`dev` 和 `dev:watch` 默认监听所有 IPv4 网卡。本机访问 [http://127.0.0.1:5173](http://127.0.0.1:5173)，同一局域网的其他设备访问 `http://运行服务的电脑IP:5173`（例如 `http://192.168.1.10:5173`），并确保防火墙允许 TCP 5173。不要使用 `0.0.0.0` 作为浏览器地址。页面、API、SSE 和热更新共用同一端口，无需额外启动 `npm start` 或配置前端代理；开发模式无需构建前端，但需要先生成 Prisma 客户端并部署数据库迁移。首次运行打开 `/setup` 创建管理员。

`dev` 修改前端后自动更新，修改后端需手动重启。`dev:watch` 监听 `src/` 的 CJS 和 `shared/` 的 JSON；后端重启会停止活动初始化及 Codex 轮次，并刷新页面、清空未发送草稿。实际任务运行期间，建议使用只热更新前端的 `dev`。

开发和正式服务可以使用不同的数据目录；不要让两个运行中的服务同时操作同一工作区。已有会话身份与 worktree 在重启后保留，不会自动重新执行任务。

## 配置与环境变量

生产配置主要通过页面维护：

| 位置 | 管理内容 | 生效范围 |
| --- | --- | --- |
| 个人设置 | Git 账号、通知、默认模型、思考强度、执行权限 | 当前成员全部工作区 |
| 系统设置 | 成员目录基础路径、环境检测、工具自动安装与更新 | 系统，由管理员维护 |
| 项目设置 | Git 仓库地址、初始化命令、默认提示词及个人提示词覆盖 | 当前项目；开发分支在任务启动时选择 |

启动环境变量如下：

| 变量 | 默认行为 | 何时设置 |
| --- | --- | --- |
| `DATABASE_URL` | 必填，无数据库回退 | 指定独立 PostgreSQL 连接，可用 `?schema=...` 选择独占 schema |
| `TEST_DATABASE_URL` | 仅测试使用 | 指向专用测试数据库，测试创建并清理随机 schema |
| `RUNNER_DATA_DIR` | 使用应用安装目录作为数据根 | 建议首次部署时设置为独立绝对路径，并保持固定 |
| `CODEX_BIN` | 自动从服务进程 `PATH` 及常见安装位置查找 Codex | 服务找不到 Codex 或安装位置特殊时指定入口路径 |
| `PUBLIC_ORIGIN` | 按直接连接的本机 IP、端口校验访问来源 | HTTPS 反代部署时设置，如 `https://coding.example.com`，不得包含路径或凭据 |
| `RUNNER_ENCRYPTION_KEY` | 自动生成并读取 `secrets/database.key` | 需要外部托管凭据主密钥时设置，格式为 64 位十六进制；已有数据须保持原密钥 |
| `BROWSER_CHANNEL` | Windows 测试使用 Edge，Linux/macOS 测试使用 Chromium | 仅浏览器测试选择渠道时使用，例如 `chromium` |

这些变量可通过终端、服务管理器或安装目录中的可选 `.env` 提供；npm 初始化、迁移、开发和启动命令会读取该文件，进程已有环境变量优先。修改后需重启，`.env` 不提交版本控制。Web 和开发服务均不接受 `--config`；不要照旧版本说明维护生产 JSON 配置。

Codex 需要由服务账号访问自己的认证与配置；systemd 不会自动加载交互式 shell 的 nvm 或 `.bashrc`。若终端能找到 Codex、服务却找不到，应检查服务的 `PATH` 或设置 `CODEX_BIN`，详细定位规则见 [部署说明](deployment.md)。

## 数据目录与备份

```text
<RUNNER_DATA_DIR>/
  secrets/
    database.key           # 自动生成的凭据加密主密钥
  workspaces/              # Codex 图片缓存及必要执行锁

<成员目录基础路径>/
  projects/web-coding/members/admin/  # Git 仓库名 / 登录用户名
    repository-<准备修订号>/  # 克隆得到的项目仓库
    worktree/<任务前缀>-<12位任务标识>/  # 各任务的独立 worktree
```

PostgreSQL 是唯一业务数据来源，账号、设置、任务、历史、日志和附件均入库。Git 项目、worktree 和 Codex 自身的会话资料仍在文件系统中，静态资源始终从应用安装目录的 `web/dist` 读取。

备份应覆盖：

1. **应用数据**：使用 PostgreSQL `pg_dump` 或运维平台的一致性备份，并验证 `pg_restore` 恢复。不能通过复制旧 SQLite 或仅备份运行目录恢复数据库。
2. **凭据主密钥**：单独妥善保管 `secrets/database.key`，或外部设置的 `RUNNER_ENCRYPTION_KEY`。数据库升级备份不包含主密钥。
3. **业务项目与任务目录**：包括未提交文件、未推送提交和 Git worktree 元数据。
4. **Codex 用户资料**：恢复继续执行所需的引擎资料与可用认证环境。

恢复时应使用对应的数据、密钥与业务目录，保留记录中的实际路径。仅恢复数据库不能重新创建任务代码和可执行会话。修改应用安装目录或系统基础目录不会搬移既有 worktree，旧任务继续使用记录的路径。

本版本只支持全新部署，不兼容旧 PostgreSQL、SQLite、JSON/JSONL、工作区配置、runs 或 uploads。旧迁移链已合并为唯一基线 `20261012200000_baseline`；旧部署必须使用新的空数据库/schema 和新的独立数据目录，旧数据库、密钥及业务目录保留原位，不转换、不自动删除。`npm run db:deploy` 只部署当前基线及其后续迁移；启动校验版本并拒绝旧迁移历史。

## 服务器部署与访问

前台启动适合本机体验。Linux 长期运行可使用 systemd，完整服务文件示例见 [部署说明](deployment.md#linux-常驻服务)。配置时确保服务用户、Node.js 路径、Codex 认证、`RUNNER_DATA_DIR` 和业务目录权限与首次初始化一致。

远程正式部署使用 HTTPS 反向代理：

1. 应用监听 `127.0.0.1:4317`。
2. 设置 `PUBLIC_ORIGIN=https://coding.example.com`，替换为实际域名。
3. 在同一台机器配置 HTTPS 代理，转发到应用端口，保留公开 `Host` 并发送 `X-Forwarded-Proto: https`。
4. 对 SSE 实时响应禁用代理缓冲，并配置足够的读取超时，以免会话输出积压或频繁断开。

代理模式仅接受本机代理连接；未配置公开来源时，服务按实际 IP/端口校验 Host，不支持任意域名直接访问。无需反代、只需个人远程访问时，也可以将服务绑定本机地址并使用 SSH 隧道：

```sh
ssh -N -L 4317:127.0.0.1:4317 runner@your-server
```

随后在个人电脑打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)。

## 更新与升级

以下步骤仅适用于已经采用 `20261012200000_baseline` 的安装。使用旧迁移链的部署请按「初始化与首次启动」重新部署到新的空数据库/schema 和数据目录，不能原地升级或伪造已执行迁移：

1. 等待当前任务完成，停止旧 Web 服务及相关 CLI 进程。
2. 备份数据、主密钥、业务目录及需要保留的 Codex 资料。
3. 在应用安装目录获取目标版本；使用 Git 且安装目录无待处理本地修改时，可执行 `git pull --ff-only`。
4. 执行 `npm ci`、`npm run build` 和 `npm run db:deploy`。
5. 使用原来的服务账号、`RUNNER_DATA_DIR`、主密钥及业务目录重新启动。
6. 刷新页面，确认登录、工作区和历史会话可用，再继续原任务。

不要在每次升级时重复创建管理员。迁移部署前完成 PostgreSQL、密钥和工作目录备份；迁移失败拒绝启动，不会自动重新执行需求。

后端改动必须重启服务。仅更新前端且接口未变时，重新构建后刷新页面即可。不要只更新页面却让旧后端继续服务，否则可能出现“接口不存在”。迁移失败应先核查 Prisma 迁移状态与数据库日志，不使用 `db push` 或 `migrate reset` 修复生产数据。

## 常见问题

| 现象 | 检查和处理 |
| --- | --- |
| `npm ci` 失败 | 检查 Node.js 版本、registry 和网络；原生模块构建报错时检查本机编译工具，不要复用另一系统的依赖目录 |
| Windows 提示无法运行 `npm.ps1` | 可在 PowerShell 中使用 `npm.cmd` 执行相同命令，或使用已正确配置的命令提示符 |
| 提示未构建或页面资源不存在 | 在当前安装目录运行 `npm run build`，确认生成 `web/dist` 后再启动正式服务 |
| 初始化成功但无法登录或数据“消失” | 确认初始化和启动使用同一个 `RUNNER_DATA_DIR`；尤其检查新终端、服务管理器中的环境变量 |
| 再次初始化提示管理员已存在 | 该命令用于创建账号，不用于重置；使用已有管理员登录，成员密码可在「账号管理」重置 |
| 端口被占用 | 关闭占用该端口的旧服务，或用 `--port 4318` 等指定其他端口 |
| 本机能打开，其他电脑打不开 | 检查是否监听 `0.0.0.0`、访问是否使用服务器真实 IP，以及防火墙与网络是否允许该端口 |
| 域名访问或 HTTPS 登录失败 | 检查 `PUBLIC_ORIGIN` 与浏览器源地址一致，代理位于本机且保留 Host、正确发送 HTTPS 协议头 |
| 找不到 Codex 或提示未登录 | 在服务用户下检查 `codex --version` 与认证；检查服务 PATH，必要时配置 `CODEX_BIN` |
| Git 连接检测失败 | 使用完整克隆地址，检查账号或令牌的仓库读取权限；SSH 场景确认公钥已添加到 Git 服务 |
| 提交时报作者身份缺失 | 配置服务用户或仓库的 Git `user.name` 与 `user.email`；Git 登录名不会自动成为提交作者 |
| worktree 初始化失败 | 查看初始化日志，确认依赖工具已装在服务端、命令适合对应 shell，且不依赖上一行的 `cd` 或变量 |
| Windows 路径过长 | 对新项目与任务选择较短的成员目录基础路径；修改设置不会移动已有 worktree |
| 重启后任务没有自动继续 | 属于预期行为，在原会话核对历史后继续；不确定是否已执行的操作不会自动重放 |
| 历史可看但代码或会话只读 | 检查原 worktree 是否仍存在且 Git 登记有效；只恢复数据库不足以恢复执行 |

## 项目结构与开发验证

```text
src/
  cli/              # 命令参数、初始化管理员、正式/开发服务入口
  http/             # Fastify、路由、认证、SSE 与静态资源
  application/      # 工作区、账号、任务和会话用例
  channels/         # 手动需求来源适配与通用渠道接口
  execution/        # 通用任务准备与初始化执行
  codex/            # Codex 程序定位与会话协议
  git/              # 仓库、分支与 worktree 操作
  storage/          # PostgreSQL、Prisma、凭据与持久化
  config/           # 运行配置与路径定位
  domain/           # 领域数据及校验
  shared/           # 后端通用工具
web/src/            # Vue 3 页面、功能组件与公共样式
shared/             # 前后端共用的数据契约
config/             # 配置示例，不是生产配置来源
test/               # 架构、单元、集成与浏览器测试
docs/               # 使用、部署与工程文档
Jenkinsfile         # Windows / Linux / macOS arm64 与 x64 CI 流水线
```

开发、重构或代码审查前，请阅读 [AGENTS.md](../AGENTS.md)、[工程契约索引](engineering/index.md) 与相关契约。提交使用 Conventional Commits 和中文描述。不要提交本地凭据、`config/*.local.json`、`state/`、`runs/`、数据库、密钥或业务目录。

基础校验与构建：

```sh
npm run db:generate
npx eslint src test web/src web/vite.config.mjs
node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs
npm run build
```

Prisma 集成测试需要 `TEST_DATABASE_URL` 指向专用 PostgreSQL 数据库，测试会创建并清理随机 schema。CI 必须配置该变量；缺少配置无法完成全量验证，不能据此声称数据库验证通过。不要把生产连接地址用于测试。

Web 改动还需运行 Jenkinsfile 中的浏览器检查：

```sh
node test/browser/session.test.cjs
node test/browser/workspaces.test.cjs
node test/browser/dev.test.cjs
node test/browser/accounts.test.cjs
node test/browser/project-collaboration.test.cjs
node test/browser/visual.test.cjs
```

测试使用 fake Codex 和临时 Git 仓库，不执行真实需求。测试文件统一命名为 `<kebab-case>.test.cjs`；夹具和共享辅助模块放在 `test/fixtures`、`test/support`，命名为 `<kebab-case>.cjs`。

Windows 浏览器测试默认使用本机 Edge；Linux/macOS 默认使用 Playwright Chromium。Linux 测试环境一般需要先运行 `npx playwright install --with-deps chromium`；Ubuntu 26.04 及 CI 节点准备见 [平台验证说明](engineering/platform-verification.md)。这些浏览器依赖用于自动化测试，不是普通 Web 服务启动的前置步骤。截图输出到忽略的 `state/browser/`，视觉索引为 `state/browser/unified/index.html`。
