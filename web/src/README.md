# 前端模块边界

`main.js` 是唯一入口，负责挂载 Vue、注册表单组件，并从共享样式读取主题变量。

会话文件查看归 `features/session/`：`file-reference.js` 解析本地链接，`SessionItem` 发出文件请求，app 仅协调侧栏开关；`use-session-files.js` 拥有文件/列表请求与代际隔离，`SessionFilePanel`、`SessionChangedFiles` 呈现预览和 Git 列表，`code-content.js` 处理高亮与差异行。高亮库仅在打开文件侧栏时加载。文件内容始终由后端按会话的 Worktree 校验，前端不拼接服务器磁盘路径。

| 目录 | 职责 |
| --- | --- |
| `app/` | 导航壳层与应用 composable：工作区 URL 选择，以及跨功能的启动、刷新和 SSE 生命周期协调。 |
| `features/accounts/` | 登录、首次改密、账号管理、个人设置和成员桌面通知偏好。 |
| `features/projects/` | 部门／仓库目录、项目与权限、成员、需求／Bug、资产、开发空间及事项与执行任务关联。 |
| `features/workspaces/` | 工作区创建、编辑、切换入口和图标目录。 |
| `features/tasks/` | 需求启动表单、执行偏好与人员选择、任务列表快照、类型及人工进度。 |
| `features/session/` | 会话详情状态、历史分页、输入卡片和下一轮设置；消息、工具输出、审批与澄清、需求快照的安全渲染。 |
| `features/settings/` | 系统成员项目与任务目录、服务器目录选择、自动生成目录的项目执行设置、基准引用选择、TAPD 渠道设置和独立保存的提示词模板。 |
| `shared/components/` | 不依赖具体功能的界面组件，例如表单分区、模型/强度控件与权限选择器。 |
| `shared/api/` | HTTP 请求、页面令牌、工作区 API 路径、模型/权限能力发现和共享执行状态文案。 |
| `shared/styles/` | 全站设计变量、布局与基础控件样式。 |

依赖方向为 `main.js → app → features → shared`。应用壳层组合各功能；功能内的组件与辅助模块放在同一目录，功能之间通过壳层传入数据和事件协作。共享模块不引用应用或功能组件。

需求／Bug 新增与编辑共用 `features/projects/IssueFields.vue`；五类正文通过共享 `MarkdownEditor`、`MarkdownContent` 和 `shared/components/markdown-content.js` 安全渲染。原 `features/session/requirement-content.js` 保留会话入口及图片／链接规则。项目附件草稿由 `use-project-attachments.js` 管理，读取完成后生成正文链接并同步序列化；保存前不上传，取消、卸载和上下文切换撤销 blob URL，迟到读取不得插回其他草稿。保存冲突保留附件并支持原有逐字段合并。

`MarkdownEditor` 默认懒加载 `VisualMarkdownEditor`（Tiptap），提供可视图文编辑，另保留 Markdown 源码和预览模式。图片节点仅通过已验证映射显示，文档保留原始附件路径，blob URL 不得序列化入正文。剪贴板 HTML 只取纯文本，不作为可执行内容解析。源码到可视化的转换先检查语义等价，不支持无损转换时保留原文。初始化、外部合并、移除附件和上下文重置建立新的撤销基线，普通编辑保留撤销／重做；异步插图使用映射后的光标书签，源码模式在读取附件期间禁用输入，避免位置漂移。

项目协作版本以「我的项目」为默认首页，`/projects/:projectId` 展示按权限开放的业务页面。`/?workspace=<id>&task=<runKey>` 进入本人已准备的执行空间，个人创建空间入口不再提供。系统入口为部门与权限、仓库目录、账号管理和系统设置。项目页面的请求和写入生命周期由 `shared/api/use-resource.js` 处理，项目组件按项目 ID 重建；定期重检项目权限，撤权时移除不可访问内容。项目内容按纯文本展示，附件下载经过项目和资源归属校验，不渲染外部未过滤 HTML。下列历史执行工作台组件说明只适用于被授权的开发空间。

仓库根目录的 `shared/task-metadata.json`、`shared/workspace-icons.json` 和 `shared/agent-permissions.json` 是前后端共用契约；功能模块只读取它们，不复制枚举或图标目录。这里的 `shared/` 仅存放前端共享实现。

Vue 组件使用 PascalCase 文件名；JavaScript 辅助模块使用 kebab-case，例如 `workspace-icons.js`、`task-metadata.js`、`requirement-content.js`。入口 `main.js` 与请求模块 `api.js` 保持简短命名。

应用组件只组合界面和处理界面状态：`App.vue` 控制受保护页面的渲染边界；`WorkbenchApp.vue` 组合账号导航、设置页面与工作区，并持有工作区弹窗引用；`WorkspaceConsole.vue` 持有页面切换、输入草稿和滚动位置。数据生命周期按职责分离：

