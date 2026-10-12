# PostgreSQL 与 Prisma 接入

关联 [PRD](../prd/project-collaboration.md) 的 P1 阶段。生产入口已切换为 PostgreSQL + Prisma；验证与交付记录见[实施清单](../prd/project-collaboration-implementation.md)。

## 所属边界

- `prisma/schema.prisma` 和 `prisma/migrations/` 是 storage 所有的数据结构定义和版本化 SQL；根目录仅承载 Prisma 工具所需的标准目录。
- `prisma.config.cjs` 只配置 schema、迁移目录及环境提供的连接地址，导入不执行网络或迁移。
- `generated/prisma/` 为 Prisma 生成的 TypeScript，`generated/prisma-runtime/` 为编译后的 CommonJS；全部忽略，不编辑、不提交。只有 `src/storage/postgres-database.cjs` 可以导入生成客户端；业务代码不得绕过 storage 直接访问 Prisma。
- 保留既有 CommonJS 业务模块。`tsconfig.prisma.json` 仅编译生成客户端，不把业务重构隐式扩大成全站 TypeScript 改造。
- PostgreSQL 基线独立于历史 SQLite 升级脚本。不得重放、修改或删除已发布的 SQLite 升级来假装已迁移数据。

## 构建和连接

`npm run db:generate` 生成并编译客户端，不需要连接数据库。`npm run build` 先执行客户端构建，再构建 Vue。安装依赖后运行检查前，也需先生成客户端。

`DATABASE_URL` 必须明确指定 PostgreSQL 主机和数据库。可用 `?schema=...` 指定由当前部署独占的 schema；默认 `public`。schema 仅允许 1–63 位小写字母、数字和下划线，首字符不能为数字。连接池上限 10，连接等待 5 秒，空闲回收 30 秒，语句超时 10 秒。

连接地址和数据库错误不得原样返回页面或写入包含凭据的日志。生产根据部署环境配置 TLS；测试连接仅绑定本机并使用一次性测试凭据。

## 版本化升级

开发使用 Prisma 生成可审查的迁移 SQL；正式部署由运维执行 `npm run db:deploy`，不使用 `db push` 或 `migrate reset`。迁移 SQL 显式放在 PostgreSQL 事务中，失败不能留下部分表结构。部署前备份由 PostgreSQL 运维流程负责，不能沿用 SQLite 文件复制或内置 backup API。

`PostgresDatabase.connect()` 检查迁移记录、未完成迁移、已执行文件的 SHA-256 及未知／未来版本。未部署、待升级、失败、校验不符或高于应用版本时拒绝就绪。不在启动时盲目覆盖或降级数据库。

新部署使用独立 PostgreSQL 数据库和运行数据目录。该模块不读取旧 SQLite，不创建 SQLite 备份，不搬移旧 worktree。凭据主密钥和业务工作目录仍按现有约定单独保存。

`20261012000000_project_repository` 将仓库地址收归 `projects.remote_url`，删除 `projects.repository_id` 及独立 `repositories` 表。应用只使用新模型、字段和接口；版本化 SQL 在同一事务中保留已有项目关联的地址，随后删除旧结构，不保留双写或兼容读取。该升级不改变项目、开发空间、任务及其记录路径。

`20261012010000_project_department_removal` 删除项目的 `department_id`、相关外键及部门内名称唯一索引，账号的部门关联保持不变。项目使用稳定 ID 区分，不改为全局名称唯一约束；已有项目、成员和空间身份保留，不增加旧字段兼容读取。

`20261012020000_account_display_name` 增加必填 `users.display_name`，已有账号一次性以用户名初始化显示名称，不改变登录名、用户 ID、会话版本或工作目录。新客户端与应用只读写新结构，不提供运行时缺字段回退；迁移后可在账号管理或个人设置中修改显示名称。

## 事务与生命周期

`20261012170000_project_prompt_preferences` 为 `project_members` 增加个人模板 `prompts` 与独立 `prompt_revision`。项目默认仍存放于 `projects.settings.prompts`。新代码只接受 `bug`、`requirement`，迁移不转换历史手动或 TAPD 模板，也不修改已保存的任务资料、会话与目录。

`20261012030000_development_baseline` 曾为事项增加 `base_branch`。`20261012160000_remove_project_issue_branch_defaults` 删除该列、移除项目 settings JSON 中的 `baseBranch`，清空项目空间配置里复制的默认分支，并清除事项快照副本。任务受理时选择的实际分支仍保存在不可变任务 snapshot，实际 commit 保存在运行 worktree.baseline；已有任务身份、路径及执行基线不变。

通过 `PostgresDatabase.transaction()` 运行短事务，默认 Serializable，等待和执行各最多 5 秒。回调只包含数据库操作，不等待网络、Git 或 Codex。冲突由上层按业务幂等性处理，不自动重放任意回调。

AsyncLocalStorage 使同一事务中的多个 store 使用同一客户端，并隔离不同并发请求。嵌套操作加入外层事务；嵌套失败即使被调用方捕获，整个事务仍回滚。关闭是异步且幂等的，调用方必须等待关闭完成。

## 验证

单元测试验证连接配置、schema 注入防护和迁移版本判断。集成测试必须针对临时 PostgreSQL，覆盖版本化部署、重复部署、真实提交／回滚、并发唯一性、外键、JSON／二进制及失败关闭。

使用 `TEST_DATABASE_URL` 指向专用测试数据库。测试为每例创建随机 schema 并只清理自己创建的 schema，不能对普通 `DATABASE_URL` 执行清理。CI 需提供专用 PostgreSQL，不能把未运行真实数据库测试描述为通过。

Jenkins 的 Windows／Linux 节点都需由节点环境或受控凭据注入 `TEST_DATABASE_URL`；账号只需要专用测试数据库内的 schema 创建与清理权限。流水线在测试前生成客户端；`CI=true` 时缺少连接配置会使 PostgreSQL 集成测试失败。完整测试套件要求配置 `TEST_DATABASE_URL`；个别 PostgreSQL 专项测试在本地缺少配置时可标为 skipped，但不能据此交付。
