# 前端模块边界

`app/NotFoundPage.vue` 是 `/404` 与未匹配页面路径共用的公共错误页，未登录时也可显示，不读取账号或业务数据。它保留原访问路径（不显示查询参数），复用语言和主题设置，返回工作台时仍经过正常身份门禁；返回上一页只接受有效的站内历史，没有可用历史则回到工作台。开发和生产页面入口及 HTTP 404 状态由 `src/http/page-routes.cjs` 统一判定，接口、MCP 和缺失静态资源不进入此页面。

个人设置的 MCP 接入由 features/accounts/McpTokenSettings.vue 管理，按需读取 Token 和项目范围。采用极简接入布局：连接配置、最近两枚 Token 和附件上传入口；完整列表与 Token 详情按需展开，创建表单和上传说明单独显示。创建时仅在当前组件内存展示一次明文，返回、关闭或卸载即清除。McpConnectionHelp.vue 提供客户端切换与身份验证，McpUploadHelp.vue 提供 HTTP 二进制上传和附件 ID 引用，创建表单保留可展开的上传示例。代码始终使用凭据占位符，不插入真实 Token；Pi 仅提供通用连接参数，不假定具体 MCP 扩展的配置格式。请求使用 useResource 的账号／卸载隔离；桌面和窄屏代码片段在本身区域滚动。

`main.js` 是唯一入口，负责挂载 Vue、注册表单组件，并从共享样式读取主题变量。

所有下拉选择使用 `shared/components/AppSelect.vue`，统一弹层、选中标记、禁用状态、键盘操作和深浅色；顶栏通过 `ToolbarSelect` 提供紧凑与图标样式。组件支持 `v-model`／`value`、`options` 分组、搜索、清空、多选和 `footer` 刷新区域；旧表单可保留 `<option>` 内容并用 `native-events` 接收 `{ target: { value, selectedOptions } }`。`required` 与禁用 fieldset 保留表单校验，弹窗或管理浮层中的选项挂在当前 dialog／popover 内以保持可交互。业务查询与提交仍由各功能组件负责，页面不直接使用原生 select 或组件库 Select。

人员选择统一启用 `AppSelect` 的 `search-pinyin`，在当前已授权候选项内按显示名称、用户名、中文、全拼和拼音首字母过滤，不区分大小写；多选搜索保留已选人员，清空搜索恢复候选列表。包括事项责任人／关注人、当前／下一处理人、开发指派／转派、项目负责人／成员、资产负责人及交付验证人。候选资格和提交仍由功能及服务端校验，搜索不查询额外账号或改变人员 ID。

外观由 `shared/styles/theme.js` 管理：默认跟随系统，也可通过顶栏头像前的 `ThemeSelect` 选择浅色或暗色。选择作为设备偏好保存在本机 `web-coding.theme`，跨标签同步；系统外观变化仅在跟随系统时生效。入口在挂载前应用主题并同步组件库算法和设计变量，卸载时释放监听；切换不重建页面、不清除草稿、不保存业务设置。全站颜色与原生控件 `color-scheme` 位于 `design-tokens.css`。

全局待处理由 `features/accounts/use-attention-notifications.js` 持有一个账号隔离的轮询与去重基线，`AttentionNotifications` 在顶栏和工作台复用同一状态；通知跳转原会话或交付详情，操作仍由原服务重新鉴权。首次静默、失败不重复、静音期间的新项不在重新开启时补发。`AuthenticationLayout` 统一登录与首次改密的品牌和语言入口。

项目概览读取真实项目动态、版本目标日期和完成进度；工作台近期项目读取账号独立的服务端访问记录。进入项目成功读取后只记录一次访问，后台刷新不反复记录。版本范围通过现有按 `releaseId` 查询呈现需求和 Bug，继续使用原详情深链。桌面会话在实际可用区域足够时默认展开执行上下文，保留信息／Git／需求与收起操作，中小屏仍为折叠抽屉，代码与资料互斥且切换不清除草稿。

项目顶栏根据当前子页显示新建版本、新建资产或添加成员，复用所属功能的创建状态和提交流程；权限不足或归档时不回退显示无关的事项操作。成员添加、调整授权和恢复在共享模态窗口内完成，保存期间禁止关闭，取消与 Escape 返回触发按钮。需求／Bug 详情隐藏项目标题及项目导航，提供返回事项入口，使用独立标题、正文与右侧事项信息／关联开发布局；原有状态流转、附件、讨论、交付、历史和编辑冲突流程保留。

