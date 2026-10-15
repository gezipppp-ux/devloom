const test = require("node:test");
const assert = require("node:assert/strict");
const { createWebServer } = require("../../src/http/server.cjs");

test("public skills guide serves complete HTML and installable Markdown without auth or SPA scripts", async t => {
  const server = createWebServer({ testIdentity: true, workspaces: { close: async () => {} },
    pageHandler: (_request, response) => response.writeHead(599).end("SPA must not handle skills") });
  const origin = await server.listen(0);
  t.after(() => server.close());
  for (const suffix of ["", "/", "?lang=en"]) {
    const response = await fetch(origin + "/skills" + suffix);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    assert.match(html, /create_upload_token/);
    assert.match(html, /WEB_CODING_UPLOAD_TOKEN/);
    assert.match(html, /create_issue/);
    assert.match(html, /get_request_result/);
    assert.match(html, /href="\/skills\/SKILL.md/);
    assert.doesNotMatch(html, /<script|id="app"|wc_mcp_|wc_upload_/);
    assert.ok(html.includes(origin + "/mcp"));
  }
  const file = await fetch(origin + "/skills/SKILL.md");
  const markdown = await file.text();
  assert.match(file.headers.get("content-type"), /text\/markdown/);
  assert.match(markdown, /^---\nname: web-coding-mcp\ndescription: .+\n---\n/);
  assert.match(markdown, /PDF、Office/);
  assert.match(markdown, /本地目录[\s\S]*绝对路径/);
  assert.match(markdown, /上传成功不代表内容已解析/);
  const negotiated = await fetch(origin + "/skills", { headers: { accept: "text/markdown" } });
  assert.equal(await negotiated.text(), markdown);
  assert.equal(negotiated.headers.get("vary"), "Accept");
  const english = await fetch(origin + "/skills/SKILL.md?lang=en");
  assert.match(await english.text(), /Connect and verify/);
  const theme = await fetch(origin + "/skills/theme.css");
  assert.equal(theme.status, 200);
  assert.match(theme.headers.get("content-type"), /text\/css/);
  assert.match(await theme.text(), /--font-ui/);
});
