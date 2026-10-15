# 模块与目录规范

项目使用 Node.js CommonJS 后端和 Vue 3 前端。按职责放置后端代码，按功能组织前端；源码目录和运行数据目录分别管理。后端模块依赖由 `test/architecture/modules.test.cjs` 自动检查，前端目录、命名与依赖边界由 `test/architecture/frontend.test.cjs` 自动检查。

生产持久化和账号约定见 [账号与数据库](./accounts-and-database.md)。Fastify 负责 HTTP 生命周期及会话插件；PostgreSQL、Prisma 迁移、BLOB、账号与会话存储均属于 storage。原有 JSON 路径在数据库模式下只是存储资源标识，不在磁盘保存业务 JSON，也不回读旧数据。显式文件配置和隔离测试保留文件适配。

## 目录

```text
src/
  domain/          # 身份、类型、图标、图片格式、会话消息与纯校验
  shared/          # 与业务无关的路径工具
  storage/         # PostgreSQL、迁移、账号、运行记录、BLOB、写锁与文件适配
  config/          # 安装/数据位置、显式配置读取、执行设置与仓库选择
  git/             # Git 命令、仓库/引用查询、worktree 创建与身份校验
  codex/           # Codex 原生协议、进程与条目转换
  agents/          # 显式 provider 注册、Codex 适配器与标准会话接口
  execution/       # 通用任务流水线、初始化命令执行
  channels/        # 注册表及 manual/ 来源适配器
  application/     # 工作区服务、会话命令/事件/查询/呈现与任务执行用例
  http/            # 本地 HTTP、路由、同源保护、SSE、静态资源
  cli/             # 参数/退出处理、web.cjs 服务入口
web/src/
  main.js          # Vue 挂载与主题入口
  app/             # 应用壳层、工作区选择、跨功能协调
  features/        # accounts/、projects/、workspaces/、tasks/、session/、settings/
  shared/          # api/、components/、styles/、i18n/
shared/            # 前后端共用的 JSON 目录与枚举
test/
  architecture/    # 依赖/环、渠道隔离、入口归属、命名与安装根约束
  unit/            # 隔离的模型、渠道 API、图片与域名验证
  integration/     # 执行、存储、HTTP、工作区和临时 Git 仓库
  browser/         # 会话、工作区与视觉浏览器回归
  fixtures/        # Fake Codex/app-server 与并发测试子进程
  support/         # 临时目录、模拟响应及通用测试数据
docs/engineering/  # 行为契约与架构规则
```

根目录的 `config/` 存放配置示例；`src/config/` 是读取与校验配置的代码。根目录 `shared/` 是公开数据契约，`src/shared/` 和 `web/src/shared/` 分别是后端、前端共享实现。

## 后端依赖

| 模块 | 允许依赖 |
| --- | --- |
| shared | shared |
| domain | domain、shared，以及根 shared 下的 JSON |
| storage | storage、domain、shared |
| git | git、domain、shared |
| config | config、git、storage、domain、shared |
| codex | codex、domain、shared |
| agents | agents、codex、domain、shared |
| execution | execution、agents、git、config、storage、domain、shared |
| channels | channels、config、storage、domain、shared |
| application | application、agents、channels、execution、git、config、storage、domain、shared |
| http | http、application、domain、shared，以及 config/runtime 的安装位置 |
| cli | 组合命令所需的模块；其他模块不能依赖 cli |

禁止循环依赖和动态加载浏览器提交的模块名。渠道实现只依赖本渠道或通用模块，不能依赖其他渠道或反向依赖注册表。通用执行器通过渠道接口调用准备和流转，不导入具体渠道实现；新增渠道在独立子目录实现并显式注册。domain 不进行文件、子进程和网络 I/O，storage/config 不直接启动子进程；Git 操作通过 git 模块调用。

纯校验放在 domain，SQL、持久化格式和文件适配放在 storage，路径比较放在 shared，避免为了复用一个函数反向依赖整个执行模块。application 不直接导入文件系统或底层 Git 命令，而调用存储和 Git 操作接口；执行流水线通过 ExecutionStore 管理运行记录与锁。模块从实际归属文件导入函数，不用无关模块转导出它们。不要通过聚合入口加载有副作用的认证脚本。