国际化使用 `vue-i18n`，语言资源与日期／数字格式化集中于 `shared/i18n/`。默认简体中文，支持英文；`LocaleSelect` 在登录、首次改密、初始化及主壳层复用。选择保存在本机 `web-coding.locale`，设置文档 `lang` 并同步组件库语言；切换不改变账号、业务输入、查询或执行状态。界面文案在呈现处翻译，带变量的句子使用命名插值；事项正文、自定义流程名、提示词、代码和上游诊断保留原文。新的界面文案需要同时补齐英文资源；不要通过重建组件或给路由添加语言 key 实现切换。

项目卡片和项目动态复用 `shared/components/RelativeTime.vue`：当天不足一分钟显示「刚刚」，不足一小时显示分钟，不足六小时显示小时，其余显示「今天」；前一个本地自然日显示「昨天」，更早显示日期，跨年补年份。组件每 30 秒更新、卸载时清理计时器，悬停显示完整本地时间；通过默认作用域插槽的 `text` 添加「更新」等上下文文案。格式规则位于 `shared/i18n/relative-time.js`，跟随当前语言和浏览器时区，异常时间显示未知、未来时间显示完整日期时间。

跨项目的工作台、搜索与事项／本人开发／交付队列由 `features/projects/` 组合；`PageHeader`、`FilterBar`、`EmptyState`、`PagePagination`、`StatusBadge`、`ModalDialog` 为共享呈现组件。分页、权限及提交由所属业务组件和 API 负责。项目内需求／Bug 分类保留完整批量分配和版本筛选，主「事项」提供统一跨项目查询。

事项创建、独立开发和历史会话入口共用 `ProjectPickerDialog` 的精简项目列表；App 拥有按操作筛选项目和路由协调，取消与重开使旧空间查询失效。`GlobalSearch` 使用输入框与紧凑结果行，`use-global-search.js` 拥有最近项目读取、200ms 防抖、部分失败和卸载／查询代际隔离，沿用真实聚合接口与 `workLocation` 深链。`ModalDialog` 的 header 插槽承载专用头部，原生模态负责焦点限制，关闭或卸载恢复触发点焦点。交互约定见[项目选择与快捷搜索](../../docs/prd/quick-entry.md)。

原型对齐后的项目目录使用 `ProjectCard`，项目概览由 `ProjectDashboard` 组合真实事项／交付计数、当前版本和项目资产；请求失败显示错误与重试，不把未知计数显示为零。`WorkItemTable` 复用事项和开发队列的桌面表格／移动条目；`WorkItemList` 呈现交付等完整工作列表。项目详情的主导航为概览、版本、资产、成员、设置、提示词，其余协作入口在展开菜单中保留原深链。

`SettingsLayout` 复用个人设置与管理中心的分类导航；`app/SystemSettings.vue` 组合账号、部门、流程、供应商、环境、目录及初始化记录，原 `/accounts`、`/departments`、`/system?tab=` 地址继续生效。个人设置按资料与偏好、Git、MCP、账号安全组织；切换分类保留资料与默认值草稿，离开敏感凭据页面清理组件内明文。新建账号／项目使用共享模态框，账号列表的管理菜单保留原有操作。

页面布局在 `shared/styles/workbench-pages.css` 中对齐 B 原型，基础 `style.css` 先于应用样式加载。表单在大屏限制行宽，窄屏列表和设置分类重排；移动导航保留完整可访问名称。项目提示词采用作用域切换、模板分类与限宽编辑区，继续复用 `PromptTemplateEditor` 的光标位置插入占位符与纯文本示例预览；项目默认、个人覆盖和修订冲突流程保留。

会话文件查看归 `features/session/`：`file-reference.js` 解析本地链接，`SessionItem` 发出文件请求，app 仅协调侧栏开关；`use-session-files.js` 拥有文件/列表请求与代际隔离，`SessionFilePanel`、`SessionChangedFiles` 呈现预览和 Git 列表，`code-content.js` 处理高亮与差异行。高亮库仅在打开文件侧栏时加载。文件内容始终由后端按会话的 Worktree 校验，前端不拼接服务器磁盘路径。

