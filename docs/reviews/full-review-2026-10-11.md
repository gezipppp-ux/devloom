# 当前重构全量审查（2026-10-11）

审查对象为当前工作树的项目、部门与成员权限、PostgreSQL/Prisma 持久化、开发任务与会话、需求/Bug/资产及图文编辑器。包含尚未提交的新文件；没有修改业务实现。本报告只列确证缺陷，不重复前几轮已经修复的问题。

后续状态：以下 8 项已修复，见[修复与验证记录](./full-review-fixes-2026-10-11.md)。下文保留审查时的触发条件及证据。

## 结论

确认 8 项问题：1 项 P1、6 项 P2、1 项 P3。现有自动化全部通过，但未覆盖以下场景。应先修复旧需求接口的权限遗漏，再处理关闭时的执行生命周期和内容丢失。

### 1. [P1] 旧需求检索接口绕过需求查看权限

- 定位：[src/http/server.cjs](../../src/http/server.cjs) 第 63 行；调用路径见 [src/http/api.cjs](../../src/http/api.cjs) 第 88–99 行。
- 触发：成员已有开发空间，随后撤销 `issue.view`，保留 `project.view`、`code.view`、`session.view`。访问 `/api/workspaces/:id/requirements?channel=tapd`。
- 结果：项目权限检查拒绝需求访问（403），旧接口仍返回 200 和 TAPD 事项标题。`/stories` 进入相同检索分支。GET 的默认权限映射只有 `session.view`，没有检查 `issue.view`。
- 影响：单独分配会话查看权限的成员仍可检索本不允许查看的 TAPD 需求，部门与项目的权限边界不一致。
- 最小修复：给需求检索路由明确校验 `issue.view`，保留既有工作空间所有者和会话访问限制；补真实 HTTP 的撤权回归。
- 证据：`state/review-2026-10-11/issue-permission.cjs`。使用真实登录、ProjectServices 授权及隔离 PG，本地临时 Git 与 fake TAPD；没有真实外部写入。主代理已独立复验。

### 2. [P2] 关闭服务没有等待尚未登记的启动操作

- 定位：[src/application/session-manager.cjs](../../src/application/session-manager.cjs) 第 435–444 行；关闭等待范围见第 760–770 行。
- 触发：正常调用 `manager.start()`，在需求持久化 claim 尚未返回时调用 `close()`。
- 结果：`close()` 已完成并释放运行所有权，启动请求恢复后仍新建 runtime、调用 runner 并返回 accepted。`startingRequests` 只有计数，没有进入 shutdown 的等待集合。
- 影响：服务重启/退出期间仍可能继续准备工作树或运行初始化，关闭流程无法保证等待和取消这段工作，数据库关闭后可能留下不完整状态。
- 最小修复：跟踪完整启动 Promise，在关闭流程中等待；异步边界重新检查关闭状态，失败时清理本次持有的预约与所有权。
- 证据：`state/review-2026-10-11/shutdown-start-race.cjs`。fake channel/client/runner；公开 `start()` 路径输出 `sessionsAtClose=0`、`runAfterClose=true`、`sessionsAfterClosed=1`、`owned=0`。主代理已独立复验。

### 3. [P2] 编辑器内部剪切粘贴会丢失图片

- 定位：[web/src/shared/components/VisualMarkdownEditor.vue](../../web/src/shared/components/VisualMarkdownEditor.vue) 第 63–66 行。
- 触发：在“写作”模式选中含图片和格式的正文，用 Ctrl+X 剪切，再 Ctrl+V 粘贴到同一编辑器。
- 结果：剪贴板中的内部文档片段被当成纯文本，图片不在 `clipboardData.files` 中，因此不再插入；粗体等格式也被清除。真实浏览器键盘复现中，`before **bold** ![proof](本地附件地址) after` 变为 `before bold  after`，图片节点从 1 变为 0。
- 影响：正常移动图文段落会破坏正文，继续保存后图片不再出现在正文中。底层附件没有被此操作删除。
- 最小修复：为应用内部复制/剪切保留经校验的文档片段与持久图片身份；继续限制外部 HTML 和未经批准的图片地址，不要直接放开任意 HTML 粘贴。
- 证据：`state/review-2026-10-11/editor-repro.cjs`。隔离 Vite 页面、fake 附件、Edge 真实 Ctrl+A/Ctrl+X/Ctrl+V，无生产数据。

### 4. [P2] 负责人调部门可绕过交接保护

- 定位：[src/storage/account-store.cjs](../../src/storage/account-store.cjs) 第 47–48 行。
- 触发：管理员把唯一项目负责人调到只有 `project.view` 的部门。
- 结果：账号更新成功，项目 `ownerUserId` 不变，但负责人失去 `project.configure` 和 `project.members.manage`，相关操作返回 403。当前保护仅拦截停用账号，没有检查部门变更导致的降权。
- 影响：项目内不能继续管理或交接负责人，必须由系统管理员恢复部门能力/归属后处理；违反“降权前先交接”的现行契约。
- 最小修复：账号部门变更时校验其负责的项目及新部门有效权限；不满足负责人必需权限时拒绝更新并提示先交接。
- 证据：`state/review-2026-10-11/backend-repro.cjs` 第一项。独立 PostgreSQL，主代理已独立复验。