- `app/use-workspace-selection.js` 负责首次 bootstrap、工作区选择和 Vue Router query 更新；默认选择使用 replace 固定，页内切换使用 push，浏览器前进和后退同步恢复选择。`WorkbenchApp.vue` 按工作区 UUID 重建 console，隔离草稿及异步生命周期；重命名仅更新目录和标题，不重建 console。
- `app/router.js` 使用 Vue Router 管理登录、首次改密、工作台、个人设置、系统设置和账号管理；工作区仍由 query 参数选择。`App.vue` 在账号身份变化时重建整个受保护页面，`WorkbenchApp.vue` 在工作区变化时重建 console。导航保留其他 query、hash 和用户 history state。
- `shared/api/account-session.js` 保存当前账号和个人设置的内存投影，数据由数据库 API 持久化。401、SSE 身份失效以及跨标签退出清空投影；HTTP 请求带账号代际，迟到响应不能进入新账号。LocalStorage 只用作无业务内容的身份变化通知。
- `app/SystemSettings.vue` 仅组合管理员的全局存储设置；账号业务页面属于 `features/accounts/`：`LoginPage.vue` 负责登录，`PasswordPage.vue` 组合首次改密入口，两类改密入口复用 `PasswordForm.vue`；`PersonalSettings.vue` 管理账号默认模型、强度、权限、分组、通知和改密；`AccountManagement.vue` 管理账号身份，不提供读取他人工作区的入口。工作区配置仍由所有者在 `features/settings` 管理。
- `features/accounts/use-desktop-notifications.js` 拥有浏览器通知授权、个人通知偏好保存与通知投递；应用壳层将其设置状态传给个人设置页，并把投递回调传给工作区。账号功能不反向依赖应用壳层或其他功能目录。
- `features/settings/MemberStorageSettings.vue` 使用全局 `appApi` 独立加载和保存成员目录基础路径，并展示 Git 环境检测；`ServerDirectoryPicker.vue` 仅浏览服务器目录并返回选择，表单保存才生效。工作区设置只读展示服务端生成的项目与任务路径。
- `features/settings/EnvironmentPage.vue` 由系统设置内的「环境检测」分类组合，展示工具、最新版本、目录检查和直接更新、安装器不可用原因与待重启状态。`use-environment.js` 拥有检测、版本查询、更新与轮询生命周期；卸载清理计时器并丢弃迟到响应。更新确认展示确切版本，失败和未知状态独立呈现，不将网络错误视为已经最新。
- 项目开发空间按稳定项目／用户 ID 定位，新仓库目录为「基础目录 / projects / 项目 ID / members / 用户 ID / repository-准备修订号」，任务使用同根的「worktree / 任务」。失败目录保留，明确重试使用新的准备修订号目录，已就绪空间沿用记录路径。GitAccountSettings 维护主机凭据和独立提交作者；保存与实际项目仓库检测分开，私钥和密码不回显。个人空间创建组件只用于明确的文件测试夹具，不作为生产导航入口。
- `app/use-workspace-console.js` 负责渠道 bootstrap、SSE 建连/关闭与防抖刷新，将事件分发给任务列表和会话状态，不处理 DOM 或表单草稿。
- `features/tasks/use-task-list.js` 负责列表刷新、请求乱序保护和请求期间的人工进度覆盖。
- `features/tasks/TapdRequirementPicker.vue` 复用多选、ID 添加与顺序调整；`use-tapd-selection.js` 拥有检索请求和代际隔离。`AppendRequirements.vue` 与 `use-requirement-additions.js` 管理已有任务的追加草稿与保存；app 通过需求抽屉插槽组合这些组件，避免 session 直接依赖 tasks。原始与追加资料均由 session 的 `RequirementDetails.vue` 安全渲染，明确区分待处理、已发送和发送结果待确认；继续按钮通过 app 调用会话动作，SSE 更新完整资料且不会清空会话草稿。
- `features/tasks/ArchivedSessions.vue` 提供侧栏归档入口、名称搜索、恢复和删除交互；`use-archived-sessions.js` 拥有归档请求、恢复状态与卸载/乱序保护。壳层通过归档、删除、恢复与重连事件通知刷新，并通过插槽组合 session 功能的删除确认窗口，功能之间不互相导入。删除目标独立于列表快照保存，刷新或提前到达的 SSE 不卸载正在提交的确认窗口；恢复后不自动启动任务或切换当前草稿。
- 会话名称由 `SessionTitleEditor.vue` 呈现，长名称换行，编辑图标紧随标题。编辑区最大 1040px，字数说明位于标签旁，取消/保存在宽屏时紧邻输入区、窄屏时移到下方，并保留输入法处理。壳层将面包屑并入会话标题区，执行状态与刷新在宽屏时对齐标题行，编辑时位于表单上方；`SessionDetailsDrawer.vue` 拥有右侧信息、Git、需求抽屉的呈现状态、键盘关闭及焦点恢复。抽屉默认收起、独立滚动，打开时不压缩对话列；切换资料保留草稿、滚动位置与子组件状态，切换会话重建抽屉。任务元数据控件由 app 通过插槽组合，不跨功能导入。
- `features/session/use-session.js` 负责详情快照、请求期间的 SSE 覆盖、会话动作和历史分页；执行偏好拥有独立保存状态和错误反馈，迟到响应不能覆盖较新的设置/当前轮状态。打开会话、收到消息和完成动作通过回调交给应用/界面层处理，不导入任务列表或界面组件。
- `features/session/SessionComposer.vue` 只组合输入、模型/权限控件和提示，通过事件提交消息与设置修改，不直接管理持久化。
- 会话的 `agent` 元数据提供执行引擎名称和能力；界面不解析原生 RPC 方法。交互请求使用 `kind`、`action`、`blocking` 和 `questions` 等通用字段；未知请求默认阻塞且不展示批准按钮。图片、续聊和执行中补充指令按引擎能力开放，缺少能力声明时不可操作。模拟数据也必须提供当前协议的引擎元数据。
- 权限选项以服务端能力发现结果为准，加载中、失败或当前模式不可用时禁止创建任务、启动新轮次及保存个人默认值。向执行中的轮次补充指令沿用该轮实际权限，不受下一轮权限发现失败影响。保留已选择的值和草稿，不将未知模式降为默认权限；通过刷新或重新选择可用模式恢复操作。
- `features/settings/RepositoryGitPanel.vue` 提供工作区仓库状态、获取远端更新和快进更新基准分支；`features/session/SessionGitPanel.vue` 按当前任务读取实时检出分支、未提交与上游提交差异，`DeleteWorktreeDialog.vue` 在打开时重新获取删除快照并校验记录任务分支的完整确认。删除结果由应用壳层协调刷新会话和列表，历史保留为只读。不提供合并或冲突处理按钮。
- `features/session/SessionLifecycleControls.vue` 提供会话页面的归档和删除按钮；`SessionLifecycleDialog.vue` 是会话页面和归档列表共用的确认窗口。归档仅隐藏列表项，永久删除可先清理 Worktree，或显式选择强制删除并输入完整本地分支名，一并放弃本地文件和提交。服务端确认清理完成后，由壳层移除当前视图或打开下一条可见会话；在途列表响应不能恢复已移除项。
- `shared/api/use-model-catalog.js`、`use-permission-modes.js` 分别拥有模型和权限能力加载、重试与卸载保护；`AgentModelControls.vue` 和 `PermissionSelect.vue` 只接收值/选项并发出变更，由创建表单或会话各自决定保存时机。