| 目录 | 职责 |
| --- | --- |
| `app/` | 导航壳层与应用 composable：工作区 URL 选择，以及跨功能的启动、刷新和 SSE 生命周期协调。 |
| `features/accounts/` | 登录、首次改密、账号管理、个人设置和成员桌面通知偏好。 |
| `features/projects/` | 部门、项目及仓库地址、权限与成员、需求／Bug、资产、开发空间及事项与执行任务关联。 |
| `features/workspaces/` | 工作区创建、编辑、切换入口和图标目录。 |
| `features/tasks/` | 需求启动表单、人员选择、任务列表快照和未读状态。共享执行偏好控件位于 `shared/components/AgentModelSettings.vue`。 |
| `features/session/` | 会话详情状态、历史分页、输入卡片和下一轮设置；消息、工具输出、审批与澄清、需求快照的安全渲染。 |
| `features/settings/` | 系统成员项目与任务目录、服务器目录选择、自动生成目录的项目执行设置、基准引用选择、独立保存的提示词模板。 |
| `shared/components/` | 不依赖具体功能的界面组件，例如表单分区、模型/强度控件与权限选择器。 |
| `shared/api/` | HTTP 请求、页面令牌、工作区 API 路径、模型/权限能力发现和共享执行状态文案。 |
| `shared/styles/` | 全站设计变量、布局与基础控件样式。 |

项目「提示词」由 `ProjectPromptSettings` 管理 Bug、需求和补充模板的项目默认和当前成员覆盖，独立保存、修订号冲突合并和卸载请求隔离沿用项目功能基础。`shared/components/PromptTemplateEditor` 提供占位符插入及纯文本预览，不读写任何项目数据。待开发任务在选择起始分支的启动表单中填写可选补充提示词，点击「启动 Codex 开发」时一并提交并保存到执行快照；刷新状态或启动前校验失败保留本地草稿，任务切换后清空，任务信息保存不提交该字段。

依赖方向为 `main.js → app → features → shared`。应用壳层组合各功能；功能内的组件与辅助模块放在同一目录，功能之间通过壳层传入数据和事件协作。共享模块不引用应用或功能组件。

`app/SetupPage.vue` 组合首次初始化：管理员表单位于 `features/accounts`，环境安装和目录选择位于 `features/settings`，步骤、非敏感草稿与结果位于 `features/setup`，通过 app 插槽协作。`shared/setup-steps.json` 为前后端步骤契约。路由和渲染门禁依据服务端初始化状态；全新空部署直接创建管理员并自动登录。UUID 提交复用公共 HTTP 兼容生成器，未知结果重试沿用原请求。密码在保存退出和卸载时清除，迟到响应受账号代际和组件生命周期保护。无首次登录冒泡引导。

需求／Bug 新增与编辑共用 `features/projects/IssueFields.vue`；五类正文通过共享 `MarkdownEditor`、`MarkdownContent` 和 `shared/components/markdown-content.js` 安全渲染。原 `features/session/requirement-content.js` 保留会话入口及图片／链接规则。项目附件草稿由 `use-project-attachments.js` 管理，读取完成后生成正文链接并同步序列化；保存前不上传，取消、卸载和上下文切换撤销 blob URL，迟到读取不得插回其他草稿。保存冲突保留附件并支持原有逐字段合并。

新建入口复用 `IssueCreateMenu` 选择需求或 Bug，`IssueCreate` 拥有独立新建页的草稿、流程查询与保存生命周期，保留 `?tab=issues|bugs&create=1` 深链。类型切换不重建同项目的表单，取消返回来源并清理附件；保存成功替换新建地址为事项详情。`IssueFields` 的 creation 布局将责任人与关注人放在左侧正文下方，日期与标签在右侧展开，窄屏按正文、人员、属性重排；编辑态继续复用相同字段规则。方案见[事项新建页](../../docs/prd/issue-creation.md)。

`MarkdownEditor` 默认懒加载 `VisualMarkdownEditor`（Tiptap），提供可视图文编辑，另保留 Markdown 源码和预览模式。图片节点仅通过已验证映射显示，文档保留原始附件路径，blob URL 不得序列化入正文。剪贴板 HTML 只取纯文本，不作为可执行内容解析。源码到可视化的转换先检查语义等价，不支持无损转换时保留原文。初始化、外部合并、移除附件和上下文重置建立新的撤销基线，普通编辑保留撤销／重做；异步插图使用映射后的光标书签，源码模式在读取附件期间禁用输入，避免位置漂移。

