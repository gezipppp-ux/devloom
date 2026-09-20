# 前端模块边界

`main.js` 是唯一入口，负责挂载 Vue、注册表单组件，并从共享样式读取主题变量。

| 目录 | 职责 |
| --- | --- |
| `app/` | 导航壳层与应用 composable：工作区 URL 选择，以及跨功能的启动、刷新和 SSE 生命周期协调。 |
| `features/accounts/` | 登录、首次改密、账号管理、个人设置和成员桌面通知偏好。 |
| `features/workspaces/` | 工作区创建、编辑、切换入口和图标目录。 |
| `features/tasks/` | 需求启动表单、执行偏好与人员选择、任务列表快照、类型及人工进度。 |
| `features/session/` | 会话详情状态、历史分页、输入卡片和下一轮设置；消息、工具输出、审批与澄清、需求快照的安全渲染。 |
| `features/settings/` | 系统 Worktree 基础目录、服务器目录选择，工作区相对目录与项目执行设置、基准引用选择、TAPD 渠道设置和独立保存的提示词模板。 |
| `shared/components/` | 不依赖具体功能的界面组件，例如表单分区、模型/强度控件与权限选择器。 |
| `shared/api/` | HTTP 请求、页面令牌、工作区 API 路径、模型/权限能力发现和共享执行状态文案。 |
| `shared/styles/` | 全站设计变量、布局与基础控件样式。 |

依赖方向为 `main.js → app → features → shared`。应用壳层组合各功能；功能内的组件与辅助模块放在同一目录，功能之间通过壳层传入数据和事件协作。共享模块不引用应用或功能组件。

仓库根目录的 `shared/task-metadata.json`、`shared/workspace-icons.json` 和 `shared/codex-permissions.json` 是前后端共用契约；功能模块只读取它们，不复制枚举或图标目录。这里的 `shared/` 仅存放前端共享实现。

Vue 组件使用 PascalCase 文件名；JavaScript 辅助模块使用 kebab-case，例如 `workspace-icons.js`、`task-metadata.js`、`requirement-content.js`。入口 `main.js` 与请求模块 `api.js` 保持简短命名。

应用组件只组合界面和处理界面状态：`App.vue` 控制受保护页面的渲染边界；`WorkbenchApp.vue` 组合账号导航、设置页面与工作区，并持有工作区弹窗引用；`WorkspaceConsole.vue` 持有页面切换、输入草稿和滚动位置。数据生命周期按职责分离：

- `app/use-workspace-selection.js` 负责首次 bootstrap、工作区选择和 Vue Router query 更新；默认选择使用 replace 固定，页内切换使用 push，浏览器前进和后退同步恢复选择。`WorkbenchApp.vue` 按工作区 UUID 重建 console，隔离草稿及异步生命周期；重命名仅更新目录和标题，不重建 console。
- `app/router.js` 使用 Vue Router 管理登录、首次改密、工作台、个人设置、系统设置和账号管理；工作区仍由 query 参数选择。`App.vue` 在账号身份变化时重建整个受保护页面，`WorkbenchApp.vue` 在工作区变化时重建 console。导航保留其他 query、hash 和用户 history state。
- `shared/api/account-session.js` 保存当前账号和个人设置的内存投影，数据由数据库 API 持久化。401、SSE 身份失效以及跨标签退出清空投影；HTTP 请求带账号代际，迟到响应不能进入新账号。LocalStorage 只用作无业务内容的身份变化通知。
- `app/SystemSettings.vue` 仅组合管理员的全局存储设置；账号业务页面属于 `features/accounts/`：`LoginPage.vue` 负责登录，`PasswordPage.vue` 组合首次改密入口，两类改密入口复用 `PasswordForm.vue`；`PersonalSettings.vue` 管理账号默认模型、强度、权限、分组、通知和改密；`AccountManagement.vue` 管理账号身份，不提供读取他人工作区的入口。工作区配置仍由所有者在 `features/settings` 管理。
- `features/accounts/use-desktop-notifications.js` 拥有浏览器通知授权、个人通知偏好保存与通知投递；应用壳层将其设置状态传给个人设置页，并把投递回调传给工作区。账号功能不反向依赖应用壳层或其他功能目录。
- `features/settings/WorktreeStorageSettings.vue` 使用全局 `appApi` 独立加载和保存基础目录；`ServerDirectoryPicker.vue` 仅浏览服务器目录并返回选择，表单保存才生效。工作区设置只提交相对目录，前端完整路径用于预览，实际校验与拼接由服务端负责。
- 新 Worktree 路径采用「基础目录 / 用户名 / 工作区相对目录 / 任务前缀-短标识」，例如 `D:\wt\alice\project-a\login-a1b2c3d4e5f6`，任务只增加一层目录。账号名统一小写且全局唯一，当前不提供账号改名；特殊名称的目录转义由服务端负责，前端继续复用 `worktreeMemberPath` 和 `worktreeRoot`，不自行拼出成员目录。已有任务的记录路径与 session 身份保持不变，不移动旧目录。`features/tasks/ManualRequirementFields.vue` 的可选目录前缀最多 16 位；留空按标题生成，12 位短标识由服务端统一追加。系统设置的示例必须包含用户名层，并提示使用较短基础目录，例如 Windows 的 `D:\wt`。
- `app/use-workspace-console.js` 负责渠道 bootstrap、SSE 建连/关闭与防抖刷新，将事件分发给任务列表和会话状态，不处理 DOM 或表单草稿。
- `features/tasks/use-task-list.js` 负责列表刷新、请求乱序保护和请求期间的人工进度覆盖。
- `features/session/use-session.js` 负责详情快照、请求期间的 SSE 覆盖、会话动作和历史分页；执行偏好拥有独立保存状态和错误反馈，迟到响应不能覆盖较新的设置/当前轮状态。打开会话、收到消息和完成动作通过回调交给应用/界面层处理，不导入任务列表或界面组件。
- `features/session/SessionComposer.vue` 只组合输入、模型/权限控件和提示，通过事件提交消息与设置修改，不直接管理持久化。
- `features/settings/RepositoryGitPanel.vue` 提供工作区仓库状态、获取远端更新和快进更新基准分支；`features/session/SessionGitPanel.vue` 按当前任务读取未提交与上游提交差异，`DeleteWorktreeDialog.vue` 在打开时重新获取删除快照并校验完整分支确认。删除结果由应用壳层协调刷新会话和列表，历史保留为只读。不提供合并或冲突处理按钮。
- `shared/api/use-model-catalog.js`、`use-permission-modes.js` 分别拥有模型和权限能力加载、重试与卸载保护；`CodexModelControls.vue` 和 `PermissionSelect.vue` 只接收值/选项并发出变更，由创建表单或会话各自决定保存时机。

目录和职责调整不改变 API、URL、会话身份或运行数据路径。需求富文本只能经 `features/session/requirement-content.js` 的安全渲染入口处理。

样式沿用浅绿工作台规范，统一修改 `shared/styles/design-tokens.css` 与 `shared/styles/style.css`。验证遵循仓库契约：lint、单元测试、构建、浏览器回归；视觉改动还需模拟数据截图验证。
