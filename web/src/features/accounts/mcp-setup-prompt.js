export function mcpSetupPrompt({ origin, secret, expiresAt }) {
  const source = new URL("/skills/web-coding-issue-authoring/manifest.json", origin).href;
  const endpoint = new URL("/mcp", origin).href;
  return [
    "请为当前 Agent 安装 Web Coding 需求与 Bug 提报技能并配置 MCP。", "",
    "技能清单：" + source,
    "MCP 地址：" + endpoint,
    "个人 Token：" + secret,
    "到期时间（ISO 8601）：" + expiresAt, "",
    "1. 无凭据、绕过缓存读取清单，校验名称 web-coding-issue-authoring、版本及同源下载地址。下载清单内 scripts/update-skill.cjs 并核对大小与 SHA-256，使用 Node.js 22.13+ 运行：node <已校验脚本> --source <清单URL> --directory <客户端支持的技能目录绝对路径/web-coding-issue-authoring>。安装完整目录及 references、agents、scripts，不能只保存 SKILL.md。检查成功结果后重新读取入口；保留其他配置，不覆盖人工修改。",
    "2. 按当前客户端支持的方式配置 Streamable HTTP MCP，使用 Authorization: Bearer 认证。将此 Token 存入客户端凭据配置或本地环境变量，不写入项目、技能、日志或 URL，也不要在回复中复述 Token。",
    "3. 配置后调用 whoami 并检查客户端提供的工具 schema，确认身份、权限和 token.expiresAt。站点和 MCP 地址使用 runtime，后续每轮使用 skills.manifestUrl 检查整包更新；上传使用 create_upload_token.uploadUrl。tools/list 是 MCP 协议方法，不是业务工具。如需重载客户端，明确说明；保存配置不等于连接验证成功。",
    "4. 每次使用前检查到期时间，剩余不足 7 天时提醒我更新；已经过期时停止调用，提示创建新 Token。如支持定时提醒，请在到期前 3 天提醒一次；若该时间已过则现在提醒，不创建过去的提醒。不支持时明确说明只能在使用时提醒。提醒只包含站点、到期时间和更新入口，不包含 Token；避免重复创建同一提醒。",
    "5. 发布前按技能检查原型、需求规则、Bug 四项必填和完整草稿，并按我的授权提交。本次只完成安装与配置，不发布事项或启动开发。", "",
    "请反馈安装版本、连接验证结果和提醒方式，不回显凭据。",
  ].join("\n");
}