项目协作版本以「我的项目」为默认首页，`/projects/:projectId` 展示按权限开放的业务页面。创建项目直接填写 Git 仓库地址，项目设置管理地址，已分配开发空间时只读展示并说明原因；没有独立仓库目录页面或仓库选择接口。`/?workspace=<id>&task=<runKey>` 进入本人已准备的执行空间，个人创建空间入口不再提供。系统入口为部门与权限、账号管理和系统设置。项目页面的请求和写入生命周期由 `shared/api/use-resource.js` 处理，项目组件按项目 ID 重建；定期重检项目权限，撤权时移除不可访问内容。项目内容通过安全 Markdown 展示，附件下载经过项目和资源归属校验，不渲染外部未过滤 HTML。下列历史执行工作台组件说明只适用于被授权的开发空间。

项目不设置归属部门，创建表单、列表和概览不展示或提交项目部门，也不请求创建用的部门目录。管理员首页显示「全部项目」，无需部门或成员关系即可创建项目及管理项目协作；概览通过 `permissionContext.administratorAccess` 解释权限来源。普通成员首页为「我的项目」。管理员自动拥有代码、Agent 和敏感字段等全部项目权限，无需分配部门或权限；个人开发空间继续校验所有者。

账号展示使用 `displayName`，登录仍使用 `username`；成员选择与账号管理显示双名。`AccountProfile.vue` 维护个人显示名称，`saveAccountProfile` 保存时保持账号代际、令牌、设置和当前页面，迟到响应只合并当前账号的显示名称，不覆盖重检后的角色或部门，不写入已切换的账号。

仓库根目录的 `shared/workspace-icons.json` 和 `shared/agent-permissions.json` 是前后端共用契约；功能模块只读取它们，不复制枚举或图标目录。这里的 `shared/` 仅存放前端共享实现。

操作结果统一由 `shared/components/FeedbackMessage.vue` 连接响应式提示状态，`OperationMessages.vue` 在应用根部显示浮动消息；不在页面重复渲染成功或失败段落。消息支持自动关闭、手动关闭、悬停与焦点暂停及相同内容合并，账号代际变化清空。原生模态框打开时消息挂入当前模态框，再用手动 popover 保持可见和可操作；不改变焦点或遮挡整页操作。保存后马上导航或卸载的操作在确认请求仍有效后直接调用 `showMessage`，`useResource.perform` 已包含此处理。字段校验、危险操作确认、持续进度、历史错误和业务状态仍保留在所属界面。

Vue 组件使用 PascalCase 文件名；JavaScript 辅助模块使用 kebab-case，例如 `workspace-icons.js`、`requirement-content.js`。入口 `main.js` 与请求模块 `api.js` 保持简短命名。

应用组件只组合界面和处理界面状态：`App.vue` 控制受保护页面的渲染边界；`WorkbenchApp.vue` 组合账号导航、设置页面与工作区，并持有工作区弹窗引用；`WorkspaceConsole.vue` 持有页面切换、输入草稿和滚动位置。数据生命周期按职责分离：

