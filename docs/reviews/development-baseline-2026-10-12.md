# 开发基线验证记录

日期：2026-10-12。范围见[开发基线 PRD](../prd/development-baseline.md)。

## 实现

- 项目默认、事项继承／覆盖、启动明确选择和任务快照统一为 `baseBranch`；删除原基准引用选择器、HEAD／标签／SHA 输入与旧 refs 接口，不提供运行时兼容回退。
- 每个新运行先保存准备意图，再在共享 Git 操作锁内获取 origin 的确切分支，固定 SHA、保存计划、创建独立 worktree。凭据与保存地址绑定，异步等待后重新授权；不改源仓库检出或脏文件。
- 获取失败持久保存错误，无实际提交时不显示旧 SHA；未创建工作树的失败任务可重载查看。同一运行不会自动再次获取或执行。
- 原会话续聊保持已有基线，追加事项检查有效分支一致。项目任务公开分支与实际提交，其他成员的会话详情和错误仍隔离。
- 审查修复：通用文件配置模式显式选择的分支曾被 runner.local.json 默认值覆盖，现将本次选择独立传入两次配置合并，并有真实远端回归。

## 验证

环境：Windows、Node.js 22.22.0、Docker PostgreSQL 17。未据此宣称 Linux 应用实测通过；未用真实需求或 TAPD 写入验证。

- 全量 ESLint 与 `git diff --check` 通过。
- `node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs`：506/506 通过，0 skipped。
- `npm run build` 通过；保留现有构建包体积提示。
- Jenkins 八个浏览器入口 session、workspaces、dev、accounts、project-collaboration、development-flows、project-editing、visual 全部通过。
- visual 生成 147 张截图；新增启动确认截图另覆盖 1440、768、390、320 像素，人工检查及间距／溢出断言通过。
- 临时 bare remote 覆盖克隆后远端更新、非默认分支、force push、已删除分支、不可达远端、固定 SHA 不受随后 ref 变化影响、权限撤销、取消、锁冲突、脏源目录保留和已有运行不重新执行。
- 隔离数据库覆盖基线继承／覆盖、多事项冲突、缺失拒绝、不可变快照、追加冲突和公开元数据隐私。

## 本地更新

更新前无活动执行与空间准备。PostgreSQL 一致性备份恢复到独立测试数据库，部署最终事务迁移后核对身份指纹。随后对本地业务库部署新增迁移并启动 4318 服务，登录页面 HTTP 200，认证端点正常。

升级前后保留 4 个账号、3 个项目、5 条成员关系、3 个开发空间、1 个工作区、2 条运行记录；账号、工作区、运行路径及 session 身份指纹一致。已有运行仍为 interrupted，未重放。现有项目不会被猜测为 main，使用新任务前请配置默认分支或在启动时明确指定。

日志、备份及截图均位于忽略目录 `state/development-baseline/`、`state/browser/`。未提交或推送本轮修改。
