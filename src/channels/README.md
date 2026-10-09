# 需求渠道模块

渠道负责来源认证、需求读取、素材准备和上游状态同步。执行调度、Git worktree、Codex 传输、任务记录和 Web 会话由通用模块管理。完整接口见 [渠道扩展契约](../../docs/channels.md)，配置与工作区边界见 [工程约定](../../docs/engineering/channels-and-settings.md) 和 [工作区契约](../../docs/engineering/workspaces.md)。

## 目录职责

| 位置 | 职责 |
| --- | --- |
| `channel-registry.cjs` | ChannelRegistry 校验渠道接口，显式注册适配器并组合渠道默认配置；浏览器输入只能选择已注册的渠道 ID |
| `tapd/adapter.cjs` | TAPD 工作区绑定、全部待办读取和素材准备；不修改上游状态 |
| `tapd/config.cjs` | TAPD 默认配置、session 读取、来源项目 ID 选择和数字 ID 校验；通过通用配置模块读取文件 |
| `tapd/settings.cjs` | TAPD 配置的白名单校验、Cookie 保存和只读连接检测 |
| `tapd/auth-utils.cjs` | Cookie 解析、HTTP session 构造和凭据刷新 |
| `tapd/http.cjs` | TAPD API 请求、响应解包和成功状态校验 |
| `tapd/detail.cjs`、`tapd/users.cjs` | 待办、详情和人员查询 |
| `tapd/images.cjs`、`tapd/task-package.cjs` | 图片解析与下载、需求快照和 Codex 提示词 |
| `tapd/fusion-task.cjs` | 按顺序准备完整来源快照，使用独立融合模板一次渲染，统一图片编号与来源归属并校验整批上限 |
| `manual/adapter.cjs` | 手动需求输入校验与渠道组合；无需 TAPD 登录 |
| `manual/manual-upload-store.cjs` | ManualUploadStore 管理工作区图片暂存、读取、大小/格式验证与过期清理 |
| `manual/task-package.cjs` | 标题命名、按顺序复制图片与构建任务包 |

## 依赖与扩展

新增渠道应放在独立子目录中，由 `channel-registry.cjs` 显式注册适配器。适配器实现 `describe`、`resolve`、`prepare`、`transition`，按需提供查询能力和执行前校验。`describe` 返回界面所需的公开信息，不能包含 Cookie、令牌或其他凭据。

`resolve` 校验渠道输入并返回 `{item, config, session}`；这里的 `session` 是来源访问上下文。`prepare` 返回 `{workitem, task, target}`，在 Codex 执行前准备完整文本和本地图片，需要同步的渠道可完成流转预检。`transition` 只处理来源状态；TAPD 和手动渠道返回 `{status: 'skipped'}`。通用执行器确认 Codex 实际开始执行后才调用状态同步，执行状态与渠道状态分别保存。

渠道可以调用通用配置、图片签名验证、任务身份和命名工具；通用执行与会话模块通过适配器调用来源功能，不导入 TAPD HTTP、人员选择或工作流实现。其他渠道也不应依赖 TAPD 模块。TAPD session 格式和项目 ID 规则由 `tapd/config.cjs` 管理，通用 `config/runtime.cjs` 读取调用方明确传入的配置文件路径。

## 素材与身份约束

- TAPD 图片先按 Markdown 语义解析，正确处理引用标签，并忽略代码和转义示例；HTML 图片保留 `src`、`data-src`、`data-original` 支持。不能恢复为对 Markdown 原文直接扫描图片正则。
- 图片下载逐跳验证 HTTPS 与主机白名单。Cookie 仅发送到 `www.tapd.cn` 和 `file.tapd.cn`；显式允许的外部域名也不能获得 Cookie。域名按大小写不敏感规则匹配，保存时统一小写。
- PNG/JPEG/WebP 签名校验与大小限制是所有渠道共用的能力。无法访问或不支持的实际图片应阻止准备，不能静默省略。
- 手动上传 ID 属于当前应用工作区，不能作为路径使用，也不能跨工作区读取。准备时按上传顺序复制到任务目录，保留历史素材。
- 保留 `source={channel,scope,id}`、已有 session、记录中的 worktree 路径及分支。源码目录调整不改变渠道 ID、HTTP 路由、运行 key 或历史 `requirement.json` / `tapd-task.json` 文件名。
- TAPD 融合任务使用稳定的本地 `fusion-<UUID-v4>` 来源 ID，同时保留每条数字 TAPD 来源的 `sources` 清单；原单需求的数字身份不变。追加资料复用当前渠道的解析和准备能力，实际来源唯一性、任务空闲门禁和发送生命周期分别由 storage 与 application 管理，渠道不操作会话或 Worktree。

## 验证

渠道验证使用 fake TAPD/Codex、临时目录和临时 Git 仓库。[单元测试](../../test/unit) 覆盖 TAPD API、图片语义与凭据边界，包括 [tapd-images.test.cjs](../../test/unit/tapd-images.test.cjs) 和 [image-hosts.test.cjs](../../test/unit/image-hosts.test.cjs)。[集成测试](../../test/integration) 覆盖执行、手动渠道和工作区隔离；[浏览器测试](../../test/browser) 验证实际 Web 流程。结构调整按 Jenkinsfile 运行 eslint、Node 测试、构建和所需浏览器脚本。不得执行真实需求、变更真实 TAPD 状态或以真实认证导入命令进行验证。