- `app/use-workspace-selection.js` 负责首次 bootstrap、工作区选择和 Vue Router query 更新；默认选择使用 replace 固定，页内切换使用 push，浏览器前进和后退同步恢复选择。可取消入口传入 `isCurrent`，工作区读取完成后再次校验操作有效性再跳转。`WorkbenchApp.vue` 按工作区 UUID 重建 console，隔离草稿及异步生命周期；重命名仅更新目录和标题，不重建 console。
- `app/router.js` 使用 Vue Router 管理登录、首次改密、工作台、个人设置、系统设置和账号管理；工作区仍由 query 参数选择。`App.vue` 在账号身份变化时重建整个受保护页面，`WorkbenchApp.vue` 在工作区变化时重建 console。导航保留其他 query、hash 和用户 history state。
- `shared/api/account-session.js` 保存当前账号和个人设置的内存投影，数据由数据库 API 持久化。401、SSE 身份失效以及跨标签退出清空投影；HTTP 请求带账号代际，迟到响应不能进入新账号。LocalStorage 只用作无业务内容的身份变化通知。
- `app/SystemSettings.vue` 组合管理员的目录设置、环境检测和系统流程编排；账号业务页面属于 `features/accounts/`：`LoginPage.vue` 负责登录，`PasswordPage.vue` 组合首次改密入口，两类改密入口复用 `PasswordForm.vue`；`PersonalSettings.vue` 管理账号默认模型、强度、权限、通知和改密；`AccountManagement.vue` 管理账号身份，不提供读取他人工作区的入口。工作区配置仍由所有者在 `features/settings` 管理。
- `features/accounts/use-desktop-notifications.js` 拥有浏览器通知授权、个人通知偏好保存与通知投递；应用壳层将其设置状态传给个人设置页，并把投递回调传给工作区。账号功能不反向依赖应用壳层或其他功能目录。
- `features/settings/MemberStorageSettings.vue` 使用全局 `appApi` 独立加载和保存成员目录基础路径，并展示 Git 环境检测；`ServerDirectoryPicker.vue` 仅浏览服务器目录并返回选择，表单保存才生效。工作区设置只读展示服务端生成的项目与任务路径。
- `features/settings/EnvironmentPage.vue` 由系统设置内的「环境检测」分类组合，展示工具、最新版本、目录检查和自动安装／更新、安装器不可用原因与待重启状态。明确缺失时显示安装按钮，Linux Git 单独展示发行版软件源候选版本与来源。`use-environment.js` 拥有检测、版本查询、安装／更新与轮询生命周期；卸载清理计时器并丢弃迟到响应。确认展示确切版本，失败和未知状态独立呈现，不将网络错误视为已经最新。
- 项目开发空间以项目／用户 ID 鉴权，新仓库目录为「基础目录 / projects / 仓库目录名 / members / 登录用户名 / repository-准备修订号」。仓库目录名从 Git 地址取名并去掉 `.git`；同名仓库的后创建项目加短后缀并持久化，修改显示名称不改变目录，任务使用同根的「worktree / 任务」。失败目录保留，明确重试使用新的准备修订号目录，已就绪空间沿用记录路径。GitAccountSettings 维护主机凭据和独立提交作者；可在保存前直接验证 Git 主机登录，无需项目，验证服务类型仅用于本次请求。验证、保存与实际项目仓库检测分开，私钥和密码不回显。个人空间创建组件只用于明确的文件测试夹具，不作为生产导航入口。
- `app/use-workspace-console.js` 负责渠道 bootstrap、SSE 建连/关闭与防抖刷新，将事件分发给任务列表和会话状态，不处理 DOM 或表单草稿。
- `features/tasks/use-task-list.js` 负责列表刷新、请求乱序保护和请求期间的标题覆盖。
- 新建任务只提供手动图文输入，项目需求／Bug 页不提供外部导入。原始与历史追加资料由 session 的 `RequirementDetails.vue` 安全渲染；已保存资料可在原会话明确继续，读取历史不触发外部抓取。
- 生产开发空间的「独立开发」由 `features/tasks/ManualDevelopmentStart.vue` 提交项目独立启动接口，不关联事项、不保存待开发。app 通过插槽组合项目功能的 `RemoteBranchSelect`，避免跨 feature 导入；启动后进入原空间会话。响应丢失先查询当前账号的原请求，未知结果锁定表单并提供检查／任务记录入口。返回任务与切换会话位于顶部导航；工作台通过 flex 使用账号栏实际剩余高度，消息与长表单局部滚动。
- `features/tasks/ArchivedSessions.vue` 提供顶部归档入口、名称搜索、恢复和删除交互；`use-archived-sessions.js` 拥有归档请求、恢复状态与卸载/乱序保护。壳层通过归档、删除、恢复与重连事件通知刷新，并通过插槽组合 session 功能的删除确认窗口，功能之间不互相导入。删除目标独立于列表快照保存，刷新或提前到达的 SSE 不卸载正在提交的确认窗口；恢复后不自动启动任务或切换当前草稿。
- 会话名称由 `SessionTitleEditor.vue` 呈现，长名称换行，编辑图标紧随标题。编辑区最大 1040px，字数说明位于标签旁，取消/保存在宽屏时紧邻输入区、窄屏时移到下方，并保留输入法处理。壳层将面包屑并入会话标题区，执行状态与刷新在宽屏时对齐标题行，编辑时位于表单上方；`SessionDetailsDrawer.vue` 拥有右侧信息、Git、需求抽屉的呈现状态、键盘关闭及焦点恢复。会话上下文在所有宽度默认折叠，点击顶部「上下文」展开；宽屏独立列，窄屏覆盖抽屉。右栏与抽屉均独立滚动；切换资料保留草稿、滚动位置与子组件状态，切换会话重建抽屉。人工类型、人工进度与分组已删除，真实开发任务与 Agent 执行状态独立呈现。
- `features/session/use-session.js` 负责详情快照、请求期间的 SSE 覆盖、会话动作和历史分页；执行偏好拥有独立保存状态和错误反馈，迟到响应不能覆盖较新的设置/当前轮状态。打开会话、收到消息和完成动作通过回调交给应用/界面层处理，不导入任务列表或界面组件。
- `features/session/SessionComposer.vue` 只组合输入、模型/权限控件和提示，通过事件提交消息与设置修改，不直接管理持久化。
- 会话的 `agent` 元数据提供执行引擎名称和能力；界面不解析原生 RPC 方法。交互请求使用 `kind`、`action`、`blocking` 和 `questions` 等通用字段；未知请求默认阻塞且不展示批准按钮。图片、续聊和执行中补充指令按引擎能力开放，缺少能力声明时不可操作。模拟数据也必须提供当前协议的引擎元数据。
- 权限选项以服务端能力发现结果为准，加载中、失败或当前模式不可用时禁止创建任务、启动新轮次及保存个人默认值。向执行中的轮次补充指令沿用该轮实际权限，不受下一轮权限发现失败影响。保留已选择的值和草稿，不将未知模式降为默认权限；通过刷新或重新选择可用模式恢复操作。
- `features/settings/RepositoryGitPanel.vue` 提供工作区仓库状态、获取远端更新和快进更新基准分支；`features/session/SessionGitPanel.vue` 按当前任务读取实时检出分支、未提交与上游提交差异，`DeleteWorktreeDialog.vue` 在打开时重新获取删除快照并校验记录任务分支的完整确认。删除结果由应用壳层协调刷新会话和列表，历史保留为只读。不提供合并或冲突处理按钮。
- `features/session/SessionLifecycleControls.vue` 提供会话页面的归档和删除按钮；`SessionLifecycleDialog.vue` 是会话页面和归档列表共用的确认窗口。归档仅隐藏列表项，永久删除可先清理 Worktree，或显式选择强制删除并输入完整本地分支名，一并放弃本地文件和提交。服务端确认清理完成后，由壳层移除当前视图或打开下一条可见会话；在途列表响应不能恢复已移除项。
- `shared/api/use-model-catalog.js`、`use-permission-modes.js` 分别拥有模型和权限能力加载、重试与卸载保护；`AgentModelControls.vue` 和 `PermissionSelect.vue` 只接收值/选项并发出变更，由创建表单或会话各自决定保存时机。