目录和职责调整不改变 API、URL、会话身份或运行数据路径。需求富文本只能经 `features/session/requirement-content.js` 的安全渲染入口处理。

Codex 回复的流式内容和历史消息统一经 `features/session/message-content.js` 解析 Markdown 并过滤 HTML。源码 HTML 按原文显示，Markdown 图片不加载，链接仅允许 HTTP、HTTPS 和 mailto；用户消息与工具输出保留纯文本。代码块和宽表格在自身区域滚动，不扩大对话宽度。

生产开发空间由项目权限自动分配，ProjectDevelopment 提交凭据绑定与异步准备，刷新从服务器读取状态。历史文件夹具中的 WorkspacePicker、use-workspace-clones 不进入生产创建流程；旧个人创建 HTTP 接口明确拒绝。

项目详情使用 `tab` 分区与 `issue`、`task`、`asset` 查询参数定位对象；项目 `task` 是开发任务 ID，工作台 `task` 是原生 run key，不混用。进入工作台时记录同项目来源 `returnTo`，返回时恢复原事项或任务。准备环境使用 `returnTab`/`returnIssue` 保留来源，不自动开始执行。

工作台会话选择同步到 URL 的 `task`；前进、后退及刷新恢复对应会话。相同工作区不因 `task` 改变而重建控制台，使用现有选择代际隔离迟到响应。资产提交只清理该次请求对应的草稿；保存期间新增修改保留，后续提交使用新修订号。协作查看权限撤销时清除评论／交付缓存及草稿，并使旧请求失效。

图文编辑器的内部剪贴板通过随机引用读取当前页面内存中的文档片段，保留格式与持久图片身份，不接受剪贴板提供的文档 JSON 或 HTML。跨字段粘贴图片需在目标附件映射中可用；外部正文替换、上下文切换或卸载清除对应内存片段。外部富文本继续采用纯文本，图片附件仍通过既有校验与上传流程。

ProjectPermissionEditor 在部门模式显示功能上限，在成员模式显示工作内容组合；组合与依赖使用共享权限目录，前端预览不能替代后端校验。ProjectMembers 成功修改后通知项目壳层刷新有效权限。事项与设置的 EditConflict 以编辑基线、草稿、最新版本作三方合并；同会话刷新使用 refresh，不触发打开时的草稿重置。

样式沿用浅绿工作台规范，统一修改 `shared/styles/design-tokens.css` 与 `shared/styles/style.css`。验证遵循仓库契约：lint、单元测试、构建、浏览器回归；视觉改动还需模拟数据截图验证。
