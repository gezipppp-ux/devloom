# 会话交互预览

2026-10-22 用户从三种原型中选定「随聊调整」，授权实现内联预览、调整面板、交互状态保存和反馈续聊。预览位于回复原位置；标题、版本和展开入口在顶部；保存状态、默认收起的调整区与引用入口在底部。控件由内容注册，不能将示例参数固定为业务字段。宽屏保持会话行宽，手机将调整项单列排列；反馈引用进入原输入框，显式发送后才继续原会话。

## Provider 与快照

`CodexAgent` 将 `visualize{"path":"绝对路径.html","title":"标题"}` 转换成标准 `previewReferences: [{start,end,path,title}]`。其他 Agent 只需产出同一标准字段；目前未实现 Claude Code 或 pi provider。普通 Markdown 保持安全过滤，未完成消息不会执行预览。

`SessionPresenter` 在收到完整消息时捕获文件，将引用转换成有序 `contentParts`。只允许当前记录的 worktree 内、无符号/硬链接、UTF-8、最大 1 MiB 的 HTML；不能读取 Codex 桌面全局目录。Codex 新建/恢复会话的 developer instructions 保留原配置并补充宿主协议，建议写到当前 worktree 的 `.devloom/previews/`。后续内容复用源路径表示同一预览的新版本。

`SessionPreviewStore` 在所属 run 的数据库 document 命名空间保存不可变 HTML（内容摘要）、索引和状态。显式文件适配仅用于测试。首次捕获后不会从源文件重载；删除 worktree 不影响已保存快照。历史补齐只读取已保存的快照：尚未捕获的旧消息显示重新生成提示，不用当前文件冒充历史字节，也不让较旧消息变成最新版本。删除会话时随 run 一并清理。

## Sandbox 与桥接

受所有者和 `session.view` 保护的 `GET .../runs/:key/previews/:id` 返回版本/状态；`.../:id/content` 以独立 CSP 返回 HTML。iframe 仅 `allow-scripts`，CSP 也强制 sandbox，禁止同源权限、网络连接、嵌套框架、表单、worker、object 和 base。图像只允许 data/blob，脚本与字体使用明确 CDN allowlist。主应用 CSP 和 Markdown 不放开脚本。快照 URL 不可直接当作同源网页执行。

`preview-runtime.js/css` 提供主题基础变量、carousel、可选 Lucide、Tweak slider/color/toggle/select 及 `openai` 状态/反馈桥。父页面按 frame window、随机通道 token 和消息类型/大小核验；内容不能访问应用 API、Cookie 或父 DOM。`sendFollowUpMessage` 仅准备反馈草稿，没有发送权限。

仅 `/preview-runtime.js` 和 `/preview-runtime.css` 两个不含凭据的静态文件允许 opaque iframe 跨源加载；API 和其他页面继续执行严格的同源校验。运行时源码位于 `web/public/`，随 Vite 构建复制；不得在其中引入应用模块或业务 API。

## 保存与续聊

`POST .../:id/state {revision,state:{widget,controls}}` 需要 `session.continue`，复核任务生命周期与 worktree；归档/清理后和历史版本只读。widget 支持 `modelContent/privateContent`，整体状态最大 16 KiB。数据库短锁内比较修订号并确认最新版本；冲突返回 409，保留本地草稿供引用或明确放弃后重载。前端串行合并自动保存，不能用较早响应覆盖较新操作；切换/卸载后停止排队和迟到响应。

引用进入输入框时固定预览 ID、版本和当前状态，显示可检查/移除的引用。`POST .../messages` 的可选 `preview` 附带 `{id,state}`；服务端确认引用属于当前 run，以真实版本元数据及 `controls/modelContent` 作为数据附加到同一 session 的发送/steer 输入。`privateContent` 从不进入模型输入。保存、切换版本和引用都不自动启动 Agent；失败保留原草稿。

验证使用 fake Agent、临时文件/仓库和独立 PostgreSQL；覆盖边界、不可变内容、CAS、跨会话引用、沙箱、刷新恢复和实际页面响应式。