Git 账号页默认只展示已添加账号；点击添加或编辑后展开带明确标题的表单，列表标记正在编辑的账号。保存成功后清空凭据草稿并返回列表，失败保留输入；取消只清理本地草稿，不发送请求。在途操作禁止取消，验证登录仍不保存账号。表单展开时聚焦名称，收起后返回原触发按钮；语言切换保留同一草稿。实现位于 `GitAccountSettings.vue` 与 `use-git-accounts.js`，交互、凭据及响应式回归由 `test/browser/git-accounts.test.cjs` 覆盖，2026-10-15 在 macOS / Chrome 通过 lint、Node 回归（629 项通过，6 项 Windows 专项跳过）、构建及 Jenkins 浏览器检查；视觉回归生成 352 张截图。

目录和职责调整不改变 API、URL、会话身份或运行数据路径。需求富文本只能经 `features/session/requirement-content.js` 的安全渲染入口处理。

Codex 回复的流式内容和历史消息统一经 `features/session/message-content.js` 解析 Markdown 并过滤 HTML。源码 HTML 按原文显示，Markdown 图片不加载，链接仅允许 HTTP、HTTPS 和 mailto；用户消息与工具输出保留纯文本。代码块和宽表格在自身区域滚动，不扩大对话宽度。

生产开发空间由项目权限自动分配，ProjectDevelopment 提交凭据绑定与异步准备，刷新从服务器读取状态。历史文件夹具中的 WorkspacePicker、use-workspace-clones 不进入生产创建流程；旧个人创建 HTTP 接口明确拒绝。

项目详情使用 `tab` 分区与 `issue`、`task`、`asset` 查询参数定位对象；项目 `task` 是开发任务 ID，工作台 `task` 是原生 run key，不混用。进入工作台时记录同项目来源 `returnTo`，返回时恢复原事项或任务。准备环境使用 `returnTab`/`returnIssue` 保留来源，不自动开始执行。

