# TAPD 功能移除验收

2026-10-12，需求、Bug、项目设置、工作区设置和任务创建中移除 TAPD 功能。

- 删除项目导入、渠道检索／创建、融合、追加抓取和连接配置接口及实现；默认注册渠道只有 `manual`。
- 删除导入按钮、Cookie／项目 ID／图片域名表单，以及单条和融合提示词选项。项目事项只显示本地维护信息。
- 项目设置拒绝新增 TAPD 字段；公开设置过滤旧模板，保存项目配置并同步空间时不再传播旧渠道配置。存量模板不阻塞手动任务。
- 保留原事项、附件映射、任务来源、运行 key、会话、分支、Worktree 路径和已保存资料。历史读取不访问外部来源，存量凭据仍受原存储加密保护；没有改写历史迁移或删除业务数据。
- CSRF 请求头统一为 `x-csrf-token`，更新时需同时更新前后端并重启服务。执行客户端名称与启动输出使用 Web Coding。
- README、使用手册、渠道和工程契约、当前 PRD 已同步；有日期的旧验收记录保留历史原貌。

验证环境为 Windows、Node.js 25.8.2、Edge 和一次性 Docker PostgreSQL 17；仅使用独立测试库、fake Codex 和临时 Git 仓库。

- `npx eslint src test web/src web/vite.config.mjs` 通过。
- `node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs`：497/497 通过，无跳过。
- `npm run build` 通过；保留既有 Vite 大包提示。
- Jenkinsfile 的 session、workspaces、dev、accounts、project-collaboration、development-flows、project-editing、visual 八套浏览器入口全部通过。
- 视觉检查最终通过，共 190 张截图。首轮在会话导航时超时，最终构建完成后重跑通过。人工复查需求列表、Bug 详情、项目和工作区设置，覆盖桌面、768px、390px 和 320px。
- 回归覆盖已删除接口、旧设置拒绝和过滤、手动任务、配置同步、历史事项本地编辑与附件保留。

截图位于忽略的 `state/browser/`，视觉索引为 `state/browser/unified/index.html`。未执行 Linux 回归、真实需求、外部业务写入或部署。
