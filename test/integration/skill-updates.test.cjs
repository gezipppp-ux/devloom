const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const { temporary } = require("../support/helpers.cjs");
const { SkillPackageServices } = require("../../src/application/skill-package-services.cjs");
const { updateSkill } = require("../../resources/skills/web-coding-issue-authoring/scripts/update-skill.cjs");

async function fixture(t) {
  const directory = temporary(t), source = path.join(directory, "source");
  await fs.cp(path.resolve(__dirname, "../../resources/skills/web-coding-issue-authoring"), source, { recursive: true });
  const target = path.join(directory, "installed/web-coding-issue-authoring");
  let service, origin, alter = value => value, broken = false, redirect = false;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push({ path: request.url, headers: request.headers });
    if (request.url.endsWith("manifest.json")) {
      if (redirect) return response.writeHead(302, { location: origin + "/elsewhere" }).end();
      return response.end(JSON.stringify(alter(await service.manifest(origin))));
    }
    const match = /\/releases\/([^/]+)\/([^/]+)\/(.+)$/.exec(request.url);
    const file = match && await service.file(match[1], match[2], match[3]);
    if (!file) return response.writeHead(404).end();
    response.end(broken && match[3] === "references/bugs.md" ? "corrupt" : file.data);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const manifestUrl = origin + "/skills/web-coding-issue-authoring/manifest.json";
  async function release(value, suffix = "") {
    const file = path.join(source, "SKILL.md");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace(/^  version: ".+"$/m, '  version: "' + value + '"'));
    if (suffix) await fs.appendFile(path.join(source, "references/bugs.md"), suffix);
    service = new SkillPackageServices(source);
  }
  await release("1.9.0");
  return { target, source, manifestUrl, requests, release, run: () => updateSkill({ source: manifestUrl, directory: target }),
    corrupt: value => { broken = value; }, redirect: value => { redirect = value; }, alter: callback => { alter = callback; } };
}

test("standalone installer installs complete releases, updates numerically and keeps current versions untouched", async t => {
  const f = await fixture(t);
  const script = path.join(f.source, "scripts/update-skill.cjs");
  const installed = await promisify(execFile)(process.execPath, [script, "--source", f.manifestUrl, "--directory", f.target]);
  assert.equal(JSON.parse(installed.stdout).status, "installed");
  const record = () => fs.readFile(path.join(f.target, ".installation.json"), "utf8").then(JSON.parse);
  for (const file of (await record()).files) assert.ok((await fs.stat(path.join(f.target, file.path))).isFile());
  const before = (await fs.stat(path.join(f.target, "SKILL.md"))).mtimeMs;
  assert.equal((await f.run()).status, "current");
  assert.equal((await fs.stat(path.join(f.target, "SKILL.md"))).mtimeMs, before);
  await f.release("1.10.0", "\n新版本说明。\n");
  assert.equal((await f.run()).status, "updated");
  assert.equal((await record()).version, "1.10.0");
  assert.match(await fs.readFile(path.join(f.target, "references/bugs.md"), "utf8"), /新版本说明/);
  await f.release("1.9.0");
  assert.equal((await f.run()).status, "remote-older");
  assert.equal((await record()).version, "1.10.0");
  assert.ok(f.requests.every(request => !request.headers.authorization && !request.headers.cookie));
  assert.ok(f.requests.every(request => request.headers["cache-control"] === "no-cache"));
});

test("failed downloads, local edits, republished versions and failed switches preserve the installed package", async t => {
  const f = await fixture(t);
  await f.run();
  const entry = await fs.readFile(path.join(f.target, "SKILL.md"));
  const record = await fs.readFile(path.join(f.target, ".installation.json"));
  await f.release("1.9.0", "\n同版本修改\n");
  await assert.rejects(f.run(), /同一版本/);
  await f.release("1.10.0");
  f.corrupt(true);
  await assert.rejects(f.run(), /校验失败/);
  assert.deepEqual(await fs.readFile(path.join(f.target, "SKILL.md")), entry);
  assert.deepEqual(await fs.readFile(path.join(f.target, ".installation.json")), record);
  f.corrupt(false);
  const rename = fs.rename;
  const mocked = t.mock.method(fs, "rename", async (from, to) => {
    if (path.basename(from).includes(".stage-") && to === f.target) throw new Error("模拟目录切换失败");
    return rename(from, to);
  });
  await assert.rejects(f.run(), /模拟目录切换失败/);
  mocked.mock.restore();
  assert.deepEqual(await fs.readFile(path.join(f.target, "SKILL.md")), entry);
  assert.deepEqual(await fs.readFile(path.join(f.target, ".installation.json")), record);
  await fs.appendFile(path.join(f.target, "references/bugs.md"), "本地编辑");
  await assert.rejects(f.run(), /本地技能文件已修改/);
  assert.match(await fs.readFile(path.join(f.target, "references/bugs.md"), "utf8"), /本地编辑$/);
});

test("updater rejects escaping paths, cross-origin files, redirects, missing references and concurrent writers", async t => {
  const f = await fixture(t);
  f.alter(manifest => ({ ...manifest, files: [{ ...manifest.files[0], path: "../outside.md" }, ...manifest.files.slice(1)] }));
  await assert.rejects(f.run(), /路径无效/);
  f.alter(manifest => ({ ...manifest, files: [{ ...manifest.files[0], url: "https://example.invalid/file" }, ...manifest.files.slice(1)] }));
  await assert.rejects(f.run(), /文件清单无效/);
  f.alter(manifest => manifest);
  f.redirect(true);
  await assert.rejects(f.run(), /fetch failed/);
  assert.ok(!f.requests.some(request => request.path === "/elsewhere"));
  f.redirect(false);
  f.alter(manifest => ({ ...manifest, files: manifest.files.filter(file => file.path !== "references/bugs.md") }));
  await assert.rejects(f.run(), /引用文件缺失/);
  f.alter(manifest => manifest);
  const lock = path.join(path.dirname(f.target), ".web-coding-issue-authoring.update.lock");
  await fs.writeFile(lock, "another updater");
  await assert.rejects(f.run(), /更新锁已存在/);
  assert.equal(await fs.readFile(lock, "utf8"), "another updater");
  await fs.unlink(lock);
  assert.equal((await f.run()).status, "installed");
});