工作台会话选择同步到 URL 的 `task`；前进、后退及刷新恢复对应会话。相同工作区不因 `task` 改变而重建控制台，使用现有选择代际隔离迟到响应。资产提交只清理该次请求对应的草稿；保存期间新增修改保留，后续提交使用新修订号。协作查看权限撤销时清除评论／交付缓存及草稿，并使旧请求失效。

图文编辑器的内部剪贴板通过随机引用读取当前页面内存中的文档片段，保留格式与持久图片身份，不接受剪贴板提供的文档 JSON 或 HTML。跨字段粘贴图片需在目标附件映射中可用；外部正文替换、上下文切换或卸载清除对应内存片段。外部富文本继续采用纯文本，图片附件仍通过既有校验与上传流程。

ProjectPermissionEditor 在部门模式显示功能上限，在成员模式显示工作内容组合；组合与依赖使用共享权限目录，前端预览不能替代后端校验。ProjectMembers 成功修改后通知项目壳层刷新有效权限。事项与设置的 EditConflict 以编辑基线、草稿、最新版本作三方合并；同会话刷新使用 refresh，不触发打开时的草稿重置。

权限细项采用分类双栏：左侧显示分类及已选数量，右侧显示独立权限、依赖和执行／敏感字段提示；600px 及以下上下排列。部门模式默认展开，成员模式按需展开。搜索和已选筛选共同过滤权限，批量选择／清空只作用于当前分类的可见结果，并明确标注筛选范围；勾选补齐依赖、取消级联关闭的规则不变。父表单提供保存时的权限基线用于变更摘要与撤销，切换部门／成员或部门保存成功后重建编辑器，清空筛选及操作反馈。保存期间禁止权限变更，检索和分类浏览不触发保存。

新界面以 [B 方案 UI 重构 PRD](../../docs/prd/ui-refactor.md) 为目标，正式主题使用 `shared/styles/design-tokens.css`，壳层与复用样式位于 `shared/styles/workbench.css`，业务样式继续按职责组织。验证遵循仓库契约：lint、单元测试、构建、浏览器回归；视觉改动还需模拟数据截图验证。

项目生命周期由 `ProjectReleases` 与 `PlanDevelopmentDialog` 组合；管理员在系统设置中的 `features/settings/SystemWorkflows` 维护全局需求和 Bug 两套流程，项目没有流程配置入口。`shared/components/WorkflowGraph` 呈现系统流程编辑画布；项目事项详情不显示流程图，只读取发布版本用于状态流转。流程选项和可用流转来自服务端发布版本，不再在页面维护固定状态表。事项先认领／指派为待开发任务，由 `ProjectTasks` 单独执行开始、完成和取消；`RemoteBranchSelect` 只接受远端返回的分支选项，刷新立即清空旧选择，失败不得手填回退。流程图按状态类型配色，`workflow-routing.js` 负责节点间距、正式连线及拖线预览的避障和贝塞尔曲线路径；双击空白／Insert 新增状态，拖动或依次点击连接点连线，点击节点／连线在画布内编辑，Delete 在画布内确认删除及关联连线。支持键盘选取、移动与 Esc 取消，保存期间禁用编辑，窄屏图内平移、属性区移至画布下方；资产、图文事项和已有会话保持原安全渲染边界。

版本列表与概览当前版本复用 `ReleaseSummary`，采用版本号、说明首行、目标日期及完成进度的横向布局；完整说明保留在版本详情。`?tab=releases&release=<id>` 定位独立的 `ProjectReleaseDetail`，左侧显示分页事项范围，右侧显示真实进度、日期、状态及编辑／归档／恢复操作。刷新与前进后退保留版本身份；新建与编辑使用共享弹窗，归档仍须明确确认并校验修订号和门禁。用户明确只调整范围样式，不新增勾选保存或添加事项。资产的新建及编辑、成员的添加及调整授权也使用共享弹窗；长表单局部滚动，提交按钮在独立底栏保持可达。成员列表显示业务授权摘要，完整权限、部门上限、组合、筛选、撤销和成员状态仍在弹窗中提供，部门设置沿用原完整权限编辑器。

