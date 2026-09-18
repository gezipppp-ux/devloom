# 模块与目录规范

项目使用 Node.js CommonJS 后端和 Vue 3 前端。按职责放置后端代码，按功能组织前端；源码目录和运行数据目录分别管理。后端模块依赖由 `test/architecture/modules.test.cjs` 自动检查，前端目录、命名与依赖边界由 `test/architecture/frontend.test.cjs` 自动检查。

## 目录

```text
src/
  domain/          # 身份、类型、图标、图片格式、会话消息与纯校验
  shared/          # 与业务无关的路径工具
  storage/         # JSON 文件、运行记录、写锁与所有权
  config/          # 安装/数据位置、显式配置读取、执行设置与仓库选择
  git/             # Git 命令、仓库/引用查询、worktree 创建与身份校验
  codex/           # 命令定位、app-server RPC、模型/权限能力、CLI 会话
  execution/       # 通用任务流水线、初始化命令执行
  channels/        # 注册表及 tapd/、manual/ 来源适配器
  application/     # 工作区服务、会话命令/事件/查询/呈现与 TAPD 执行用例
  http/            # 本地 HTTP、路由、同源保护、SSE、静态资源
  cli/             # 参数/退出处理、web.cjs 服务入口、tapd/ 渠道命令入口
web/src/
  main.js          # Vue 挂载与主题入口
  app/             # 应用壳层、工作区选择、跨功能协调
  features/        # workspaces/、tasks/、session/、settings/
  shared/          # api/、components/、styles/
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
| execution | execution、codex、git、config、storage、domain、shared |
| channels | channels、config、storage、domain、shared |
| application | application 及以上模块 |
| http | http、application、domain、shared，以及 config/runtime 的安装位置 |
| cli | 组合命令所需的模块；其他模块不能依赖 cli |

禁止循环依赖和动态加载浏览器提交的模块名。渠道实现只依赖本渠道或通用模块，不能依赖其他渠道或反向依赖注册表。通用执行器通过渠道接口调用准备和流转，不导入 TAPD 实现；新增渠道在独立子目录实现并显式注册。domain 不进行文件、子进程和网络 I/O，storage/config 不直接启动子进程；Git 操作通过 git 模块调用。

纯校验放在 domain，JSON 持久化放在 storage，路径比较放在 shared，避免为了复用一个函数反向依赖整个执行模块。模块从实际归属文件导入函数，不用无关模块转导出它们。不要通过聚合入口加载有副作用的认证脚本。

## 职责划分

| 位置 | 拥有的职责 |
| --- | --- |
| `cli/arguments.cjs`、`cli/execute.cjs` | 命令参数、CLI 配置选择优先级、错误输出和退出码 |
| `cli/web.cjs`、`cli/tapd/*.cjs` | 进程入口和输入/输出适配；导出 main，以主模块保护执行 |
| `channels/tapd/` | 认证、浏览器采集、查询、素材准备和流程规则；接收显式参数，不读取 argv |
| `channels/manual/adapter.cjs` | 手动输入校验与渠道组合 |
| `channels/manual/uploads.cjs`、`task-package.cjs` | 上传生命周期；标题命名、图片复制和任务包 |
| `config/runtime.cjs` | 安装/数据根及显式配置文件读取；不猜测命令行参数 |
| `config/repository.cjs`、`git/` | 配置决定选择哪个仓库；git 负责验证、引用查询和 worktree 操作 |
| `execution/runner.cjs` | 准备、初始化、执行、渠道同步顺序及记录；通过回调通知调用方，不写终端 |
| `application/sessions.cjs` | 启动、继续、停止、操作互斥及生命周期协调 |
| `application/session-events.cjs` | Codex 事件、审批与执行完成状态处理 |
| `application/session-settings.cjs` | 会话执行设置校验、当前轮与下一轮选择、变更事件 |
| `codex/models.cjs`、`permissions.cjs`、`capabilities.cjs` | 模型发现与默认值解析、权限 RPC 映射、原生协议能力检查 |
| `application/session-views.cjs`、`session-presenter.cjs` | 历史/快照查询、公开返回结构和图片 URL |
| `storage/run-store.cjs` | 原始记录、快照、元数据、文件锁与安全附件路径；不做 Git 校验或拼 HTTP URL |
| `storage/message-images.cjs` | 按任务保存会话图片、校验文件完整性并匹配历史图片；公开图片 URL 由应用 presenter 生成 |
| `application/workspace-services.cjs` | 组合工作区配置、模型和渠道服务，供 HTTP 调用 |
| `http/server.cjs`、`api.cjs` | 同源保护、工作区路由和 HTTP 输入/响应映射 |
| `http/messages.cjs`、`assets.cjs`、`events.cjs` | 请求体/响应编码、静态与附件传输、SSE 订阅及清理 |

进程参数、终端输出、退出码及 `require.main` 只允许出现在 cli；HTTP 服务工厂可被测试导入，不自行启动。导入 CLI 也不得产生配置写入、浏览器连接或执行任务。关闭 HTTP 服务先停止接收请求，再清理 SSE 和会话，避免 EventSource 重连阻止关闭。

新增代码先判断属于输入适配、用例编排、渠道行为、纯规则还是基础设施，再放入对应模块。同一职责保持内聚；只在职责、依赖或生命周期不同的地方拆分，不以文件行数作为拆分依据。

## 前端与命名

前端依赖方向为 `main.js → app → features → shared`。功能目录内组合自己的组件；跨功能业务由 app 协调，共享组件不引用具体功能。样式继续使用既有浅绿工作台变量。详细说明见 [前端模块边界](../../web/src/README.md) 和 [渠道模块说明](../../src/channels/README.md)。

app 中的 `use-workspace-selection` 管理工作区与 URL，`use-workspace-console` 协调启动/SSE/刷新；tasks 的 `use-task-list` 拥有任务列表与元数据覆盖，session 的 `use-session` 拥有快照、流事件合并、消息动作和分页。Vue 壳层保留页面、草稿与滚动等呈现状态。异步操作必须保留请求身份、选择代际和卸载清理，避免过期 HTTP 响应覆盖新选择或 SSE。

目录、JS/CJS 文件与测试文件使用 `kebab-case`；Vue 组件使用 `PascalCase.vue`。后端显式写 `.cjs` 扩展名，前端本地导入显式写 `.js`/`.vue`。仅向外导出其他模块确实需要的函数；测试辅助程序不进入产品模块。

## 兼容与验证

- 对外命令仍使用 `npm run tapd:*`、`npm start`，实际文件入口由 package.json 维护。systemd 的源码入口使用 `src/cli/web.cjs`，`src/http/server.cjs` 仅导出服务工厂。
- 安装根由 `src/config/runtime.cjs` 定位；静态资源始终来自安装根 `web/dist`。`RUNNER_DATA_DIR` 只选择数据根。
- 开发入口 `src/cli/dev.cjs` 可以向 HTTP 工厂注入非 API 页面处理器，以同端口 Vite 中间件替代静态页面；正式入口仍固定使用 `web/dist`。仅开发页面增加 HMR 所需的同源 WebSocket 和 blob worker CSP，HTTP 与 WebSocket 均校验 Host/Origin，Vite 源码访问只允许 `web/`、`shared/` 和依赖目录。
- `src/cli/dev-watch.cjs` 拥有开发文件监听和子进程生命周期；变更合并后通过 IPC 请求关闭并等待旧进程退出，再启动替代进程。不能用 Windows 强制终止进程代替会话清理，也不能因热更新自动重跑需求。
- 目录调整不迁移运行数据，不改 API、渠道 ID、session ID、source、run key、记录中的 worktree 路径或历史素材文件名。
- `npm test` 显式运行 architecture、unit、integration 的 `*.test.cjs`；browser 和 fixtures 不参与自动单测发现，避免意外启动进程。
- 完整验证：`npm run lint`、`npm test`、`npm run build`、`npm run test:web`。界面和样式迁移还运行 `npm run test:visual`。所有验证使用模拟数据和临时仓库。
