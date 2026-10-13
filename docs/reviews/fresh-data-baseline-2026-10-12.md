# 不兼容旧数据审查与迁移精简

日期：2026-10-12。按本次要求，以全新部署为前提审查持久化、来源身份、执行复用、项目设置及部署契约，并执行全仓架构、单元、集成和浏览器回归。未使用生产数据库、真实需求或 TAPD 写操作。

## 发现与修复

1. **迁移链仍在维护旧数据升级。** 11 份 PostgreSQL SQL 包含旧仓库地址复制、账号显示名回填、开发任务创建人回填、默认分支 JSON 清理，以及先创建项目流程再删除的步骤；另有 3 份已无调用方的 SQLite 升级脚本。现按当前 Prisma 模型直接生成 [唯一基线](../../prisma/migrations/20261012200000_baseline/migration.sql)，删除全部旧脚本。保留 37 张表、51 个外键、10 项自定义 CHECK 约束和两套已发布系统流程。PostgreSQL SQL 从 48,248 字节减至 37,433 字节，约减少 22%。

2. **旧库会先得到“请部署待执行迁移”的错误指引。** 启动校验原先先判断缺失迁移，再判断未知历史。现在优先拒绝不属于当前代码的已完成迁移记录；基线在事务内也拒绝其他迁移历史，不转换或清除旧业务数据。重复部署当前基线仍然幂等，DDL 中途失败整体回滚。

3. **通用执行模块仍推断已退役渠道。** 来源缺失时，会话呈现、需求归属、Worktree 规划和执行重试会默认为 TAPD；复用运行记录时也未核对完整的已保存 source。现在来源必须明确，新 key 统一采用渠道前缀加哈希，复用时核对完整来源与 workitem。缺失来源或来源不一致时拒绝操作，不创建第二次执行。已记录 key、会话和目录不改写。

4. **存储仍保留旧结构回退。** 删除 `tapd-task.json` 文件回退、TAPD 设置加解密和旧 `session.id`／字符串 execution／顶层 status 投影。项目与工作区设置直接使用当前结构，Git 凭据、SSH 草稿及资产敏感值的现有加密保持有效。项目执行上下文只组合当前字段，移除逐个转换或删除旧字段的逻辑。

5. **当前文档与实现不一致。** README、部署和工程契约统一为新数据库/schema 加新数据目录；历史审查记录增加基线替代说明。同时修正 `.env` 读取方式、Agent 命令字段、成员目录示例和 Skill 中不存在的 npm 检查命令。

## 验证

环境：Windows、Node.js v25.8.2、Edge、隔离 PostgreSQL 17 容器。测试数据库只绑定本机临时端口，每个用例使用随机 schema；测试结束关闭并移除容器。

- `npx eslint src test web/src web/vite.config.mjs`：通过。
- `node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs`：502 项通过，0 失败、0 跳过。
- `npm run build`：通过。仍有构建产物超过 500 kB 的提示，不影响此次构建。
- Jenkinsfile 的 8 个浏览器入口：session、workspaces、dev、accounts、project-collaboration、development-flows、project-editing、visual 全部通过。
- 视觉脚本生成 200 张桌面／平板／手机截图，自动检查无横向溢出或说明重叠；抽查会话桌面／手机及 320px 账号页截图。
- [数据库基线回归](../../test/integration/database-baseline.test.cjs)：首次及重复部署、Prisma 结构无差异、系统流程与领域默认定义一致、CHECK 约束保留、旧历史拒绝且业务记录不变、DDL 冲突整体回滚。
- 显式来源、来源缺失／不一致拒绝、旧任务文件不回读、凭据加密和任务身份保留由单元及集成测试覆盖。
- `git diff --check` 和修改文档的本地链接检查通过。

本轮未执行 Linux 实机验证。回归通过不代表已证明不存在其他缺陷。

## 部署要求

旧 PostgreSQL 迁移链、SQLite 和文件数据不支持原地升级。使用新的空数据库/schema 与新的 `RUNNER_DATA_DIR`，再运行 `npm run db:deploy` 和 `npm run init:admin`。旧数据库、密钥和业务目录留在原处，不自动导入、搬移或删除。具体步骤见 [PostgreSQL 接入](../engineering/postgresql.md) 与 [部署说明](../deployment.md)。