### 5. [P2] TAPD 导入没有保存需求图片

- 定位：[src/channels/tapd/project-import.cjs](../../src/channels/tapd/project-import.cjs) 第 22–23 行；开发图片读取见 [src/application/project-development-services.cjs](../../src/application/project-development-services.cjs) 第 37–41 行。
- 触发：导入正文含远程截图的 TAPD 事项，再查看详情或从该事项启动开发。
- 结果：只保存远程 HTML/Markdown 引用，没有受控下载并保存为项目附件；安全渲染不加载该远程图片，开发快照又只从 ProjectFile 提取图片。
- 影响：导入后的详情不能显示截图，从项目事项启动的开发也收不到图像内容，依赖截图的需求/Bug 信息不完整。
- 最小修复：在渠道导入阶段按既有受控图片下载规则获取内容，在项目事务中保存附件与引用；失败应明确反馈，不能静默遗漏。
- 证据：`backend-repro.cjs` 第二项模拟默认导入路径：只发生 1 次详情请求，`ProjectFile=0`、详情 `images=[]`、开发图片数组为空。主代理已独立复验；未连接真实 TAPD。

### 6. [P2] 资产保存成功丢弃请求期间的新输入

- 定位：[web/src/features/projects/ProjectAssets.vue](../../web/src/features/projects/ProjectAssets.vue) 第 53 行；表单第 61 行。
- 触发：提交资产后，在 HTTP 响应返回前继续编辑内容。
- 结果：输入控件仍可使用，但成功回调没有草稿版本判断，直接结束编辑并加载已经提交的版本。重新编辑时，请求期间输入的新内容消失。
- 影响：正常 200 响应即可造成未提交内容丢失，与 409 或其他用户并发修改无关。
- 最小修复：保存期间禁用该表单，或记录提交时的草稿版本，仅在版本未改变时退出编辑；有新输入时保留草稿。
- 证据：`state/review-2026-10-11/ui-repro.cjs` 第一项。fake API 延迟 200 响应后重开表单验证，主代理已独立复验。

### 7. [P2] 切换会话没有同步地址，刷新打开旧会话

- 定位：[web/src/app/WorkspaceConsole.vue](../../web/src/app/WorkspaceConsole.vue) 第 280 行；[web/src/app/WorkbenchApp.vue](../../web/src/app/WorkbenchApp.vue) 第 51 行将 `route.query.task` 传入 `initial-task`。
- 触发：从项目打开 `?task=A`，再点击侧栏会话 B。
- 结果：正文正确切到 B，但 URL 仍是 `task=A`。刷新页面后，初始化逻辑优先打开地址中的 A。
- 影响：刷新和复制链接指向错误会话，当前选中状态与可分享地址不一致。
- 最小修复：通过统一路由入口同步会话选择与 `task` 参数，并验证返回/前进、刷新及缺失会话。避免更新地址时无条件重建组件导致草稿丢失。
- 证据：`state/review-2026-10-11/task-route-repro.cjs` 和 `task-route-stale.png`，真实 WorkspaceConsole、Vue Router、fake API。主代理已独立复验。

### 8. [P3] 撤销协作查看权限后未清理当前记录

- 定位：[web/src/features/projects/IssueDiscussion.vue](../../web/src/features/projects/IssueDiscussion.vue) 第 8 行及第 30 行。
- 触发：已打开评论/交付页，保留 `issue.view`、撤销 `collaboration.view`，父组件刷新有效权限。
- 结果：标签按钮消失，但 `tab` 及已加载的记录没有重置，旧评论/交付仍持续显示。
- 影响：撤权后的界面与实际可用功能不一致。此项是已授权下载内容的陈旧显示，不是新的服务端数据越权。
- 最小修复：监听权限变化，失去权限时切换到可用标签，清除对应记录、草稿和待完成请求。
- 证据：`ui-repro.cjs` 第二项及 `revoked-discussion.png`，主代理已独立复验。

## 本轮验证

- Windows、Node.js 22.22.0；独立 Docker PostgreSQL 17，127.0.0.1:55439。测试容器已清理。未使用 5432 业务库，不运行真实 Codex 任务或 TAPD 写操作。
- `npx eslint src test web/src web/vite.config.mjs` 通过。
- 架构、单元、集成共 402 项测试通过，失败/跳过均为 0。
- `npm run build` 通过；保留已有的超过 500 kB 构建块提示，未把此提示单独定为缺陷。
- Jenkinsfile 的 8 个浏览器入口全部通过：session、workspaces、dev、accounts、project-collaboration、development-flows、project-editing、visual。
- visual 套件生成 147 张截图，自动溢出与说明重叠检查通过；另人工查看本轮生成的桌面图文编辑器、成员权限页面和 320px 权限页面。没有声称逐张人工检查全部截图。
- 新发现均有隔离复现，证据脚本与日志保存在忽略目录 `state/review-2026-10-11/`。未修改业务源码或正式测试。
- Linux 未在本轮实测；通过现有检查不代表以上缺陷已修复，也不证明不存在其他缺陷。
