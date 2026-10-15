const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const http = require("node:http");
const { unzipSync } = require("fflate");
const { createWebServer } = require("../../src/http/server.cjs");
const hash = data => createHash("sha256").update(data).digest("hex");

test("public skill serves a coherent complete package, linked references and no obsolete single-file routes", async t => {
  const server = createWebServer({ testIdentity: true, workspaces: { close: async () => {} },
    pageHandler: (_request, response) => response.writeHead(599).end("SPA must not handle skills") });
  const origin = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(origin + "/skills/web-coding-issue-authoring/manifest.json");
  const manifest = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.equal(manifest.name, "web-coding-issue-authoring");
  assert.equal(manifest.manifestUrl, response.url);
  const archiveResponse = await fetch(manifest.packageUrl);
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  assert.equal(archiveResponse.headers.get("content-type"), "application/zip");
  assert.equal(hash(archive), manifest.packageSha256);
  assert.equal(archive.length, manifest.packageSize);
  const unpacked = unzipSync(archive);
  assert.deepEqual(Object.keys(unpacked).sort(), manifest.files.map(file => manifest.name + "/" + file.path).sort());
  assert.ok(manifest.files.some(file => file.path === "scripts/update-skill.cjs"));
  for (const file of manifest.files) {
    assert.equal(new URL(file.url).origin, origin);
    const response = await fetch(file.url);
    const data = Buffer.from(await response.arrayBuffer());
    assert.match(response.headers.get("cache-control"), /immutable/);
    assert.equal(hash(data), file.sha256);
    assert.equal(data.length, file.size);
    assert.deepEqual(data, Buffer.from(unpacked[manifest.name + "/" + file.path]));
    assert.doesNotMatch(data.toString(), /192\.168\.0\.27|web-coding-mcp|metadata\.source/);
  }
  const entry = await (await fetch(manifest.entryUrl)).text();
  assert.match(entry, /^---\nname: web-coding-issue-authoring/);
  assert.match(entry, /页面改动，必须有原型附件/);
  assert.match(entry, /四个独立字段/);
  assert.equal(/^  version: "([^"]+)"$/m.exec(entry)[1], manifest.version);
  for (const suffix of ["", "/", "?lang=en"]) {
    const page = await fetch(origin + "/skills" + suffix);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /下载完整技能包/);
    assert.ok(html.includes(manifest.packageUrl));
    assert.ok(html.includes(manifest.manifestUrl));
    assert.doesNotMatch(html, /<script|id="app"|wc_mcp_|wc_upload_|English|web-coding-mcp/);
    for (const match of html.matchAll(/href="([^"]+\/references\/[^"]+)"/g))
      assert.equal((await fetch(match[1])).status, 200, "references remain readable from the guide");
  }
  assert.equal(await (await fetch(origin + "/skills", { headers: { accept: "text/markdown" } })).text(), entry);
  for (const removed of ["/skills/SKILL.md", "/skills/SKILL.md?lang=en", "/skills/web-coding-mcp/SKILL.md"])
    assert.equal((await fetch(origin + removed)).status, 404);
  assert.equal((await fetch(manifest.entryUrl.replace(manifest.version, "0.0.0"))).status, 404);
  assert.equal((await fetch(manifest.entryUrl.replace("SKILL.md", "missing.md"))).status, 404);
  const theme = await fetch(origin + "/skills/theme.css");
  assert.equal(theme.status, 200);
  assert.match(await theme.text(), /--font-ui/);
});

test("skill discovery uses validated public origins while the package is deployment-independent", async t => {
  const servers = [createWebServer({ testIdentity: true, workspaces: { close: async () => {} } }),
    createWebServer({ testIdentity: true, workspaces: { close: async () => {} }, publicOrigin: "https://skills.example.test" })];
  const manifests = [];
  for (const [index, server] of servers.entries()) {
    const origin = await server.listen(0);
    t.after(() => server.close());
    const headers = index ? { host: "skills.example.test", "x-forwarded-proto": "https" } : {};
    const response = await new Promise((resolve, reject) => {
      http.get(origin + "/skills/web-coding-issue-authoring/manifest.json", { headers }, reply => {
        const chunks = [];
        reply.on("data", chunk => chunks.push(chunk));
        reply.on("end", () => resolve({ status: reply.statusCode, data: JSON.parse(Buffer.concat(chunks)) }));
        reply.on("error", reject);
      }).on("error", reject);
    });
    assert.equal(response.status, 200);
    const manifest = response.data;
    assert.equal(new URL(manifest.manifestUrl).origin, index ? "https://skills.example.test" : origin);
    assert.ok(manifest.files.every(file => new URL(file.url).origin === new URL(manifest.manifestUrl).origin));
    manifests.push(manifest);
  }
  assert.equal(manifests[0].packageSha256, manifests[1].packageSha256);
});