项目协作重构的 PostgreSQL 基础约定见 [postgresql.md](./postgresql.md)。根目录 `prisma/` 的 schema 与迁移归 storage；`generated/` 仅含忽略的生成产物。仅 `storage/postgres-database.cjs` 可导入确切的 `generated/prisma-runtime/client.cjs` 入口；其他层不得直接导入 Prisma、pg 或生成客户端。该边界由架构检查约束，不开放任意生成目录导入。

## 职责划分

| 位置 | 拥有的职责 |
| --- | --- |
| application/mcp-token-services.cjs、mcp-project-services.cjs、mcp-presenter.cjs | 外部 Agent Token 生命周期、按当前授权查询和原子发布；公开结构不暴露凭据、私人会话或配置 |
| storage/mcp-store.cjs、domain/mcp-access.cjs | 前者拥有 MCP/临时上传 Token 摘要、附件暂存、幂等操作与审计，后者拥有纯输入及 scope 校验 |
| http/mcp-api.cjs、mcp-tools.cjs | 临时令牌 HTTP 附件上传、无状态 Streamable HTTP MCP、工具 schema；复用应用用例，不直接操作存储 |
| application/mcp-skills-presenter.cjs、http/skills-page.cjs | 前者拥有公开技能文档的中英文内容，后者负责 HTML/Markdown 协商与页面呈现；无需登录且不包含账号数据或凭据 |
| `cli/arguments.cjs` | Web 与开发服务的命令参数校验 |
| `cli/init-admin.cjs`、`cli/web.cjs` | 管理员初始化和 Web 服务进程入口；导出 main，以主模块保护执行 |
| `domain/setup-state.cjs`、`application/setup-services.cjs`、`setup-presenter.cjs` | 初始化输入/步骤规则、短事务用例与公开快照；外部环境和文件探测不进入数据库事务 |
| `storage/setup-store.cjs`、`http/setup-api.cjs` | 部署状态、初始管理员创建门禁及请求去重持久化；HTTP 仅适配初始化服务 |
| `channels/manual/adapter.cjs` | 手动输入校验与渠道组合 |
| `channels/channel-registry.cjs` | ChannelRegistry 校验并注册渠道接口、组合渠道默认配置 |
| `channels/manual/manual-upload-store.cjs`、`task-package.cjs` | ManualUploadStore 管理上传生命周期；任务包模块管理标题命名、图片复制和任务包 |
| `config/runtime.cjs` | 安装/数据根及显式配置文件读取；不猜测命令行参数 |
| `config/repository.cjs`、`git/` | 配置决定选择哪个仓库；git 负责验证、引用查询和 worktree 操作 |
| `execution/runner.cjs` | 准备、初始化、执行、渠道同步顺序及记录；通过回调通知调用方，不写终端 |
| `application/project-services.cjs`、`project-presenter.cjs` | 部门、项目及其仓库地址、成员权限和个人开发空间生命周期；公开字段由 presenter 脱敏 |
| `application/workbench-services.cjs`、`work-action-presenter.cjs`、`attention-services.cjs` | 按当前分派、真实执行和权限聚合个人动作；首页、完整队列与通知使用同一快照，不把资源列表等同于待办 |
| `storage/work-action-store.cjs`、`work-action-query-store.cjs`、`domain/workflow-actions.cjs` | 步骤轮次与分派的原子持久化、聚合候选查询、职责与栏目纯规则；详细定义见流程动作契约 |
| `application/project-workflow-services.cjs`、`workflow-execution-services.cjs`、`storage/workflow-execution-store.cjs` | 统一交接门禁、持久真实执行事件与幂等恢复；状态和处理人原子更新，失败不重放 Agent |
| `application/project-content-services.cjs`、`project-content-presenter.cjs` | 按不可变流程版本流转事项、评论／交付、项目附件、资产加密与独立敏感字段授权 |
| `application/project-lifecycle-services.cjs`、`project-lifecycle-presenter.cjs` | 项目发布版本与归档门禁；storage 拥有事务与修订号 |
| `application/system-workflow-services.cjs`、`system-workflow-presenter.cjs` | 系统管理员维护需求／Bug 全局流程与不可变发布版本，项目授权读取已发布版本；`domain/issue-workflows.cjs` 拥有图规则，`storage/system-workflow-store.cjs` 拥有无项目归属的流程持久化 |
| `application/project-development-services.cjs`、`project-development-presenter.cjs` | 认领／指派规划、唯一活跃认领、内容快照、显式幂等启动、完成／取消及追加／发送；通过业务事件协调事项交接，不读取资产 |
| `application/project-branch-services.cjs`、`git/remote-branches.cjs` | 前者复核个人空间、凭据归属与权限；后者实时查询 origin 的分支，不以本地缓存回退 |
| `storage/project-store.cjs`、`project-content-store.cjs`、`project-development-store.cjs` | 上述项目业务的 Prisma 持久化、修订号更新、同项目关联、加密和审计 |
| `application/session-manager.cjs` | SessionManager 协调启动、继续、停止、操作互斥及生命周期 |
| `application/workspace-manager.cjs` | WorkspaceManager 组合工作区默认配置、公开摘要与各工作区的会话生命周期 |
| `application/account-services.cjs`、`account-presenter.cjs` | AccountServices 组合账号权限、偏好、登录会话和生命周期接口；presenter 负责账号公开结构，HTTP 不穿透读取存储对象 |
| `application/git-account-services.cjs`、`git-account-presenter.cjs` | GitAccountServices 组合 SSH 生成、个人主机凭据保存、独立提交作者身份及显式项目仓库连接检测；presenter 仅返回账号公开字段 |
| `storage/git-account-store.cjs`、`git/account-credentials.cjs` | 前者拥有个人 Git 账号、加密密钥草稿及修订号条件更新；后者为 Git 子进程隔离凭据，不负责数据库或公开响应 |
| `git/host-login.cjs` | 不依赖项目的 Git 主机登录验证：HTTP 当前用户 API 与 OpenSSH 公钥认证，脱敏失败反馈及临时密钥清理；应用服务拥有归属与授权复核 |
| `application/session-events.cjs` | 标准 Agent 事件、交互请求与执行完成状态处理 |
| `application/session-settings.cjs` | 会话执行设置校验、当前轮与下一轮选择、变更事件 |
| `application/session-requirements.cjs`、`storage/run-requirements-store.cjs` | 分别负责追加资料的空闲/归属门禁与显式发送用例，以及来源唯一性、追加快照和发送状态的原子持久化 |
| `application/session-git.cjs`、`repository-services.cjs` | Git 状态及操作用例、运行与所有权门禁、删除进度和只读会话 |
| `application/session-files.cjs`、`session-file-presenter.cjs`、`git/task-files.cjs` | 分别负责会话文件读取门禁、公开文件/候选/差异响应，以及受限 Worktree 文件定位、Git 基准与文本差异读取 |
| `git/repository-operations.cjs`、`task-operations.cjs` | 远端获取/快进更新、任务 Git 状态、Worktree 身份校验和目录/本地分支删除 |
| `storage/git-operations.cjs` | 按共享 Git 目录的操作互斥及最近获取记录；任务删除进度由 RunStore 保存 |
| `codex/models.cjs`、`permissions.cjs`、`capabilities.cjs` | 模型发现与默认值解析、权限 RPC 映射、原生协议能力检查 |
| `codex/app-server-client.cjs` | AppServerClient 启动 Codex app-server 子进程，管理 JSON-RPC 请求、响应和连接生命周期 |
| `application/session-views.cjs`、`session-presenter.cjs` | 历史/快照查询、公开返回结构和图片 URL |
| `storage/run-store.cjs` | 原始记录、快照、元数据、文件锁与安全附件路径；不做 Git 校验或拼 HTTP URL |
| `storage/message-image-store.cjs` | MessageImageStore 按任务保存会话图片、校验文件完整性并匹配历史图片；公开图片 URL 由应用 presenter 生成 |
| `storage/workspace-store.cjs`、`domain/workspace.cjs` | WorkspaceStore 拥有工作区目录布局与配置持久化，在目录锁内维护名称唯一性；domain 拥有身份和输入校验 |
| `storage/account-store.cjs`、`account-passwords.cjs`、`auth-session-store.cjs` | 分别负责账号及个人设置持久化、密码散列编码、登录会话与签名密钥；纯账号输入规则位于 domain/account |
| `storage/database-lifecycle.cjs`、`database-registry.cjs` | 数据库初始化、升级与连接登记；初始化精确匹配数据根，资源寻址只在对应已登记数据库内路由 |
| `storage/execution-store.cjs` | ExecutionStore 拥有单次执行的长生命周期锁、运行记录和需求快照；CLI 状态查询从这里读取 |
| `storage/file-lock.cjs`、`json-files.cjs`、`run-state.cjs` | 分别拥有同步文件写锁、原子 JSON 写入、运行状态更新语义；不在写锁内等待网络或 Git |
| `application/workspace-services.cjs` | 组合工作区配置、模型和渠道服务；新任务合并个人执行默认值，区分省略与显式清空，供 HTTP 调用 |
| `application/workspace-clone-manager.cjs`、`workspace-clone-presenter.cjs` | 后台克隆生命周期、完成发布事务与只读进度响应；不绑定浏览器连接 |
| `storage/workspace-clone-store.cjs`、`git/clone-process.cjs`、`clone-progress.cjs` | 分别拥有克隆任务持久化/幂等/归属，Git 长进程，以及受限进度解析；通用进程树终止归 `shared/process-tree.cjs` |
| `application/system-services.cjs` | 组合成员项目与任务目录基础路径、Git 环境检测及服务端目录浏览，供全局 HTTP 路由调用 |
| `application/environment-services.cjs`、`environment-presenter.cjs` | 组合环境探测、官方版本查询、管理员更新门禁、进程内更新状态及公开响应；原始启动命令不进入 DTO |
| `execution/environment-tools.cjs`、`shared/tool-process.cjs` | 前者拥有工具探测、固定版本来源及受限 npm 更新流程；后者提供无 shell 的限时进程执行、PATH 与 npm 启动器定位 |
| `execution/system-tool-updates.cjs` | 校验 Windows 工具安装归属、nvm 1/2 与 winget 固定版本安装；安装完成验证与当前服务运行版本分开呈现 |
| `execution/linux-tool-installs.cjs` | Linux Git 缺失时查询 APT/DNF 稳定候选版本、既有安装与账号权限，执行固定版本安装并验证 |
| `storage/environment-checks.cjs`、`domain/tool-version.cjs` | 分别负责目录写权限探测和不含 I/O 的版本比较 |
| `config/system-settings.cjs`、`worktree-location.cjs` | 成员存储根目录配置与写权限校验、自动生成任务路径的实际落盘边界校验 |
| `storage/directories.cjs`、`domain/member-project-paths.cjs` | 分别负责服务端目录枚举及不含 I/O 的单目录名称校验、成员目录名称和路径拼接 |
| `http/server.cjs`、`api.cjs` | 同源保护、工作区路由和 HTTP 输入/响应映射 |
| `http/messages.cjs`、`assets.cjs`、`events.cjs` | 请求体/响应编码、静态与附件传输、SSE 订阅及清理 |

