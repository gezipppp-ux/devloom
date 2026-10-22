# 详情资料与返回路径 · A 方案实施检查

日期：2026-10-22。用户选择「A · 分组侧栏」后完成本地实现，以下记录对应实施与验收阶段。

## 实现范围

- 从全局事项列表进入详情，主导航继续选中「事项」，面包屑显示「事项详情」。返回时恢复原列表的项目范围、搜索、类型、筛选和分页；刷新及浏览器前进／后退保留来源。从项目内部进入仍返回该项目的列表。
- 开发列表采用同样的来源保留方式。返回目标仅接受同类本地资源列表，外部地址、其他页面和递归返回参数不作为返回目标。
- 事项与开发详情共用 `IssueAssignment` 和 `IssueInformation`，显示分派摘要、版本、优先级、提报人、业务负责人、开发负责人、测试负责人、验收人、创建者和关注人；Bug 严重程度、截止日期和标签按真实数据展示。
- 开发页把分派摘要、任务信息、来源事项信息和开发记录分组；任务状态、执行者及 Agent 状态仍独立呈现。窄屏先显示摘要，详细资料可展开。
- 合并任务可以切换来源事项。协作资料读取所选事项的当前详情，开发范围仍使用纳入任务时保存的内容。切换、迟到请求、权限失败和重试相互隔离；独立任务明确显示没有来源事项。

## 字段与权限

没有新增数据库表、字段、迁移或回填。事项详情接口新增只读派生属性 `developmentAssignment`，包括 `actorId`、`developerId`、`createdAt` 和 `method`；信息来自现有 `issue_history` 的 `assigned` 记录。

按事项修订号读取截至当前修订的最后一次分派，避免相同时间戳导致顺序错误。实际分派对象与当前开发负责人不一致或历史缺失时返回 `null`；不会把创建者、最后编辑人或合并人推断为分派人。自己认领显示认领文案，已释放显示未分派，有开发负责人但缺少对应历史显示「分派记录待确认」。

沿用 `issue.view` 和现有项目授权；只向前端返回必要的人员标识与时间，不公开历史中的完整前后快照。会话身份、个人代码、工作树路径和执行流程保持原有边界。详细语义见[流程契约](../engineering/workflow-actions.md)。

## 功能检查

| 检查 | 结果 |
| --- | --- |
| `npx eslint src test web/src web/vite.config.mjs` | 通过 |
| `npm run build` | 通过；仍有大于 500 kB 的构建分块提示 |
| 架构、单元、集成全量测试 | 696 项，首次并行运行 694 通过、2 项等待 fake Codex 的时序检查失败 |
| 失败文件复跑 | `prompt-settings.test.cjs` 与 `workspaces.test.cjs` 使用 `--test-concurrency=1` 整文件复跑，11/11 通过；没有修改等待时间或跳过断言 |
| 分派来源集成专项 | 通过：真实分派人、编辑、合并、重新分派、相同时间戳、取消、认领、缺少历史与无权读取 |
| Jenkins 浏览器入口 | session、workspaces、dev、accounts、setup、project-collaboration、development-flows、project-editing 均通过 |
| visual 浏览器入口 | 英文标签补齐后的最终复验通过；372 张回归截图，另保存详情专项截图 |

全量测试并非首跑全绿：两项失败均发生在 fake Codex 等待窗口，独立复跑成功。保留首次结果与复跑日志，不能把复跑结果描述为首次全量通过。

详情浏览器专项覆盖事项与开发列表返回、项目内部返回、Bug、筛选与分页、刷新和浏览器历史、非法返回目标；同时检查两个详情页的资料一致性、多来源切换、旧请求晚到、403 清除资料、重试、自行认领、未分派、历史缺失和独立任务。

`project-editing` 日志出现一次 `ResizeObserver loop completed with undelivered notifications`，该入口完成全部断言并返回 0。详情专项未报告页面异常。

## 视觉检查

检查实际 CSS 视口 1920×1080、2560×1440、1440×900、1280×720、768×1024、390×844、320×740。已查看事项与开发详情整页截图、窄屏展开状态、长标题／长姓名和英文 320px；核对主次、分组、对齐、换行、正文空间和返回入口。

原型保留 A/B/C 对比，共 97 张截图；检查方案切换、事项／开发入口、来源切换、键盘返回、认领／空／只读／失败／长文本、中英文和七种视口。原型验证未出现页面错误或外部请求。

正式页面截图存放于忽略目录 `state/browser/issue-context/`：

- [开发详情 · 1440px](../../state/browser/issue-context/task-1440.png)
- [事项详情 · 1440px](../../state/browser/issue-context/issue-1440.png)
- [开发详情 · 390px](../../state/browser/issue-context/task-390.png)
- [事项资料展开 · 390px](../../state/browser/issue-context/issue-expanded-390.png)
- [英文开发详情 · 320px](../../state/browser/issue-context/task-english-320.png)
- [长文本 · 320px](../../state/browser/issue-context/task-long-320.png)

截图使用模拟数据。其中事项截图从项目内部直达，主导航显示「项目」符合该入口；全局「事项」入口由独立导航断言验证。截图和日志不会提交，以上链接供当前本地工作区查看。

原型入口见[方案说明](../prototypes/ui-refactor/detail-context/README.md)。日志位于 `state/verification/detail-context/`、`state/detail-context-eslint.log`、`state/detail-context-build.log`、`state/detail-context-visual-final.log`；原型记录位于 `state/browser/detail-context/verification.json`。

本轮完整回归平台为 Windows / Edge；未在 Linux、macOS 或其他浏览器运行完整测试。数据库使用本轮独立临时 PostgreSQL 容器，Agent 使用 fake，Git 使用临时仓库，没有执行真实需求或修改 TAPD、生产数据。

## 发布前审查

用户随后授权 review 通过后推送两个远端，并覆盖部署至 `192.168.0.64:/root/devloom`，明确要求跳过测试。本次静态审查核对返回目标限制、队列筛选保留、事项权限复核、分派历史排序与字段语义、来源切换的请求代际，以及桌面／窄屏组件分组，未发现阻塞发布的问题。未重跑测试；上文为实施阶段已实际执行的结果。发布时只更新程序文件，沿用现有数据库、配置与业务目录；启动和可访问性检查不代替完整回归。
