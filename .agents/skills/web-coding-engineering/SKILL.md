---
name: web-coding-engineering
description: 在 web-coding 项目开发、重构或 review 后端与 Vue 前端时，落实职责分层、目录和类命名、存储与账号边界，并修复违反工程契约的代码；纯文案编辑不触发全量代码审查。
---

# Web Coding 工程规范

用于本仓库的代码实现、重构和审查。目标是让每个模块的名字、位置、依赖和实际职责一致；根据确证问题调整代码，不为统一形式增加包装层或拆分文件。

## 先定位当前契约

以下链接均相对本 Skill；执行命令时使用仓库根目录。先读 [README](../../../README.md)、[工程索引](../../../docs/engineering/index.md) 与 [架构规范](../../../docs/engineering/architecture.md)，再只读取涉及的详细契约：

- 账号、鉴权、设置作用域或持久化：[账号与数据库](../../../docs/engineering/accounts-and-database.md)。生产环境的 Fastify、SQLite 和所有者隔离约定优先于旧文档的匿名访问及 JSON/JSONL 描述。
- 会话、执行、审批、流事件：[Web/CLI](../../../docs/engineering/web-cli.md)。
- 工作区与 Git 操作：[工作区](../../../docs/engineering/workspaces.md)。
- 渠道与项目执行设置：[渠道与设置](../../../docs/engineering/channels-and-settings.md)、[渠道模块](../../../src/channels/README.md)。
- Vue 功能与交互：[前端边界](../../../web/src/README.md)。界面实现同时使用 [web-coding-ui](../web-coding-ui/SKILL.md)。

先检查当前 diff，保留已有工作。本文给出实施流程，详细接口和业务行为以仓库契约为准；修改契约时同步实现与检查，不能借历史规则恢复已经淘汰的行为。

## 按职责选位置

| 职责 | 所属位置与边界 |
| --- | --- |
| 身份、枚举、输入及状态规则 | `src/domain/`，不含文件、SQL、网络和进程 I/O，也不构造公开 DTO |
| 数据库、升级、凭据编码、缓存及文件锁 | `src/storage/`，拥有数据格式；业务层通过存储接口访问 |
| 配置来源和仓库选择 | `src/config/`，Git 验证调用 Git 模块，不自行启动进程 |
| 仓库查询与变更 | `src/git/`，包含 Git 命令、提交解析与 Worktree 身份校验 |
| Codex 协议和进程传输 | `src/codex/`，不识别具体渠道或 HTTP 页面 |
| 通用执行顺序 | `src/execution/`，通过渠道接口与 ExecutionStore 协调，不内嵌渠道实现或持久化格式 |
| 来源规则 | `src/channels/<channel>/`，不依赖其他渠道或反向依赖注册表 |
| 用例、权限门禁、生命周期、公开响应 | `src/application/`；公开结构由 presenter 构造；不直接操作文件或拼 Git 命令 |
| HTTP 协议、认证插件、路由和 SSE | `src/http/`；调用应用服务，不穿透服务对象读写 store，不拥有默认值合并等业务规则 |
| 参数、进程入口、终端输出与退出码 | `src/cli/`；可组合依赖，业务与种子数据编排交给应用服务；导入入口必须无副作用 |

完整的依赖矩阵以架构规范及 `test/architecture/modules.test.cjs` 为准。新增依赖不能绕过分层，禁止通过无关模块转导出函数。

前端遵循 `main.js → app → features → shared`：

- `app/` 保留路由、壳层和跨功能协调；账号表单、需求表单、会话和设置逻辑归各自 `features/`。
- 功能之间由 app 组合数据与回调，不直接互相导入。共享组件不引用 app 或 features。
- `shared/api/` 可保存跨功能的请求、身份和代际基础设施，不应承载某一个页面的业务流程。
- composable 拥有请求/订阅生命周期；组件拥有呈现状态。账号、工作区、任务切换与卸载后，迟到响应不得覆盖新上下文。

## 名称表达实际职责

- 目录、JS/CJS 和测试文件用 kebab-case，Vue 组件及类用 PascalCase；本地导入显式写扩展名。
- `test/architecture`、`test/unit`、`test/integration`、`test/browser` 中的测试文件统一命名为 `<kebab-case>.test.cjs`，包括浏览器入口和被入口调用的断言模块，例如 `account-preferences.test.cjs`。纯夹具和共享辅助模块放在 `test/fixtures`、`test/support`，使用 `<kebab-case>.cjs`，不添加 `.test` 后缀。
- 每个后端命名类放在对应的 kebab-case 文件中，如 `SessionManager` → `application/session-manager.cjs`、`AppServerClient` → `codex/app-server-client.cjs`、`WorkspaceStore` → `storage/workspace-store.cjs`。
- Manager 表示生命周期协调，Store 表示持久化，Client 表示外部协议客户端，Presenter 表示公开结构转换。按真实职责选名，不把所有模块强制改成类。
- 迁移文件时一并更新调用方、测试、脚本入口和契约链接；只有职责、依赖或生命周期不同才拆分，不按文件行数机械拆分。
- 升级脚本遵守现有版本命名；已发布脚本不可为了命名整齐而改名或重写。

## 修改时必须保留的行为

- 保留已记录的 session、source、run key、分支和 Worktree 路径；代码目录调整不迁移业务 Worktree，不重跑不确定的任务。
- 新任务的个人默认值由应用层合并；区分字段省略、显式清空和非法类型。后续设置不回写已有任务快照。
- 校验工作区所有者后才能读取任务、附件、工作区偏好或建立该工作区的 SSE；全局个人设置按当前账号鉴权，不要求先选择工作区。管理员身份不自动授予他人工作区访问权。账号权限不等于操作系统租户隔离。
- SQLite 事务和短写锁不跨越网络、Git 或 Codex 等待。业务数据以数据库为准；图片文件只是受验证的缓存，显式文件适配不变成生产旧数据回退。
- Codex 执行状态、渠道流转状态和人工进度分别保存。只有真实执行开始事件才能触发渠道流转。
- 异步完成要再次确认账号/任务/轮次归属；释放订阅、缓存和锁时，只处理当前操作拥有的资源。错误或未知状态不能伪装为成功或零值。

## 审查与验证闭环

审查时先列出问题的触发条件、违反的职责或行为、最小调整范围，再修实现和必要回归。仅有文件较大、抽象较少或个人命名偏好，不构成拆分依据。新增合法功能目录时同步契约与架构检查，不通过删除断言或宽泛白名单掩盖越层。

代码变更运行 `npm run lint`、`npm test`、`npm run build`；Web 变更还运行 `npm run test:web`；布局、样式或组件位置调整运行 `npm run test:visual` 并检查相关截图。纯 Skill/文档修改校验 frontmatter 和链接即可，不因此运行真实业务或强制重构无关代码。

回归使用临时 SQLite、临时 Git、fake Codex 和模拟 TAPD。不得拿真实需求、生产数据库或 TAPD 写操作验证实现。运行数据、凭据、日志和截图不提交。若需要提交，使用中文描述的 Conventional Commit。

交付说明实际修复、验证结果和未验证平台；不把 Skill 校验通过等同于代码正确，也不声称审查能证明不存在其他缺陷。