进程参数、终端输出、退出码及 `require.main` 只允许出现在 cli；HTTP 服务工厂可被测试导入，不自行启动。导入 CLI 也不得产生配置写入、浏览器连接或执行任务。关闭 HTTP 服务先停止接收请求，再清理 SSE 和会话，避免 EventSource 重连阻止关闭。

新增代码先判断属于输入适配、用例编排、渠道行为、纯规则还是基础设施，再放入对应模块。同一职责保持内聚；只在职责、依赖或生命周期不同的地方拆分，不以文件行数作为拆分依据。

## 前端与命名

前端依赖方向为 `main.js → app → features → shared`。功能目录内组合自己的组件；跨功能业务由 app 协调，共享组件不引用具体功能。登录、改密、账号管理、个人设置与通知偏好位于 `features/accounts/`；app 保留路由与跨功能壳层。新 UI 目标采用 B 方案中性协作设计；正式 Vue 使用中性主题、共享呈现组件及 `shared/i18n` 国际化，详见 [UI 重构 PRD](../prd/ui-refactor.md)。实施入口为项目内 [工程 Skill](../../.agents/skills/web-coding-engineering/SKILL.md) 和 [界面 Skill](../../.agents/skills/web-coding-ui/SKILL.md)，详细说明见 [前端模块边界](../../web/src/README.md) 和 [渠道模块说明](../../src/channels/README.md)。

