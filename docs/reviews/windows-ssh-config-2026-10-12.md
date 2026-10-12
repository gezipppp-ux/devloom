# Windows SSH 配置文件兼容修复

日期：2026-10-12。承接 Gitee HTTPS／SSH 地址匹配修复。

## 原因与修改

真实连接诊断发现 Git for Windows 自带的 SSH 将 `-F NUL` 解释为普通路径，返回 `Can't open user config file NUL: No such file or directory`。此时尚未连接远程 Git 服务，统一的“账号密码或 SSH 公钥授权”提示掩盖了本地配置问题。

`createSshPrivateKeyFile` 现在在受保护的临时密钥目录内创建真实空配置文件，单次 Git 操作和 Agent 的 Git 凭据环境均以 `-F` 引用该文件。Windows ACL／POSIX 目录及文件权限、禁用个人 SSH 配置和 agent、显式密钥认证、主机验证规则保持。成功、失败或连接关闭后，配置与密钥一起清理。

## 验证

- 使用报错项目已绑定账号作只读 `git ls-remote` 诊断：修复前稳定复现配置文件错误；修复后连接成功并读取到 2 条远程引用。未输出私钥、未克隆或执行真实需求。
- 无网络回归通过 Windows OpenSSH、Git for Windows OpenSSH、Codex runtime 自带 Git OpenSSH 的 `-G` 真实配置解析，验证空配置文件及认证隔离参数。
- 覆盖临时配置存活期、失败清理、连接关闭清理及 POSIX 权限断言；本轮运行环境为 Windows，Linux 未执行。
- 全量 ESLint、Prisma 客户端及前端构建、diff 空白检查通过；架构、单元和集成测试 493/493 通过，0 失败、0 跳过。本轮仅改后端 SSH 环境及测试，未改 Vue 页面。构建保留原有的 500 kB 包体积提示。

Docker PostgreSQL 与修复后的本地服务已启动，`http://127.0.0.1:4318` 页面及会话入口 HTTP 200，启动错误日志为空。启动后再次用项目已绑定的账号作只读连接检查成功，成员可在原项目重试空间准备。

日志及诊断脚本保存在忽略目录 `state/git-ssh-diagnosis/`；无需数据库迁移或更换用户密钥。
