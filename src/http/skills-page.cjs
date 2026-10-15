const path = require("node:path");
const { marked } = require("marked");
const { root } = require("../config/runtime.cjs");
const { sendFile } = require("./assets.cjs");

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function registerSkillsRoutes(instance, skills) {
  const prefix = "/skills/web-coding-issue-authoring";
  instance.get("/skills/theme.css", async (_request, reply) => {
    reply.hijack();
    sendFile(reply.raw, path.join(root, "web/src/shared/styles/design-tokens.css"), "no-cache");
  });
  instance.get(prefix + "/manifest.json", async (request, reply) =>
    reply.header("cache-control", "no-cache").send(await skills.manifest(request.applicationUrl.origin)));
  instance.get(prefix + "/releases/:version/:digest/*", async (request, reply) => {
    const file = await skills.file(request.params.version, request.params.digest, request.params["*"]);
    if (!file) return reply.code(404).send({ error: "技能文件不存在。" });
    if (file.download) reply.header("content-disposition", 'attachment; filename="' + file.download + '"');
    return reply.header("cache-control", "public, max-age=31536000, immutable").type(file.type).send(file.data);
  });
  // Removed single-file routes must never fall through to the application SPA.
  instance.get("/skills/*", async (_request, reply) => reply.code(404).send({ error: "技能资源不存在。" }));
  for (const url of ["/skills", "/skills/"]) instance.get(url, async (request, reply) => {
    const skill = await skills.page(request.applicationUrl.origin);
    reply.header("cache-control", "no-cache").header("vary", "Accept");
    if (/\btext\/markdown\b/i.test(request.headers.accept || ""))
      return reply.type("text/markdown; charset=utf-8").send(skill.markdown);
    const prompt = `请为当前 Agent 安装 Web Coding 需求与 Bug 提报技能。清单：${skill.manifestUrl}。无凭据、绕过缓存读取清单，校验名称 web-coding-issue-authoring、版本和同源文件地址。下载清单中的 scripts/update-skill.cjs 并核对大小与 SHA-256，使用 Node.js 22.13+ 运行：node <已校验脚本> --source <清单URL> --directory <客户端支持的技能目录绝对路径/web-coding-issue-authoring>。安装完整目录，不能只保存 SKILL.md；保留其他配置。之后每轮使用时通过当前 MCP 连接的 whoami.skills.manifestUrl 检查整包更新。MCP 凭据单独配置。本次只安装，不发布事项或启动开发。请反馈安装版本和结果。`;
    const article = marked.parse(skill.markdown.replace(/^---\n[\s\S]*?\n---\n/, ""))
      .replace(/href="([^"#]+)"/g, (_match, href) => 'href="' + escapeHtml(new URL(href, skill.entryUrl).href) + '"')
      .replaceAll("<table>", '<div class="table-scroll" tabindex="0" role="region" aria-label="技能规则"><table>')
      .replaceAll("</table>", "</table></div>");
    return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>需求与 Bug 提报技能 · Web Coding</title><link rel="alternate" type="text/markdown" href="${escapeHtml(skill.entryUrl)}"><link rel="stylesheet" href="/skills/theme.css">
<style>
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink);font:15px/1.8 var(--font-ui)}
header,main,footer{max-width:960px;margin:auto;padding:24px var(--page-gutter)}header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line)}
nav,.actions{display:flex;flex-wrap:wrap;gap:16px;align-items:center}a{color:var(--highlight);text-underline-offset:4px}nav a,.actions a{display:inline-flex;min-height:44px;align-items:center}
h1{font-size:clamp(28px,4vw,32px);line-height:1.3;margin:12px 0 20px}h2{font-size:21px;line-height:1.5;margin:40px 0 16px}p{margin:14px 0;overflow-wrap:anywhere}
h3{font-size:17px;line-height:1.5;margin:28px 0 10px;overflow-wrap:anywhere}li{margin:12px 0;overflow-wrap:anywhere}.table-scroll{max-width:100%;overflow:auto;margin:20px 0}table{width:100%;min-width:560px;border-collapse:collapse;font-size:14px}th,td{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{background:var(--soft)}th:first-child{width:30%}td{overflow-wrap:anywhere}
.intro{padding:12px 0 28px;border-bottom:1px solid var(--line)}.eyebrow,footer{color:var(--muted);font-size:13px}.primary{padding:10px 18px;background:var(--accent);color:var(--on-accent);border-radius:var(--radius-control);text-decoration:none}
pre{padding:20px;background:var(--soft);border:1px solid var(--line);border-radius:var(--radius-control);max-width:100%;overflow:auto;font:13px/1.7 var(--font-code)}code{font-family:var(--font-code);overflow-wrap:anywhere}pre code{overflow-wrap:normal}textarea{width:100%;min-height:120px;resize:vertical;padding:16px;font:14px/1.7 var(--font-ui);border:1px solid var(--field-border);border-radius:var(--radius-control);color:var(--ink);background:var(--surface)}
article{min-width:0}article>h1{font-size:24px;margin-top:40px}a:focus-visible,textarea:focus-visible,.table-scroll:focus-visible{outline:2px solid var(--focus);outline-offset:3px}footer{border-top:1px solid var(--line)}
@media(max-width:600px){header{align-items:flex-start;flex-direction:column}pre{padding:14px}main{padding-top:16px}}
@media(max-width:767px){.table-scroll{overflow:visible}table{display:block;min-width:0}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}tbody,tr,td{display:block;width:100%}tr{border-bottom:1px solid var(--line)}td{border:0}td:first-child{padding-bottom:0;font-weight:600}td+td{padding-top:6px}}
</style></head><body>
<header><strong>Web Coding / Skills</strong><nav aria-label="页面导航"><a href="/personal?tab=mcp">MCP 接入设置</a></nav></header>
<main><section class="intro"><p class="eyebrow">需求 · Bug · 原型与验收</p><h1>需求与 Bug 提报技能</h1>
<p>把想法、原型和故障资料整理成可实施、可验证的事项。页面需求必须有已核验的原型，Bug 必须有完整的描述、复现步骤、预期与实际结果。</p>
<p>当前版本：<strong>${escapeHtml(skill.version)}</strong> · 中文 · 无需登录即可阅读和下载</p>
<div class="actions"><a class="primary" href="${escapeHtml(skill.packageUrl)}" download="web-coding-issue-authoring.zip">下载完整技能包</a><a href="${escapeHtml(skill.manifestUrl)}">查看版本清单</a><a href="#install">让 Agent 安装</a></div>
<h2 id="install">让 Agent 安装技能</h2><label for="install-prompt">将这段提示词发给 Agent</label><textarea id="install-prompt" readonly>${escapeHtml(prompt)}</textarea>
<p>完整包包含入口、规范、界面元数据和更新脚本。Agent 需要能访问本站、支持本地技能文件并具有 Node.js 22.13+。每轮使用时检查更新，失败保留原版本；站点地址从当前 MCP 连接获取。访问凭据单独配置。</p></section>
<article aria-label="技能正文">${article}</article></main><footer>Web Coding · Streamable HTTP MCP</footer></body></html>`);
  });
}

module.exports = { registerSkillsRoutes };
