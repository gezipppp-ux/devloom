# 前端模块边界

`main.js` 是唯一入口，负责挂载 Vue、注册表单组件，并从共享样式读取主题变量。

| 目录 | 职责 |
| --- | --- |
| `app/` | 导航壳层与应用 composable：工作区 URL 选择，以及跨功能的启动、刷新和 SSE 生命周期协调。 |
| `features/accounts/` | 登录、首次改密、账号管理、个人设置和成员桌面通知偏好。 |
| `features/workspaces/` | 工作区创建、编辑、切换入口和图标目录。 |
| `features/tasks/` | 需求启动表单、执行偏好与人员选择、任务列表快照、类型及人工进度。 |
| `features/session/` | 会话详情状态、历史分页、输入卡片和下一轮设置；消息、工具输出、审批与澄清、需求快照的安全渲染。 |
| `features/settings/` | 系统成员项目与任务目录、服务器目录选择、自动生成目录的项目执行设置、基准引用选择、TAPD 渠道设置和独立保存的提示词模板。 |
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
- `features/settings/MemberStorageSettings.vue` 使用全局 `appApi` 独立加载和保存成员目录基础路径，并展示 Git 环境检测；`ServerDirectoryPicker.vue` 仅浏览服务器目录并返回选择，表单保存才生效。工作区设置只读展示服务端生成的项目与任务路径。
- 新任务路径采用「基础目录 / 用户名 / worktree / 项目名 / 任务前缀-短标识」，例如 `D:\wt\alice\worktree\project-a\login-a1b2c3d4e5f6`；项目克隆目录为 `D:\wt\alice\projects\project-a`。仓库和路径均由创建工作区时的远程 Git 地址生成，前端只展示服务端返回值。个人设置维护系统生成的 SSH 密钥或 HTTP/HTTPS 账号密码／令牌。GitAccountSettings 复用表单分区，use-git-accounts 拥有加载、生成、检测、保存与卸载生命周期；展示公钥、服务端强制先检测后保存，私钥和密码不回显。
- `app/use-workspace-console.js` 负责渠道 bootstrap、SSE 建连/关闭与防抖刷新，将事件分发给任务列表和会话状态，不处理 DOM 或表单草稿。
- `features/tasks/use-task-list.js` 负责列表刷新、请求乱序保护和请求期间的人工进度覆盖。
- `features/tasks/ArchivedSessions.vue` 提供侧栏归档入口、名称搜索、恢复和删除交互；`use-archived-sessions.js` 拥有归档请求、恢复状态与卸载/乱序保护。壳层通过归档、删除、恢复与重连事件通知刷新，并通过插槽组合 session 功能的删除确认窗口，功能之间不互相导入。删除目标独立于列表快照保存，刷新或提前到达的 SSE 不卸载正在提交的确认窗口；恢复后不自动启动任务或切换当前草稿。
- 会话名称由 `SessionTitleEditor.vue` 独占标题行，长名称换行；编辑使用完整宽度的多行输入区，保存/取消同排并支持输入法。状态、人工分类和生命周期操作在下方独立工具栏呈现。
- `features/session/use-session.js` 负责详情快照、请求期间的 SSE 覆盖、会话动作和历史分页；执行偏好拥有独立保存状态和错误反馈，迟到响应不能覆盖较新的设置/当前轮状态。打开会话、收到消息和完成动作通过回调交给应用/界面层处理，不导入任务列表或界面组件。
- `features/session/SessionComposer.vue` 只组合输入、模型/权限控件和提示，通过事件提交消息与设置修改，不直接管理持久化。
- `features/settings/RepositoryGitPanel.vue` 提供工作区仓库状态、获取远端更新和快进更新基准分支；`features/session/SessionGitPanel.vue` 按当前任务读取实时检出分支、未提交与上游提交差异，`DeleteWorktreeDialog.vue` 在打开时重新获取删除快照并校验记录任务分支的完整确认。删除结果由应用壳层协调刷新会话和列表，历史保留为只读。不提供合并或冲突处理按钮。
- `features/session/SessionLifecycleControls.vue` 提供会话页面的归档和删除按钮；`SessionLifecycleDialog.vue` 是会话页面和归档列表共用的确认窗口。归档仅隐藏列表项，永久删除可先清理 Worktree，或显式选择强制删除并输入完整本地分支名，一并放弃本地文件和提交。服务端确认清理完成后，由壳层移除当前视图或打开下一条可见会话；在途列表响应不能恢复已移除项。
- `shared/api/use-model-catalog.js`、`use-permission-modes.js` 分别拥有模型和权限能力加载、重试与卸载保护；`CodexModelControls.vue` 和 `PermissionSelect.vue` 只接收值/选项并发出变更，由创建表单或会话各自决定保存时机。

目录和职责调整不改变 API、URL、会话身份或运行数据路径。需求富文本只能经 `features/session/requirement-content.js` 的安全渲染入口处理。

工作区创建提交后台任务：`features/workspaces/use-workspace-clones.js` 拥有账号作用域的进度轮询、提交和迟到响应保护；壳层组合 `WorkspaceCloneProgress.vue` 的全局入口，完成后补充工作区列表，由用户点击打开，不抢占正在编辑的任务。关闭弹窗、刷新与重新登录从服务器恢复状态。`WorkspaceIconEditor.vue` 默认只显示预览，通过独立原生弹窗搜索和选择；Escape 只关闭图标弹窗并恢复焦点，父表单草稿保留。

样式沿用浅绿工作台规范，统一修改 `shared/styles/design-tokens.css` 与 `shared/styles/style.css`。验证遵循仓库契约：lint、单元测试、构建、浏览器回归；视觉改动还需模拟数据截图验证。
