# PostgreSQL 与 Prisma 接入

关联 [PRD](../prd/project-collaboration.md) 的 P1 阶段。生产入口已切换为 PostgreSQL + Prisma；验证与交付记录见[实施清单](../prd/project-collaboration-implementation.md)。

## 所属边界

- `prisma/schema.prisma` 和 `prisma/migrations/` 是 storage 所有的数据结构定义和版本化 SQL；根目录仅承载 Prisma 工具所需的标准目录。
- `prisma.config.cjs` 只配置 schema、迁移目录及环境提供的连接地址，导入不执行网络或迁移。
- `generated/prisma/` 为 Prisma 生成的 TypeScript，`generated/prisma-runtime/` 为编译后的 CommonJS；全部忽略，不编辑、不提交。只有 `src/storage/postgres-database.cjs` 可以导入生成客户端；业务代码不得绕过 storage 直接访问 Prisma。
- 保留既有 CommonJS 业务模块。`tsconfig.prisma.json` 仅编译生成客户端，不把业务重构隐式扩大成全站 TypeScript 改造。
- 只支持全新部署，旧 PostgreSQL、SQLite、JSON/JSONL 均不兼容、不转换。旧升级脚本已删除，不导入或自动删除旧数据。
- `20261013180000_project_directory_names` 新增项目目录名和不区分大小写的唯一键。存在历史项目、工作区或任务时明确拒绝迁移，要求全新数据库，不回填旧 UUID 目录、不移动或删除文件；已发布迁移保持原样。
- `20261014160000_remove_setup_credentials` 删除初始化凭证摘要及有效期字段，保留部署状态、管理员身份和已完成步骤；全新空部署直接通过 `/setup` 创建管理员。

## 构建和连接

`npm run db:generate` 生成并编译客户端，不需要连接数据库。`npm run build` 先执行客户端构建，再构建 Vue。安装依赖后运行检查前，也需先生成客户端。

`DATABASE_URL` 必须明确指定 PostgreSQL 主机和数据库。可用 `?schema=...` 指定由当前部署独占的 schema；默认 `public`。schema 仅允许 1–63 位小写字母、数字和下划线，首字符不能为数字。连接池上限 10，连接等待 5 秒，空闲回收 30 秒，语句超时 10 秒。

连接地址和数据库错误不得原样返回页面或写入包含凭据的日志。生产根据部署环境配置 TLS；测试连接仅绑定本机并使用一次性测试凭据。

## 全新部署基线

`prisma/migrations/20261012200000_baseline/migration.sql` 是唯一安装基线，直接创建当前 Prisma 模型、数据库 CHECK 约束及需求／Bug 两套系统流程。旧的 11 步 PostgreSQL 迁移链和 SQLite 升级脚本已删除；不再先建旧表后删除、复制旧字段或回填历史数据。流程初始发布版本从基线内的草稿复制，避免维护两份相同 JSON。

正式部署由运维对新的空数据库/schema 执行 `npm run db:deploy`，不使用 `db push` 或 `migrate reset`。基线显式放在 PostgreSQL 事务中，失败不能留下部分表结构；发现其他已完成迁移记录时立即拒绝。重复部署当前基线是幂等操作。

`PostgresDatabase.connect()` 检查迁移记录、未完成迁移、已执行文件的 SHA-256 及未知／未来版本。未部署、待升级、失败、校验不符或高于应用版本时拒绝就绪。不在启动时盲目覆盖或降级数据库。

新部署使用独立 PostgreSQL 数据库/schema 和新的运行数据目录。旧部署不能原地升级至此基线，不使用 `migrate resolve` 伪造基线已执行。旧数据库、凭据密钥、Git、Worktree 和 Codex 会话资料留在原处；当前程序不迁移、不读取、不清理这些数据。后续基于当前基线的兼容结构变更才新增迁移，启动检查不能跳过。

项目直接保存 `remote_url`，无独立仓库目录或项目部门字段；账号 `display_name` 必填。项目个人提示词位于 `project_members.prompts` 与独立 `prompt_revision`，项目默认位于 `projects.settings.prompts`，仅接受 `bug`、`requirement`。事项不保存默认分支；任务启动时选择的分支和实际 commit 分别保存于任务 snapshot 与运行 worktree.baseline。

## 事务与生命周期

通过 `PostgresDatabase.transaction()` 运行短事务，默认 Serializable，等待和执行各最多 5 秒。回调只包含数据库操作，不等待网络、Git 或 Codex。冲突由上层按业务幂等性处理，不自动重放任意回调。

AsyncLocalStorage 使同一事务中的多个 store 使用同一客户端，并隔离不同并发请求。嵌套操作加入外层事务；嵌套失败即使被调用方捕获，整个事务仍回滚。关闭是异步且幂等的，调用方必须等待关闭完成。

## 验证

单元测试验证连接配置、schema 注入防护和迁移版本判断。集成测试必须针对临时 PostgreSQL，覆盖基线与 Prisma 结构一致、默认流程、CHECK 约束、重复部署、旧迁移历史拒绝且业务数据不变、DDL 事务回滚、并发唯一性、外键、JSON／二进制及失败关闭。旧数据升级测试已由 `test/integration/database-baseline.test.cjs` 替代。

使用 `TEST_DATABASE_URL` 指向专用测试数据库。测试为每例创建随机 schema 并只清理自己创建的 schema，不能对普通 `DATABASE_URL` 执行清理。CI 需提供专用 PostgreSQL，不能把未运行真实数据库测试描述为通过。

Jenkins 的 Windows／Linux 节点都需由节点环境或受控凭据注入 `TEST_DATABASE_URL`；账号只需要专用测试数据库内的 schema 创建与清理权限。流水线在测试前生成客户端；`CI=true` 时缺少连接配置会使 PostgreSQL 集成测试失败。完整测试套件要求配置 `TEST_DATABASE_URL`；个别 PostgreSQL 专项测试在本地缺少配置时可标为 skipped，但不能据此交付。

项目交付使用 `ProjectDeliverable` / `project_deliverables`，可关联事项或本人已启动的独立任务；不再维护 IssueDeliverable 模型。独立交付无事项外键，必须有任务来源和项目外键。验收权限为 `deliverable.review`，验收写入审计；事项流转单独授权。个人设置的 grouping 字段已删除，无历史字段读取或兼容接口。
