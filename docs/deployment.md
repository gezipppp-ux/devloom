# 独立安装与 Windows / Linux 部署

应用为独立的 `web-coding` 项目。运行代码、前端构建、lint 与测试的依赖都在本项目声明，不需要 Vben、NestJS 或外部 workspace catalog。保留 `tapd:*` 命令用于渠道认证和排查。

## 独立安装

需要 Node.js **22.13+**（推荐当前 LTS）、npm、Git，以及已安装并登录的 Codex CLI。将应用源码复制到单独目录；不复制 `node_modules`、运行记录和凭据。

```sh
cd /opt/requirement-runner
npm ci
npm run build
npm start -- --port 4317
```

如果本机 npm registry 配置异常，安装时可显式指定 `--registry https://registry.npmjs.org`。依赖由本项目的 `package-lock.json` 锁定，使用 `npm ci` 安装。

Windows 也支持上述 npm 命令。`npm run tapd:web` 会先构建再启动，生产部署可先构建一次然后 `npm start`。

更新源码后需要重新构建前端并重启 Web 服务。服务不会热加载后端代码；只构建或刷新页面可能使新版页面连接旧接口，出现“接口不存在”。确认没有执行中的任务后停止原服务，再从当前安装目录运行 `npm start -- --port 4317`，并刷新浏览器。重启继续使用同一 `RUNNER_DATA_DIR`，保留已有会话及 worktree。

## 持久化与配置

安装目录、运行数据、业务仓库和 worktree 可以分别放在不同位置：

| 内容            | 示例                          |
| --------------- | ----------------------------- |
| 应用安装        | `/opt/requirement-runner`     |
| 运行数据        | `/var/lib/requirement-runner` |
| 业务 Git 仓库   | `/srv/repos/product`          |
| Worktree 根目录 | `/srv/worktrees`              |

启动前设置 `RUNNER_DATA_DIR` 为运行数据目录。每个工作区的数据在 `workspaces/<UUID>/`：`config.json` 保存该项目执行配置和 TAPD 凭据，`runs/` 保存任务，`uploads/` 保存暂存图片。未设置变量时在应用目录下创建 `workspaces/`。静态页面始终取自安装包的 `web/dist`。

首次进入页面创建工作区，再配置项目仓库和 TAPD。Cookie 可以直接在 Web 保存、替换、清除及检测，无需 Linux 图形桌面。检测只读且不保存草稿。旧的全局配置、runs 和 uploads 不迁移、不被新版 Web 读取，可以停止旧服务后清理。不要删除业务仓库。

Web 不再接受 `--config`。CLI 使用 `--app-workspace <UUID>` 或 `RUNNER_WORKSPACE` 选择同一工作区；CLI 显式 `--config` 仍可用于独立排查。不要将凭据写入 service 文件或版本控制。

登录 Codex 的用户必须与运行服务的用户一致。在 Web「执行设置」中选择服务端的代码仓库、worktree 根目录和基准分支。Linux 路径区分大小写，不接受 Windows 盘符路径。

Windows 路径需带完整盘符（例如 `D:\repos\project`）或使用 UNC 共享路径；`\repos\project`、`/repos/project` 依赖当前磁盘，不能作为明确的服务端绝对路径。中文、空格和 Windows 扩展路径可用于仓库及 worktree。Linux 保留路径中的空格并按大小写匹配。

配置和任务元数据采用读取最新值后原子替换的短锁更新，认证刷新保留现有工作区字段与配置版本。若进程异常退出留下 `config.json.lock`、`task-metadata.json.lock` 或 `run.json.lock`，应确认所有写入者已停止后再清理对应锁目录；不要删除任务数据或业务 worktree。

Web 与 CLI 自动定位 Codex 的顺序：

1. `codex.command`，其次环境变量 `CODEX_BIN`。显式配置不可用时直接提示修正，不回退到其他程序。
2. 服务进程的 `PATH`。
3. 当前 Node 所在目录、`~/.local/bin`、`~/.npm-global/bin`。
4. Linux/macOS 的 `/usr/local/bin`、`/usr/bin`、`/bin`；Windows 的 `%APPDATA%/npm` 和 `%LOCALAPPDATA%/OpenAI/Codex/bin`（包含按修改时间从新到旧检查的版本子目录）。

Linux 候选必须具有执行权限；npm 的 `codex.js` 入口通过当前 Node 启动，避免依赖 shell 初始化。Windows 标准 npm `codex.cmd` 也使用相邻 `node_modules/@openai/codex/bin/codex.js`，不会执行任意 `.cmd`、`.bat`、`.ps1` 内容。

迁移到 Linux 时删除旧的 Windows `codex.command`（以及与旧安装绑定的 `command_args`），再启用自动查找。systemd 不会自动读取 `.bashrc` 或 nvm 初始化脚本；如果 Codex 安装在另一套 Node 或自定义目录中，需要在 service 中添加该目录到 `PATH`，或设置 `Environment=CODEX_BIN=/absolute/path/to/codex`。修改 service 后执行 `systemctl daemon-reload` 并重启服务；Web 中保存工作区配置无需重启；手动修改 Codex 启动程序路径后需要重启。

现有 session 不会因为设置改动而迁移。跨主机迁移还需要对应的 Codex 用户数据、业务仓库与 worktree 的 Git 元数据；仅复制 `run.json` 不足以恢复执行，路径不一致的历史会话保持只读。

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
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node /opt/requirement-runner/src/cli/web.cjs --port 4317
Restart=on-failure
TimeoutStopSec=120
UMask=0077

[Install]
WantedBy=multi-user.target
```

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

然后打开 `http://127.0.0.1:4317`。这与现有 Host/Origin 验证兼容。当前版本是单用户执行服务，不提供远程登录体系，公网部署需要另行设计鉴权。

`--host` 接受 IPv4/IPv6 地址字面量。服务校验 Host 中的 IP、端口与连接实际到达的本机地址一致，并保持 Origin、跨站请求及 POST 令牌校验；不从 `Forwarded` 或 `X-Forwarded-*` 推断访问来源。

直接嵌入或测试 `createWebServer()` 时，HTTP 工厂内部仍默认监听 `127.0.0.1`；CLI 入口负责传入默认值 `0.0.0.0`。

## 验证

初始化和 CLI 超时/停止时，Linux 终止独立进程组，Windows 使用 `taskkill /t` 清理普通子进程树。初始化适用于安装、构建等有明确结束时间的命令；主动脱离进程组的守护程序需要由独立服务管理。

```sh
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:web
```

浏览器 smoke 在 Linux/macOS 默认使用 Playwright Chromium；Windows 默认使用本机 Edge。`BROWSER_CHANNEL` 可显式选择已安装的浏览器渠道。执行核心与 HTTP 测试不依赖浏览器、真实模型或 TAPD 写入。

完整检查可直接运行 `npm run verify`，包含视觉截图。双平台 CI 节点准备和运行步骤见 [平台验证说明](engineering/platform-verification.md)。

Ubuntu 26.04 使用当前 Playwright 版本安装测试浏览器时，需要显式选择兼容下载目标；具体命令见平台验证说明中的 Ubuntu 26.04 小节。
