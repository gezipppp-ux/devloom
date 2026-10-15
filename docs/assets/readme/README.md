# DevLoom README 功能截图

截图来自 2026-10-15 的正式 Vue 前端，使用隔离演示数据，不包含真实项目资料或访问凭据。保留实际界面和当前已接入的 Agent 名称。

- `en/`：英文界面与英文演示内容，由默认英文 `README.md` 引用。
- `zh-CN/`：中文界面与中文演示内容，由 `README.zh-CN.md` 引用。
- `community/`：中英文 README 共用的 DevLoom 微信交流群二维码。

两种语言使用相同的四个场景：

| 文件 | 内容 | CSS 视口 |
| --- | --- | --- |
| `issues.png` | 需求列表、版本与任务分派入口 | 1440 × 1000 |
| `agent-session.png` | Agent 开发会话与执行结果 | 1920 × 1080 |
| `code-diff.png` | 变更文件与代码差异 | 1440 × 1000 |
| `mcp.png` | MCP 接入与个人 Token 管理 | 1440 × 1000 |

演示服务与 API 数据基于 `test/browser/visual.test.cjs`、`test/browser/workbench.test.cjs` 和 `test/fixtures/project-visual.cjs`。更新时在隔离环境启动正式前端，分别选择 `en` / `zh-CN`，使用相应语言的项目、任务和对话数据，再截取上述页面。检查品牌、界面语言、提示信息和排版，不能通过覆盖图片文字替代实际界面截图。

浏览器回归和原始验证产物继续保存在忽略的 `state/browser/`；本目录仅保存用于文档展示的八张图片。