流程画布提供缩放、适应画布和全屏视图；全屏保留草稿、选中项、保存／发布及操作反馈，退出按钮或 Esc 返回。优先使用浏览器 Fullscreen API，不支持时使用视口覆盖层并管理焦点与页面滚动；卸载时清理全屏监听、尺寸观察与滚动锁。视口与节点／连线范围独立，空白拖动、滚轮及画布方向键用于平移，Ctrl／⌘ + 滚轮围绕指针缩放；节点拖到边缘自动平移，松手不重新适配或缩放。坐标按视口原点和缩放比例换算，支持现有 ±100000 范围内的负坐标，缩放或全屏不会改变已保存的节点位置。相对边的连接点优先对齐，无障碍时直接画水平／垂直直线，多入边／出边及双向连线仍保持连接点分离。

开发流程采用事项页逐条认领／指派，再到 ProjectTasks 默认的「我的开发任务」多选合并。PlanDevelopmentDialog 只分配负责人并创建独立待开发任务；MergeDevelopmentDialog 保存带修订号的选择与独立请求标识。scope 与分页同步 URL，切换范围、分页、任务后清除合并选择，卸载后忽略迟到响应。任务的人工状态与 Codex 状态分开呈现，已合并来源详情提供目标任务链接。

开发任务详情由按项目／任务 ID 重建的 `DevelopmentTaskDetail` 呈现范围、三行执行准备和任务信息；任务信息在 1200px 以下默认折叠，`use-development-task` 拥有详情、变更与独立的事项搜索请求。`development-task-view` 只解释服务端状态，不推断业务验收或改变权限。任务信息按需编辑，信息保存与事项关联分开提交；刷新保留编辑草稿及其修订基线。追加资料保存与继续执行分别操作；完成、取消及移出事项由 `DevelopmentTaskConfirmation` 明确确认后提交。项目功能导航使用 `.page-tabs.project-navigation` 的轻量选中态与窄屏换行，保留权限、URL 和原生键盘访问。

开发任务的 `taskStart=1` 查询参数定位独立的开始确认视图，返回详情及语言切换保留同一组件的分支、执行偏好和补充说明草稿。确认勾选随范围修订、分支及执行设置变化失效；只有明确确认并提交后才调用原有启动请求。`use-development-task` 的请求标识与未知结果查询生命周期不因确认视图切换而重建，校验失败保留草稿，已受理或未知结果不能盲目重启。

全局开发列表复用项目内的 `MergeDevelopmentDialog`，仍只允许同项目、同版本、未启动的本人任务合并，最多 20 条事项；合并栏仅在选择后出现。`workbench-presenter` 复用开发任务 presenter 返回关联范围、修订号和真实权限，不从前端状态推断合并及会话访问资格。“项目全部任务”使用顶部所选项目直接进入既有项目列表；“独立开发”“历史会话”先选择获授权项目，有就绪空间时通过 `view=manual|history` 打开既有表单或归档弹窗，尚未就绪时进入代码与环境准备页。入口和环境准备均不自动执行 Agent，归档会话保持本人空间隔离。

2026-10-14 职责与工作台实施：`WorkbenchHome` / `WorkActionQueue` / `WorkActionList` 展示 `/workbench/actions` 的个人动作；资源列表继续用于浏览。`IssueFields` 明确职责与关注关系，`IssueDetail` 显示当前处理人并开始步骤；`SystemWorkflows` 编辑节点职责/类别和连线资料/交付门禁。交付发布选择验证人，`DeliveryDetail` 提供开始验证、转派和保留原记录的重新提交。通知直接使用相同个人动作快照；语言与账号切换继续保留既有请求代际规则。详细业务契约见[流程动作](../../docs/engineering/workflow-actions.md)。

MCP 接入支持图片及普通附件，PNG/JPEG/WebP 按实际签名识别为图片输入，其他文件在开发时以本地路径交给 Agent 读取。`McpUploadHelp` 展示申请临时上传 Token、上传与发布三步；`McpTokenSettings` 提供公开 `/skills` 指南与复制链接。该页面由后端直接输出完整 HTML，避免未登录跳转或依赖 Vue 执行而阻止 Agent 读取；不进入受保护 Vue 路由。

MarkdownEditor 对异步写作组件保留加载高度；加载失败时展示原因并提供可保存的 Markdown 源码输入。加载过程中可以主动切换源码，完成加载不会改写草稿。写作区高度按 rows 保留至少 160px，需求与 Bug 的空字段也必须保持可编辑空间。
