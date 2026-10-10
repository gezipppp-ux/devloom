# Web Coding · 需求开发工作台

Web Coding 是一个将需求资料、Git 项目和 Codex 会话连接起来的 Web 工作台。你可以从 TAPD 导入需求，也可以手动填写文字、上传图片，由 Codex 在独立的 Git worktree 中处理任务，并在浏览器中持续沟通、查看代码与执行结果。

项目采用 **Node.js 22.13+ / CommonJS + Fastify + SQLite + Vue 3 + Vite**，前后端由同一个服务提供。依赖在本仓库独立管理，无需额外部署数据库服务，也不依赖 NestJS、Vben 或其他项目。

## 目录

- [项目能力与使用方式](#项目能力与使用方式)
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
- [更多文档](#更多文档)

## 项目能力与使用方式

| 能力 | 说明 |
| --- | --- |
| 账号与私有工作区 | 管理员创建成员；每个成员拥有自己的工作区，一个工作区对应一个项目 |
| 多种需求来源 | 手动文字、Markdown 和图片；TAPD 需求、缺陷、看板卡片 |
| TAPD 多需求处理 | 多条需求融合为一个任务，也可向已有任务追加需求资料 |
| 独立开发目录 | 每个任务创建独立分支和 Git worktree，保留原仓库的工作状态 |
| 持久化 Codex 会话 | 实时输出、审批、提问、续聊、补充图片、停止当前轮次 |
| 代码查看 | 查看文件、未提交修改、任务累计差异和分支状态 |
| 任务管理 | 类型标签、人工进度、归档、恢复与删除 |
| 独立配置 | 个人默认模型与权限、系统目录、工作区初始化命令和提示词模板 |

通常按以下流程使用：

1. 安装并启动 Web Coding，初始化管理员。
2. 管理员设置成员目录、创建成员账号。
3. 成员配置自己的 Git 账号，克隆项目并创建工作区。
4. 设置任务基准引用及初始化命令，按需配置 TAPD。
5. 新建需求任务，在会话中处理审批、补充说明、检查结果。
6. 按团队流程完成代码验收、提交、合并和发布。

TAPD 集成为只读，不会自动修改需求状态或人员字段。任务结束不会自动合并、推送或删除分支；人工进度由成员自行维护。工作区隐私属于应用层访问控制，任务执行共享服务所在机器的操作系统身份，适合受信任成员使用。

## 环境要求

以下软件需要安装在**运行 Web Coding 服务的机器上**；仅通过浏览器访问的成员不需要在自己电脑上安装这些运行依赖。

| 项目 | 要求 | 用途 |
| --- | --- | --- |
| 操作系统 | Windows 或 Linux，使用可写的本地安装与数据目录 | 应用运行与任务执行；两平台有对应 CI 配置 |
| Node.js | **22.13.0 或更高版本**，建议使用满足要求的 LTS | 后端、Vite 构建与脚本运行 |
| npm | 随 Node.js 安装，并能访问 npm registry | 按锁文件安装依赖 |
| Git | 已安装且可从服务进程的 `PATH` 找到，支持 `git worktree` | 克隆仓库、创建任务分支及工作目录 |
| Codex CLI | 已安装，并在运行服务的同一操作系统账号下完成认证 | 通过 `codex app-server --stdio` 执行任务 |
| OpenSSH | 使用 SSH Git 账号时需要 `ssh` 和 `ssh-keygen` | 生成密钥与访问 SSH 仓库 |
| 浏览器 | 现代桌面或移动浏览器 | 登录与使用 Web 工作台 |
| 网络 | 可访问 npm、业务 Git 服务、Codex 服务；使用 TAPD 时还需访问 TAPD 及附件域名 | 安装、克隆与执行 |

目标项目需要的 Java、Python、pnpm、编译器等工具，也要在服务端另外安装。Web Coding 只提供任务工作台，不会自动安装所有业务项目的运行环境。磁盘需要容纳依赖、数据库、项目仓库和多个任务 worktree，具体容量取决于仓库规模。

### 检查运行环境

在终端中执行：

```sh
node --version
npm --version
git --version
codex --version
```

安装或认证 Codex CLI 的方法见 [Codex CLI 官方文档](https://developers.openai.com/codex/cli/)。本项目使用前，在**实际运行服务的账号下**完成登录：

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
git clone https://gitee.com/____gezi/web-coding.git
cd web-coding
```

需要使用 SSH 时，可改用仓库的 SSH 地址 `git@gitee.com:____gezi/web-coding.git`，并确保当前账号拥有仓库访问权限。也可以获取源码压缩包并解压，然后进入包含 `package.json` 的目录。

### 2. 安装依赖

```sh
npm ci
```

使用仓库自带的 `package-lock.json` 安装锁定版本。不要跨 Windows / Linux 复制 `node_modules`，应在目标机器重新安装。首次部署需要执行前端构建，因此此阶段应安装开发依赖，不要使用 `--omit=dev`。

若机器的 npm registry 配置不可用，可按网络条件指定 registry：

```sh
npm ci --registry https://registry.npmjs.org
```

`better-sqlite3` 包含原生模块。若当前 Node.js 版本或平台没有可用的预编译包，安装可能需要 Python 与本机 C/C++ 构建工具；优先使用受支持的 Node.js LTS，并根据安装日志补齐构建环境。

## 初始化与首次启动

这里有两种不同的“初始化”：**应用初始化**负责数据库和管理员，只在首次部署时操作；**工作区初始化命令**会在每个新任务的 worktree 中执行，用于安装业务项目依赖，后文单独说明。

### 1. 选择运行数据目录

建议将应用源码、应用数据和业务工作目录分开存放。例如：

| 内容 | Windows 示例 | Linux 示例 |
| --- | --- | --- |
| 应用安装目录 | `D:\apps\web-coding` | `/opt/web-coding` |
| 应用数据目录 | `D:\web-coding-data` | `/var/lib/web-coding` |
| 成员目录基础路径 | `D:\wt` | `/srv/web-coding` |

`RUNNER_DATA_DIR` 用于指定应用数据目录；成员目录基础路径则由管理员登录后在页面设置，两者用途不同。未设置 `RUNNER_DATA_DIR` 时，数据保存在应用安装目录。

以下两组命令按操作系统选择一组，在项目根目录执行。示例目录应由运行服务的账号拥有读写权限；Linux 的 `/var/lib` 等目录通常需要管理员预先创建并授权。

**Windows PowerShell：**

```powershell
$env:RUNNER_DATA_DIR = 'D:\web-coding-data'
New-Item -ItemType Directory -Force -Path $env:RUNNER_DATA_DIR | Out-Null
npm run init:admin
npm run build
npm start -- --host 127.0.0.1 --port 4317
```

**Linux shell：**

```sh
export RUNNER_DATA_DIR=/var/lib/web-coding
mkdir -p "$RUNNER_DATA_DIR"
npm run init:admin
npm run build
npm start -- --host 127.0.0.1 --port 4317
```

环境变量示例只对当前终端及其子进程有效。换终端启动时需要重新设置；配置常驻服务时，应将相同值写入服务的环境配置。

### 2. 创建初始管理员

上面的 `npm run init:admin` 会提示输入两次密码，输入时不回显：

- 初始账号固定为 **`admin`**。
- 密码长度为 **6–256 个字符**，两次输入必须一致。
- 命令不接受参数，不支持通过 `--username`、`--password` 指定账号或密码。
- 没有预置的默认密码；初始化成功后会提示管理员已创建。
- 已创建的账号不会通过再次执行此命令重置密码。后续成员由页面中的「账号管理」维护。

数据库表结构和必要默认配置由程序自动初始化；日常安装无需手动建表、执行 SQL 或创建演示数据。**初始化管理员和启动服务必须使用同一个 `RUNNER_DATA_DIR`。**

### 3. 构建并打开页面

`npm run build` 将前端输出到 `web/dist`；`npm start` 启动正式服务并读取这些静态资源。看到终端输出监听地址后，打开：

[http://127.0.0.1:4317](http://127.0.0.1:4317)

使用 `admin` 和刚刚设置的密码登录。保持服务终端运行；在前台启动时，按 `Ctrl+C` 可正常关闭服务。关闭浏览器不会停止已启动的后台任务，关闭服务会中断正在初始化或执行的任务，之后可在原会话继续，程序不会自动重跑需求。

## 首次登录后的配置

### 1. 管理员设置成员目录

打开「系统设置」，填写**成员目录基础路径**，例如 `D:\wt` 或 `/srv/web-coding`，保存后检查 Git 环境检测结果。

这是服务端路径，不是访问页面的电脑路径。保存时会创建所需目录并检查写入权限；Windows 建议选择短路径，给仓库内部文件和依赖留出路径长度空间。

### 2. 创建成员账号

管理员在「账号管理」中创建成员并分配初始密码。成员首次使用管理员分配或重置的密码登录时，需要修改密码。账号名统一为小写且全局唯一，当前不支持改名。

工作区属于创建者本人，其他成员及管理员都不能直接查看其私有工作区。个人使用时，也可以由管理员账号配置自己的 Git 账号和工作区。

### 3. 配置个人 Git 账号

成员打开「个人设置 → Git 账号」，新增账号并填写**完整的仓库克隆地址**：

- **HTTP / HTTPS**：输入用户名和密码，或 Git 服务支持的访问令牌；建议使用 HTTPS。
- **SSH**：点击「生成 SSH 密钥」，将公钥添加到 Git 服务，再检测并保存。私钥由服务器加密保存，不需手动填写。

点击「检测并保存 Git 账号」，当前配置检测成功后才会保存。测试验证读取权限，不代表具备推送权限。配置默认模型、思考强度和执行权限也是在「个人设置」中完成。

### 4. 创建工作区并等待克隆

点击最左侧工作区栏的「＋」，选择 Git 账号并输入远程仓库地址，提交创建。服务在后台克隆仓库，可从顶部「克隆任务」查看进度，完成后点击「打开工作区」。

每个工作区对应一个项目，路径自动生成，例如：

```text
D:\wt\alice\projects\project-a                         # 项目仓库
D:\wt\alice\worktree\project-a\login-a1b2c3d4e5f6        # 某个任务的 worktree
```

关闭页面或退出登录不会取消已受理的克隆；服务重启会中断克隆，且不会自动重试或覆盖遗留目录。

### 5. 配置任务基准与初始化命令

打开项目名旁的齿轮进入「工作区设置」：

| 设置 | 说明 |
| --- | --- |
| 基准引用 | 默认 `HEAD`，也可选择本地分支、远程跟踪分支、标签或填写提交 SHA |
| 初始化命令 | 每行一条，在新任务 worktree 创建后、Codex 启动前依次执行 |
| 提示词模板 | 可分别维护手动需求、TAPD 单条需求与融合需求的模板 |

例如，目标业务项目使用 npm，且确实提供 `build` 脚本时，可以填写：

```text
npm ci
npm run build
```

这里执行的是**目标业务项目**的命令，应按项目实际需要填写；没有准备步骤时可以留空。每条命令从 worktree 根目录开始，互不继承上一条的 `cd` 或环境变量修改。Windows 使用 `cmd`，Linux 使用 `sh`；最多 20 条，每条最多 4000 字符，单条超时 15 分钟。不要填写需要一直运行的开发服务器命令。

初始化失败、超时或被停止后不会启动 Codex，目录和日志会保留。工作区配置修改主要影响新任务；已有任务仍使用记录的会话、分支及 worktree 路径。

### 6. 按需配置 TAPD

只使用手动需求时可以跳过。在「工作区设置 → TAPD 渠道」填写：

1. TAPD 项目 ID，与本应用的工作区 ID 不同。
2. 包含 `dsc-token` 的完整单行 Cookie。
3. 可选的额外图片域名，每行一个完整主机名。

先点击「检测连接」，确认后再点击「保存 TAPD 配置」。检测不等于保存，Cookie 保存后加密入库且不回显；后续编辑留空会保留已有值。配置保存立即生效，不需要重启。

### 7. 开始第一个任务

点击「从需求启动」，选择「手动输入」填写标题、正文及图片，或选择 TAPD 需求；检查本次模型、思考强度和权限后启动。任务会创建独立 worktree，执行初始化命令，然后进入 Codex 会话。

页面能够正常登录、Git 连接检测成功、工作区克隆完成，就说明基本安装与配置已完成；模型调用发生在实际启动任务时。更详细的权限、审批、图片、需求融合和 Git 操作见 [使用手册](docs/user-guide.md)。

## 启动方式与常用命令

所有命令都在项目根目录执行，并使用本次部署选定的 `RUNNER_DATA_DIR`。

| 命令 | 用途 | 默认监听 |
| --- | --- | --- |
| `npm ci` | 安装锁文件中的依赖 | 无 |
| `npm run init:admin` | 交互创建初始管理员 | 无 |
| `npm run build` | 构建正式前端到 `web/dist` | 无 |
| `npm start` | 启动正式服务，需先构建 | `0.0.0.0:4317` |
| `npm run dev` | 前端热更新，后端保持运行 | `127.0.0.1:5173` |
| `npm run dev:watch` | 前端热更新，后端源码变化后自动重启 | `127.0.0.1:5173` |

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
# 自定义监听地址和端口
npm run dev -- --host 0.0.0.0 --port 5173
```

默认访问 [http://127.0.0.1:5173](http://127.0.0.1:5173)。页面、API、SSE 和热更新共用同一端口，无需额外启动 `npm start` 或配置前端代理；开发模式无需预先构建，但新数据目录仍需要先初始化管理员。

`dev` 修改前端后自动更新，修改后端需手动重启。`dev:watch` 监听 `src/` 的 CJS 和 `shared/` 的 JSON；后端重启会停止活动初始化及 Codex 轮次，并刷新页面、清空未发送草稿。实际任务运行期间，建议使用只热更新前端的 `dev`。

开发和正式服务可以使用不同的数据目录；不要让两个运行中的服务同时操作同一工作区。已有会话身份与 worktree 在重启后保留，不会自动重新执行任务。

## 配置与环境变量

生产配置主要通过页面维护：

| 位置 | 管理内容 | 生效范围 |
| --- | --- | --- |
| 个人设置 | Git 账号、通知、分组、默认模型、思考强度、执行权限 | 当前成员全部工作区 |
| 系统设置 | 成员目录基础路径、Git 环境检测 | 系统，由管理员维护 |
| 工作区设置 | 基准引用、初始化命令、TAPD、提示词模板 | 当前工作区 |

启动环境变量如下：

| 变量 | 默认行为 | 何时设置 |
| --- | --- | --- |
| `RUNNER_DATA_DIR` | 使用应用安装目录作为数据根 | 建议首次部署时设置为独立绝对路径，并保持固定 |
| `CODEX_BIN` | 自动从服务进程 `PATH` 及常见安装位置查找 Codex | 服务找不到 Codex 或安装位置特殊时指定入口路径 |
| `PUBLIC_ORIGIN` | 按直接连接的本机 IP、端口校验访问来源 | HTTPS 反代部署时设置，如 `https://coding.example.com`，不得包含路径或凭据 |
| `RUNNER_ENCRYPTION_KEY` | 自动生成并读取 `secrets/database.key` | 需要外部托管凭据主密钥时设置，格式为 64 位十六进制；已有数据须保持原密钥 |
| `BROWSER_CHANNEL` | Windows 测试使用 Edge，Linux/macOS 测试使用 Chromium | 仅浏览器测试选择渠道时使用，例如 `chromium` |

这些变量通过终端或服务管理器传给进程，修改后需重启。仓库没有要求创建 `.env` 的安装步骤，不要仅把变量写入文件便认为已经生效。Web 和开发服务均不接受 `--config`；不要照旧版本说明维护生产 JSON 配置。

Codex 需要由服务账号访问自己的认证与配置；systemd 不会自动加载交互式 shell 的 nvm 或 `.bashrc`。若终端能找到 Codex、服务却找不到，应检查服务的 `PATH` 或设置 `CODEX_BIN`，详细定位规则见 [部署说明](docs/deployment.md)。

## 数据目录与备份

```text
<RUNNER_DATA_DIR>/
  db/
    web-coding.sqlite      # 账号、设置、任务、历史、日志和图片 BLOB
    backups/               # 数据库升级前的一致性备份
  secrets/
    database.key           # 自动生成的凭据加密主密钥
  workspaces/              # Codex 图片缓存及必要执行锁

<成员目录基础路径>/
  <用户名>/
    projects/<项目名>/     # 克隆得到的项目仓库
    worktree/<项目名>/     # 各任务的独立 worktree
```

SQLite 是业务数据来源，不需要另行安装 MySQL 或 PostgreSQL。Git 项目、worktree 和 Codex 自身的会话资料仍在文件系统中，静态资源始终从应用安装目录的 `web/dist` 读取。

备份应覆盖：

1. **应用数据**：建议停止所有使用该数据目录的服务后备份完整数据目录。SQLite 使用 WAL，运行时不要只复制单个 `.sqlite` 文件；在线备份应使用 SQLite 的一致性备份机制。
2. **凭据主密钥**：单独妥善保管 `secrets/database.key`，或外部设置的 `RUNNER_ENCRYPTION_KEY`。数据库升级备份不包含主密钥。
3. **业务项目与任务目录**：包括未提交文件、未推送提交和 Git worktree 元数据。
4. **Codex 用户资料**：恢复继续执行所需的引擎资料与可用认证环境。

恢复时应使用对应的数据、密钥与业务目录，保留记录中的实际路径。仅恢复数据库不能重新创建任务代码和可执行会话。修改应用安装目录或系统基础目录不会搬移既有 worktree，旧任务继续使用记录的路径。

本版本不导入旧版生产 JSON/JSONL、旧工作区配置、runs 或 uploads；历史 Git／目录模型重构没有自动迁移方案。旧版部署请使用新的独立数据目录，旧资料保留原位。当前数据库结构内的后续升级由启动流程自动处理。

## 服务器部署与访问

前台启动适合本机体验。Linux 长期运行可使用 systemd，完整服务文件示例见 [部署说明](docs/deployment.md#linux-常驻服务)。配置时确保服务用户、Node.js 路径、Codex 认证、`RUNNER_DATA_DIR` 和业务目录权限与首次初始化一致。

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

适用于已经采用当前数据库模型的安装：

1. 等待当前任务完成，停止旧 Web 服务及相关 CLI 进程。
2. 备份数据、主密钥、业务目录及需要保留的 Codex 资料。
3. 在应用安装目录获取目标版本；使用 Git 且安装目录无待处理本地修改时，可执行 `git pull --ff-only`。
4. 执行 `npm ci` 和 `npm run build`。
5. 使用原来的服务账号、`RUNNER_DATA_DIR`、主密钥及业务目录重新启动。
6. 刷新页面，确认登录、工作区和历史会话可用，再继续原任务。

不要在每次升级时重复创建管理员。启动前自动执行尚未完成的数据库升级，并在需要升级时建立一致性备份；失败会拒绝启动，不会自动重新执行需求。

后端改动必须重启服务。仅更新前端且接口未变时，重新构建后刷新页面即可。不要只更新页面却让旧后端继续服务，否则可能出现“接口不存在”。异常遗留的 `db/.upgrade.lock` 应先确认相关进程均已停止，再按错误信息处理。

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
| TAPD 检测失败或图片读取失败 | 检查项目 ID、Cookie 是否包含有效 `dsc-token`、附件域名是否允许及服务器网络；不能读取的图片不会被静默忽略 |
| 重启后任务没有自动继续 | 属于预期行为，在原会话核对历史后继续；不确定是否已执行的操作不会自动重放 |
| 历史可看但代码或会话只读 | 检查原 worktree 是否仍存在且 Git 登记有效；只恢复数据库不足以恢复执行 |

## 项目结构与开发验证

```text
src/
  cli/              # 命令参数、初始化管理员、正式/开发服务入口
  http/             # Fastify、路由、认证、SSE 与静态资源
  application/      # 工作区、账号、任务和会话用例
  channels/         # TAPD、手动需求等来源适配
  execution/        # 通用任务准备与初始化执行
  codex/            # Codex 程序定位与会话协议
  git/              # 仓库、分支与 worktree 操作
  storage/          # SQLite、升级、凭据与持久化
  config/           # 运行配置与路径定位
  domain/           # 领域数据及校验
  shared/           # 后端通用工具
web/src/            # Vue 3 页面、功能组件与公共样式
shared/             # 前后端共用的数据契约
config/             # 配置示例，不是生产配置来源
test/               # 架构、单元、集成与浏览器测试
docs/               # 使用、部署与工程文档
Jenkinsfile         # Windows / Linux CI 流水线
```

开发、重构或代码审查前，请阅读 [AGENTS.md](AGENTS.md)、[工程契约索引](docs/engineering/index.md) 与相关契约。提交使用 Conventional Commits 和中文描述。不要提交本地凭据、`config/*.local.json`、`state/`、`runs/`、数据库、密钥或业务目录。

基础校验与构建：

```sh
npx eslint src test web/src web/vite.config.mjs
node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs
npm run build
```

Web 改动还需运行 Jenkinsfile 中的浏览器检查：

```sh
node test/browser/session.test.cjs
node test/browser/workspaces.test.cjs
node test/browser/dev.test.cjs
node test/browser/accounts.test.cjs
node test/browser/visual.test.cjs
```

测试使用 fake Codex、模拟 TAPD 和临时 Git 仓库，不执行真实需求、不修改 TAPD。测试文件统一命名为 `<kebab-case>.test.cjs`；夹具和共享辅助模块放在 `test/fixtures`、`test/support`，命名为 `<kebab-case>.cjs`。

Windows 浏览器测试默认使用本机 Edge；Linux/macOS 默认使用 Playwright Chromium。Linux 测试环境一般需要先运行 `npx playwright install --with-deps chromium`；Ubuntu 26.04 的兼容下载设置及 CI 节点准备见 [平台验证说明](docs/engineering/platform-verification.md)。这些浏览器依赖用于自动化测试，不是普通 Web 服务启动的前置步骤。截图输出到忽略的 `state/browser/`，视觉索引为 `state/browser/unified/index.html`。

## 更多文档

| 文档 | 内容 |
| --- | --- |
| [使用手册](docs/user-guide.md) | 工作区、Git 账号、提示词、TAPD 融合、权限、任务进度、会话和代码查看 |
| [部署说明](docs/deployment.md) | 独立安装、Codex 定位、Linux systemd、远程访问与平台差异 |
| [账号与数据库](docs/engineering/accounts-and-database.md) | 当前账号归属、设置范围、SQLite、认证与数据库升级契约 |
| [工程契约索引](docs/engineering/index.md) | 开发前需要阅读的行为约定 |
| [模块与目录规范](docs/engineering/architecture.md) | 模块职责、依赖边界、目录与测试命名 |
| [UI 设计契约](docs/engineering/ui-design.md) | 浅绿工作台设计变量、组件与响应式规范 |
| [平台验证说明](docs/engineering/platform-verification.md) | Windows / Linux 测试环境与 Jenkins 配置 |
