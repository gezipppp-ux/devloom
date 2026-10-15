const path = require("node:path");
const {marked} = require("marked");
const {root} = require("../config/runtime.cjs");
const {presentMcpSkill} = require("../application/mcp-skills-presenter.cjs");
const {sendFile} = require("./assets.cjs");

function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function registerSkillsRoutes(instance) {
    instance.get("/skills/theme.css", async (_request, reply) => {
        reply.hijack();
        sendFile(reply.raw, path.join(root, "web/src/shared/styles/design-tokens.css"), "no-cache");
    });
    for (const url of ["/skills", "/skills/", "/skills/SKILL.md"]) instance.get(url, async (request, reply) => {
        const en = request.applicationUrl.searchParams.get("lang") === "en";
        const language = en ? "en" : "zh";
        const origin = request.applicationUrl.origin;
        const markdown = presentMcpSkill(origin, language);
        reply.header("cache-control", "no-cache").header("vary", "Accept");
        if (url.endsWith(".md") || /\btext\/markdown\b/i.test(request.headers.accept || ""))
            return reply.type("text/markdown; charset=utf-8").send(markdown);
        const title = en ? "Agent Skills guide" : "Agent Skills 指南";
        const prompt = en
            ? `Read ${origin}/skills and save ${origin}/skills/SKILL.md?lang=en as web-coding-mcp/SKILL.md in your supported skills directory. Use this skill for Web Coding requests. Configure MCP credentials separately; do not publish an issue during installation.`
            : `请读取 ${origin}/skills，将 ${origin}/skills/SKILL.md 保存到你支持的技能目录 web-coding-mcp/SKILL.md，之后按此技能处理 Web Coding 需求。MCP 凭据单独配置，安装时不要发布事项。`;
        // Only repository-owned Markdown is rendered. The validated origin is escaped
        // before parsing so document content cannot introduce raw HTML through Host.
        const article = marked.parse(presentMcpSkill(escapeHtml(origin), language).replace(/^---\n[\s\S]*?\n---\n/, ""))
            .replaceAll("<table>", `<div class="table-scroll" tabindex="0" role="region" aria-label="${en ? "Issue fields" : "事项字段"}"><table>`)
            .replaceAll("</table>", "</table></div>");
        return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="${en ? "en" : "zh-CN"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Web Coding</title><link rel="alternate" type="text/markdown" href="/skills/SKILL.md${en ? "?lang=en" : ""}"><link rel="stylesheet" href="/skills/theme.css">
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
<header><strong>Web Coding / Skills</strong><nav aria-label="${en ? "Page navigation" : "页面导航"}"><a href="/personal?tab=mcp">${en ? "MCP settings" : "MCP 接入设置"}</a><a href="/skills?lang=${en ? "zh" : "en"}" lang="${en ? "zh-CN" : "en"}">${en ? "简体中文" : "English"}</a></nav></header>
<main><section class="intro"><p class="eyebrow">MCP · ${en ? "Attachments" : "附件"} · ${en ? "Requirements and bugs" : "需求与 Bug"}</p><h1>${title}</h1>
<p>${en ? "Give this link to your agent for the complete MCP tool catalog, field reference and requirement/bug publishing workflow. The guide is readable without signing in or running JavaScript." : "把这个链接发给 Agent，了解全部 MCP 工具、字段规则，以及需求和 Bug 的完整发布流程。指南无需登录，也无需运行 JavaScript 即可读取。"}</p>
<div class="actions"><a class="primary" href="/skills/SKILL.md${en ? "?lang=en" : ""}" download="SKILL.md">${en ? "Download SKILL.md" : "下载 SKILL.md"}</a><a href="#install">${en ? "Installation prompt" : "发给 Agent 的安装提示词"}</a></div>
<h2 id="install">${en ? "Install the skill" : "让 Agent 安装技能"}</h2><label for="install-prompt">${en ? "Send this prompt to your agent" : "将这段提示词发给 Agent"}</label><textarea id="install-prompt" readonly>${escapeHtml(prompt)}</textarea>
<p>${en ? "The agent needs access to this address and support for local skill files. A loopback address (127.0.0.1) works only for an agent on this machine; remote agents need the reachable deployment URL. Credentials are configured separately." : "Agent 需要能访问这个地址，并支持保存技能文件。127.0.0.1 仅适用于本机 Agent；远程 Agent 请使用它能访问的部署地址。访问凭据单独配置。"}</p></section>
<article aria-label="${en ? "Skill content" : "技能正文"}">${article}</article></main><footer>Web Coding · Streamable HTTP MCP</footer></body></html>`);
    });
}

module.exports = {registerSkillsRoutes};
