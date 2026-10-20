# 会话询问弹窗只读检查

用户反馈 GPT-6-Astra 的选择询问只显示文字，要求检查是否被移除，并明确禁止修改正在执行的线上任务。

## 已确认

- 弹窗由 `c11c803`（2026-10-10，兼容 Codex 问题弹窗与非阻塞提问）加入，此后保留。后续修改主要为 Agent 适配层、反馈组件和国际化；本次 A 方案也没有移除 `SessionRequest`／`SessionQuestions`。
- `WorkspaceConsole.vue` 只将第一个阻塞问题设为自动打开；`SessionQuestions.vue` 同样检查 `blocking`。非阻塞问题显示「回答问题」入口，由用户打开。这一规则从上述提交开始即存在。
- 当前 Codex 适配器仍声明 `userInput: true`，初始化仍发送 `experimentalApi: true`，识别 `item/tool/requestUserInput` 并原样回传明确回答，不依赖模型名称。
- Windows / Edge 会话回归已通过：阻塞问题自动弹出、选项与自由输入、未填写不提交、Escape 收起／重开、失败保留答案、刷新恢复待回答请求；非阻塞问题手动打开且允许补充指令。
- 只读检查用户指定的「优化注册与找回密码流程」：模型为 `gpt-6-astra`，能力 `userInput: true`，读取时 `status: running`、`requests: []`。读取两页历史后定位到截图中的询问，其类型为 `agentMessage`；后续用户通过普通消息作答。没有发现当前待处理问题被界面隐藏的证据。

## 结论与限制

未发现询问弹窗被删除或被 A 方案折叠的回归。截图中的历史条目以普通消息呈现，不能据此重新构造一个有效的 RPC 回答请求。已结束／已清理的请求不会长期保存在待回答列表，因此当前快照不能证明提问当时从未产生结构化请求，也不能区分模型直接输出文字、上游降级或请求先前已清理。精确定位该次上游行为需要服务器对应时刻的原始事件；本次没有修改线上配置或为复现启动真实任务。

本机 `codex-cli 0.163.0-alpha.10.2` 离线生成的协议仍采用 `item/tool/requestUserInput`、`isBlocking`、`questions` 和原有回答结构，与适配器兼容。本机功能列表中的 `default_mode_request_user_input` 为 false；这不代表线上服务器的开关，也不能作为该次异常的根因结论。

参考[官方 App Server 协议](https://learn.chatgpt.com/docs/app-server#toolrequestuserinput)：`serverRequest/resolved` 可因回答、轮次完成或中断等清理触发。当前线上核对仅进行了登录、会话与历史 GET 读取；没有发送消息、回答问题、修改设置、停止／重启／恢复任务或部署本地代码。账号密码及 Cookie 未写入仓库或检查日志。
