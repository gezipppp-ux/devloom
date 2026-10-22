# 随聊调整实施与验证

用户选择「随聊调整」后实施：完整回复中的 HTML 引用原位展示；版本切换、展开、默认收起的动态调整面板、原始效果对照与重置；交互状态自动保存；引用当前版本/调整上下文到原输入框，显式发送后继续原会话。实现契约见[会话预览](../engineering/session-previews.md)。

Codex 原生标记由适配器转换为通用引用。当前包含 Codex 接入；Claude Code/pi 的 provider 尚未实现，宿主接口可以复用。预览源文件须位于当前任务 worktree；已捕获内容使用数据库快照，历史查询不从可变源文件重建旧版本。没有快照的旧标记需要重新生成。

## 功能验证

- Windows，Node.js 25.8.2，Edge headless；PostgreSQL 17 使用独立临时 Docker 实例及随机测试 schema。没有执行真实 Agent 任务，也没有使用业务数据库。
- `npx eslint src test web/src web/public web/vite.config.mjs` 通过；Jenkins 的两处 lint 命令增加 sandbox runtime 所在的 `web/public`。
- `node --test --test-concurrency=8 test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs`：704 项通过。最终历史补齐与状态规范化变更另完成相关专项复测。
- `npm run build` 通过；保留现有大 bundle 提示。
- Jenkins 浏览器入口 `session`、`workspaces`、`dev`、`accounts`、`setup`、`project-collaboration`、`development-flows`、`project-editing`、`visual` 均通过；新增预览检查接入 `session`，也可单独运行 `node test/browser/session-previews.test.cjs`。
- 专项覆盖：immutable snapshot、跨任务归属、路径/链接/大小边界、PostgreSQL CAS、陈旧响应、冲突保留草稿、历史只读、状态刷新恢复、Tweak 各类控件与 carousel、原始效果对照、反馈只准备草稿、显式发送同一 session、privateContent 不进入模型输入、CSRF/所有者/权限/归档门禁、iframe 不能访问父 DOM 或 Cookie、静态资源的最小跨源例外。

## 视觉验证

实际 CSS 视口：1920×1080、2560×1440、1440×900、1280×720、768×1024、390×844、320×740。检查完整会话、展开调整区、冲突与历史状态，以及英文窄屏。窄屏通过页面/会话滚动到达输入区，并用命中检测确认发送按钮不被底部导航遮住。

合并了重复的控件分组标题，保持白色/浅灰主体、紫色调整状态和原有会话行宽。查看了实际截图；预览专项截图位于忽略的 `state/browser/previews/`（独立入口）及 `state/browser/`（会话完整入口），全站视觉入口另外生成 372 张截图。测试输出与截图不提交。

本轮没有实测 Linux/macOS，也没有部署到业务环境或创建 Git 提交。