app 中的 `use-workspace-selection` 管理工作区与 URL，`use-workspace-console` 协调启动/SSE/刷新；tasks 的 `use-task-list` 拥有会话列表和标题更新，session 的 `use-session` 拥有快照、流事件合并、消息动作和分页。Vue 壳层保留页面、草稿与滚动等呈现状态。异步操作必须保留请求身份、选择代际和卸载清理，避免过期 HTTP 响应覆盖新选择或 SSE。

目录、JS/CJS 文件与测试文件使用 `kebab-case`；Vue 组件使用 `PascalCase.vue`。后端类使用 `PascalCase`，单独放在对应的 `kebab-case.cjs` 文件，例如 `SessionManager` 位于 `application/session-manager.cjs`；类名应表达管理、存储或客户端等实际职责，所在目录由其依赖和职责决定。后端显式写 `.cjs` 扩展名，前端本地导入显式写 `.js`/`.vue`。仅向外导出其他模块确实需要的函数；测试辅助程序不进入产品模块。架构测试检查目录、文件、类名、依赖方向和循环；前端静态导入、动态导入与转导出都纳入检查。

## 测试文件命名

- `test/architecture`、`test/unit`、`test/integration`、`test/browser` 下的测试文件统一使用 `<kebab-case>.test.cjs`。浏览器测试入口和被入口调用的断言模块均遵循此规则，例如 `accounts.test.cjs` 与 `account-preferences.test.cjs`。
- 纯夹具、模拟客户端和通用辅助模块分别放在 `test/fixtures`、`test/support`，使用 `<kebab-case>.cjs`，不使用 `.test` 后缀。
- 重命名时同步更新 `require` / `import`、Jenkins 命令和文档中的路径；架构检查按目录强制校验文件名，不为浏览器测试保留例外。
- 浏览器测试仍由 Jenkins 中列出的入口组合运行，断言模块由对应入口调用。Node 测试命令显式限定 architecture、unit、integration，避免对整个 `test/` 自动发现而重复启动浏览器或夹具进程。

