# 项目协作改造验收记录

日期：2026-10-10。对应 [PRD v1.0](./project-collaboration.md) 和[实施清单](./project-collaboration-implementation.md)。

## 验收证据

| 标准 | 实现与验证 |
| --- | --- |
| AC01 部门 | 平铺部门、单一用户部门、输入校验；`projects.test.cjs` 和项目／账号浏览器检查。 |
| AC02 产品与开发能力 | 产品成员无需 Git 创建／维护事项；伪造会话请求拒绝。仅代码成员可准备自己的仓库并查看 Git，不加载 Codex 会话和 SSE；真实 HTTP 浏览器检查。 |
| AC03 部门上限 | 保存超范围授权被拒；有效权限重新计算、后台活动与 SSE 撤权；`project-permissions.test.cjs`、`projects.test.cjs`、`accounts.test.cjs`。 |
| AC04 项目创建 | 账号创建资格与所属部门功能上限双重校验；项目不归属部门，一项目一仓库、创建者负责人；生产个人空间创建接口拒绝。 |
| AC05 跨部门隔离 | 跨部门成员、非成员及事项／附件跨项目访问；服务端授权与数据库复合外键；项目内容与账号集成测试。 |
| AC06 空间分配 | 代码操作权限自动分配空间；凭据未配置不克隆，幂等准备、撤权时不发布；仅代码权限也可独立使用 Git。 |
| AC07 个人 Git | 主机级多账号、认证与提交作者分离；真实临时 Git 的访问检测、加密与修订号轮换；Git 账号、项目和凭据集成测试。 |
| AC08 多对多执行 | 同一事项多任务、融合启动、冻结快照与显式追加；`project-development.test.cjs` 及项目浏览器两轮 fake Codex 执行。 |
| AC09 状态独立 | 创建、编辑、分派、流转不启动执行；开发完成不验收；原 SessionManager + 临时 Git + fake Codex 验证。 |
| AC10 固定流程 | 需求／Bug 非法跳转、独立验收权限、退回原因、修订号并发冲突；领域及项目内容测试。 |
| AC11 TAPD | 模拟只读抓取、项目内来源去重、不覆盖本地字段、抓取后再授权；不向真实 TAPD 写入。 |
| AC12 资产 | 五类资产、版本、标签／分类／负责人／关联、附件、加密敏感历史和访问审计；普通响应无敏感明文。 |
| AC13 资产隔离 | 开发只读取已选择事项及其图片；资产及资产附件不能冒充事项附件进入任务。 |
| AC14 人员生命周期 | 负责人接任、成员移除、撤权停止及保留空间／历史身份；项目与账号集成测试。 |
| AC15 PostgreSQL | 唯一生产存储为 PostgreSQL + Prisma；真实数据库迁移、版本校验、事务回滚、连接失败、账号／执行／历史与附件测试。 |
| AC16 旧数据 | 无 SQLite 运行依赖、导入或回退；测试确认旧数据库文件保持不变。原业务目录不搬移、不清理、不重新执行。 |
| AC17 工程验证 | 完整 lint、架构／单元／集成、构建以及 Jenkins 的六个浏览器入口；具体结果见下方。 |

以上测试文件分别位于 `test/unit/`、`test/integration/` 和 `test/browser/`，不是生产操作脚本。

## 验证环境与结果

- Windows，Node.js 22.22.0，Docker PostgreSQL 17；随机 PostgreSQL schema、临时 Git 仓库、fake Codex 和模拟 TAPD。
- `npx eslint src test web/src web/vite.config.mjs` 通过。
- `node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs` 审查修复后通过 383/383，零失败、零跳过、零取消，耗时约 130 秒。
- `npm run build` 通过，生成 Prisma CommonJS 客户端及前端资源。Vite 保留主包超过 500 kB 的体积提示，未影响构建。
- 浏览器 `session`、`workspaces`、`dev`、`accounts`、`project-collaboration`、`visual` 全部通过；新项目入口已纳入 Jenkins 双平台矩阵。
- 视觉回归生成 147 张截图，其中新项目 15 个场景分别覆盖 1440、768、390、320px。检查项目目录／创建、需求／Bug、资产遮罩／编辑、任务快照／追加、成员／权限、设置和生产项目会话；无意外横向溢出及说明遮挡。
- 本次实际查看项目创建桌面图、成员授权图、320px 需求图和资产遮罩图、只授予代码权限的仓库图，以及账号／Git 配置和项目表单截图。
- 截图索引生成在被忽略的 `state/browser/unified/index.html`；账号与真实项目测试截图分别位于 `state/browser/accounts/`、`state/browser/projects/`。日志位于 `state/verification/`，不提交运行数据。

本次没有运行 Linux 应用回归、真实 Codex 服务或真实 TAPD。Jenkins 节点须各自提供专用 `TEST_DATABASE_URL`；配置流水线不代表已经获得 Linux CI 结果。没有执行部署、推送或自动合并。

## 审查问题回归

- 局域网 HTTP：项目需求、开发空间及任务统一使用兼容普通 HTTP 的请求 ID 生成器。项目浏览器用例禁用 `crypto.randomUUID`，实际执行页面浏览、准备空间、启动任务和追加资料，验证初始化和后续 ID 更新均可用。
- 提示词默认值：项目设置中的空白模板发送 `null`，恢复渠道默认模板；非空模板保持原文。浏览器通过真实 HTTP 验证未配置模板时修改项目设置、自定义模板逐字保留，以及清空后保存并重新打开。
- 空间准备重试：每次受理使用 `repository-<准备修订号>`，失败目录保留，已就绪空间路径不变。新增两条真实本地 Git 集成回归，分别覆盖克隆认证失败和克隆完成后配置变更导致发布失败，再明确重试成功；同时验证重复请求不重放、旧文件保留和只发布一个工作空间。
- 完整架构／单元／集成日志：`state/verification/review-fix-tests.log`。浏览器和运行数据仍为忽略文件。
