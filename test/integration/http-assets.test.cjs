const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createWebServer } = require("../../src/http/server.cjs");
const { temporary, png } = require("../support/helpers.cjs");
const { pageLocations } = require("../fixtures/page-routes.cjs");

async function serve(t, staticDirectory) {
  const application = createWebServer({ testIdentity: true,
    staticDirectory,
    workspaces: { close: async () => {} },
  });
  const origin = await application.listen(0);
  t.after(() => application.close());
  return origin;
}

test("production serves the entry page for direct application and detail links", async (t) => {
  const directory = temporary(t);
  const html = "<!doctype html><html><body><div id=\"app\"></div></body></html>";
  fs.writeFileSync(path.join(directory, "index.html"), html);
  const origin = await serve(t, directory);
  for (const location of pageLocations) {
    const response = await fetch(origin + location);
    assert.equal(response.status, 200, location);
    assert.match(response.headers.get("content-type"), /text\/html/, location);
    assert.equal(await response.text(), html, location);
    assert.equal(response.url, origin + location, "the detail URL must remain intact");
  }
  for (const location of ["/missing", "/assets/missing.js", "/api/missing", "/mcp"]) {
    const response = await fetch(origin + location);
    assert.equal(response.status, 404, location);
    assert.doesNotMatch(response.headers.get("content-type"), /text\/html/, location);
  }
  for (const location of ["/404", "/missing-page", "/projects/example/missing-page"]) {
    const response = await fetch(origin + location, { headers: { accept: "text/html" } });
    assert.equal(response.status, 404, location);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(await response.text(), html);
    assert.equal(response.url, origin + location);
  }
  for (const location of ["/assets/missing.js", "/api/missing", "/mcp", "/@fs/private", "/src/private"]) {
    const response = await fetch(origin + location, { headers: { accept: "text/html" } });
    assert.equal(response.status, 404, location);
    assert.doesNotMatch(response.headers.get("content-type"), /text\/html/, location);
  }
});

test("static assets preserve encoded Unicode and space paths and extension casing", async (t) => {
  const directory = temporary(t);
  const output = path.join(directory, "构建 输出");
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, "index.html"), "<h1>fixture</h1>");
  fs.writeFileSync(path.join(output, "预览 图片.PNG"), png);
  const origin = await serve(
    t,
    process.platform === "win32" ? path.toNamespacedPath(output) : output,
  );
  assert.equal(await (await fetch(origin)).text(), "<h1>fixture</h1>");
  const response = await fetch(
    `${origin}/${encodeURIComponent("预览 图片.PNG")}`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal((await fetch(`${origin}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
});

test("static paths cannot escape via encoded traversal or directory links on either platform", async (t) => {
  const directory = temporary(t);
  const output = path.join(directory, "dist");
  const privateDirectory = path.join(directory, "private");
  fs.mkdirSync(output);
  fs.mkdirSync(privateDirectory);
  fs.writeFileSync(path.join(output, "index.html"), "public");
  fs.writeFileSync(
    path.join(privateDirectory, "secret.json"),
    "private fixture",
  );
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(privateDirectory, path.join(output, "linked"), linkType);
  const linkedOutput = path.join(directory, "current");
  fs.symlinkSync(output, linkedOutput, linkType);
  // Deployments may point the static root itself at the current release.
  const origin = await serve(t, linkedOutput);
  assert.equal(await (await fetch(origin)).text(), "public");
  assert.equal((await fetch(`${origin}/linked/secret.json`)).status, 403);
  assert.equal(
    (await fetch(`${origin}/%2e%2e%2fprivate%2fsecret.json`)).status,
    403,
  );
  assert.notEqual(
    (await fetch(`${origin}/%2e%2e%5cprivate%5csecret.json`)).status,
    200,
  );
});