## 兼容与验证

- 对外 npm 命令为 `init:admin`、`dev`、`dev:watch`、`build` 和 `start`，实际文件入口由 package.json 维护。systemd 的源码入口使用 `src/cli/web.cjs`，`src/http/server.cjs` 仅导出服务工厂。
- 安装根由 `src/config/runtime.cjs` 定位；静态资源始终来自安装根 `web/dist`。`RUNNER_DATA_DIR` 只选择数据根。
- `http/page-routes.cjs` 统一开发和生产服务的页面入口匹配，与 Vue Router 的页面路径保持一致。直接访问或刷新项目详情、工作队列等页面均返回 `index.html`，保留查询参数中的对象身份；`/404` 及浏览器导航到未知页面时以 HTTP 404 返回应用入口，显示公共错误页并保留原地址。API、MCP、Vite 源码和缺失静态资源不回退为应用 HTML，未构建时仍返回原构建错误。
- 开发入口 `src/cli/dev.cjs` 可以向 HTTP 工厂注入非 API 页面处理器，以同端口 Vite 中间件替代静态页面；正式入口仍固定使用 `web/dist`。仅开发页面增加 HMR 所需的同源 WebSocket 和 blob worker CSP，HTTP 与 WebSocket 均校验 Host/Origin，Vite 源码访问只允许 `web/`、`shared/` 和依赖目录。
- `src/cli/dev-watch.cjs` 拥有开发文件监听和子进程生命周期；变更合并后通过 IPC 请求关闭并等待旧进程退出，再启动替代进程。不能用 Windows 强制终止进程代替会话清理，也不能因热更新自动重跑需求。
- 目录调整不迁移运行数据，不改 API、渠道 ID、session ID、source、run key、记录中的 worktree 路径或历史素材文件名。
- `node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs` 显式运行 architecture、unit、integration 的 `*.test.cjs`；browser 和 fixtures 不参与自动单测发现，避免意外启动进程。
- 完整验证由 Jenkinsfile 运行 eslint、上述 Node 测试、`npm run build` 和浏览器脚本。界面和样式迁移还运行 `node test/browser/visual.test.cjs`。所有验证使用模拟数据和临时仓库。

CLI Agent 的配置、协议与生命周期边界见 [Agent 契约](./agents.md)。application/execution 不直接依赖 codex；原生协议只留在 codex 与 provider adapter 内，前端使用通用请求 DTO。
