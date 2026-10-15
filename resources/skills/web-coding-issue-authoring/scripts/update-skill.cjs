// Standalone updater: Node.js 22.13+, no third-party dependencies or credentials.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const NAME = "web-coding-issue-authoring";
const RECORD = ".installation.json";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const version = value => {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error("技能版本无效。");
  const parts = value.split(".").map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error("技能版本超出范围。");
  return parts;
};
const compare = (left, right) => {
  const a = version(left), b = version(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
};
function safePath(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9./-]*$/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === ".." || part.endsWith(".") ||
        /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)))
    throw new Error("技能文件路径无效。");
  return value;
}
function sourceUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/skills/" + NAME + "/manifest.json") throw new Error("技能来源地址无效。");
  return url;
}
async function download(url, maximum) {
  const response = await fetch(url, { redirect: "error", credentials: "omit", headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("技能下载失败，HTTP " + response.status + "。");
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maximum) throw new Error("技能下载超过大小限制。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function validateManifest(manifest, source) {
  if (manifest.schemaVersion !== 1 || manifest.name !== NAME || manifest.manifestUrl !== source.href ||
      !/^[a-f0-9]{64}$/.test(manifest.packageSha256) || !Array.isArray(manifest.files) ||
      !manifest.files.length || manifest.files.length > 100) throw new Error("技能清单无效或来源不符。");
  version(manifest.version);
  const prefix = source.origin + "/skills/" + NAME + "/releases/" + manifest.version + "/" + manifest.packageSha256 + "/";
  if (manifest.entryUrl !== prefix + "SKILL.md" || manifest.packageUrl !== prefix + "package.zip")
    throw new Error("技能下载地址与来源不符。");
  const names = new Set(); let size = 0;
  for (const file of manifest.files) {
    safePath(file.path);
    if (names.has(file.path.toLowerCase()) || file.url !== prefix + file.path || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 2 * 1024 * 1024)
      throw new Error("技能文件清单无效。");
    names.add(file.path.toLowerCase()); size += file.size;
  }
  if (size > 10 * 1024 * 1024 || !manifest.files.some(file => file.path === "SKILL.md"))
    throw new Error("技能文件不完整或超过大小限制。");
}
async function inspect(directory, prefix = "") {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error("技能目录包含符号链接，已保留原内容。");
    if (entry.isDirectory()) result.push(...await inspect(path.join(directory, entry.name), relative + "/"));
    else if (entry.isFile()) result.push(relative);
    else throw new Error("技能目录包含非普通文件。");
  }
  return result;
}
async function verifyInstalled(directory, source) {
  let stat;
  try { stat = await fs.lstat(directory); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("目标必须为普通技能目录。");
  const contents = await inspect(directory);
  if (!contents.includes(RECORD)) throw new Error("现有目录没有安装记录，已保留内容；请选择尚不存在的安装目录。");
  const record = JSON.parse(await fs.readFile(path.join(directory, RECORD), "utf8"));
  if (record.source !== source.href || record.name !== NAME || !Array.isArray(record.files))
    throw new Error("安装来源不一致，已保留原内容。");
  version(record.version);
  if (contents.length !== record.files.length + 1) throw new Error("本地技能文件已增删，更新已停止。");
  for (const file of record.files) {
    safePath(file.path);
    if (!contents.includes(file.path) || hash(await fs.readFile(path.join(directory, file.path))) !== file.sha256)
      throw new Error("本地技能文件已修改，更新已停止：" + file.path);
  }
  return record;
}
async function verifyReferences(directory, files, expectedVersion) {
  const entry = await fs.readFile(path.join(directory, "SKILL.md"), "utf8");
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entry)?.[1] || "";
  if (!new RegExp("^name: " + NAME + "$", "m").test(header) ||
      /^  version: "([^"]+)"$/m.exec(header)?.[1] !== expectedVersion) throw new Error("技能入口与清单不一致。");
  for (const file of files.filter(file => file.path.endsWith(".md"))) {
    const text = await fs.readFile(path.join(directory, file.path), "utf8");
    for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
      const href = match[1].split("#")[0];
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), href));
      if (!files.some(candidate => candidate.path === target)) throw new Error("技能引用文件缺失：" + target);
    }
  }
}
async function updateSkill({ source: value, directory }) {
  const source = sourceUrl(value);
  if (!path.isAbsolute(directory) || path.basename(directory) !== NAME) throw new Error("请提供以技能名称结尾的绝对安装目录。");
  const requestedParent = path.dirname(directory);
  await fs.mkdir(requestedParent, { recursive: true });
  const parent = await fs.realpath(requestedParent), target = path.join(parent, NAME);
  const lockPath = path.join(parent, "." + NAME + ".update.lock");
  const lock = await fs.open(lockPath, "wx").catch(error => {
    if (error.code === "EEXIST") throw new Error("技能更新锁已存在；先确认是否仍有更新进程，保留现有目录与备份。");
    throw error;
  });
  let staging, backup, switched = false;
  const cleanup = async owned => {
    if (path.dirname(owned) !== parent || !path.basename(owned).startsWith("." + NAME + "."))
      throw new Error("拒绝清理技能目录之外的路径。");
    await fs.rm(owned, { recursive: true, force: true });
  };
  try {
    const current = await verifyInstalled(target, source);
    const manifest = JSON.parse((await download(source, 256 * 1024)).toString("utf8"));
    validateManifest(manifest, source);
    if (current) {
      const order = compare(manifest.version, current.version);
      if (order === 0 && (current.packageSha256 !== manifest.packageSha256 ||
          JSON.stringify(current.files) !== JSON.stringify(manifest.files.map(({ path: filePath, sha256 }) => ({ path: filePath, sha256 })))))
        throw new Error("同一版本的技能内容发生变化，请服务端发布新版本。");
      if (order <= 0) return { status: order === 0 ? "current" : "remote-older", version: current.version, directory: target };
    }
    staging = await fs.mkdtemp(path.join(parent, "." + NAME + ".stage-"));
    for (const file of manifest.files) {
      const data = await download(file.url, file.size);
      if (data.length !== file.size || hash(data) !== file.sha256) throw new Error("技能文件校验失败：" + file.path);
      const destination = path.join(staging, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, data, { flag: "wx" });
    }
    await verifyReferences(staging, manifest.files, manifest.version);
    await fs.writeFile(path.join(staging, RECORD), JSON.stringify({ name: NAME, source: source.href, version: manifest.version,
      packageSha256: manifest.packageSha256, files: manifest.files.map(({ path: filePath, sha256 }) => ({ path: filePath, sha256 })) }, null, 2) + "\n");
    // Detect edits made while the new release was downloading before touching the target.
    const latest = await verifyInstalled(target, source);
    if (JSON.stringify(latest) !== JSON.stringify(current)) throw new Error("安装目录在更新过程中发生变化。");
    if (current) { backup = path.join(parent, "." + NAME + ".backup-" + randomUUID()); await fs.rename(target, backup); }
    try { await fs.rename(staging, target); staging = null; switched = true; }
    catch (error) { if (backup) { await fs.rename(backup, target); backup = null; } throw error; }
    const result = { status: current ? "updated" : "installed", version: manifest.version, directory: target };
    if (backup) {
      try { await cleanup(backup); backup = null; }
      catch { result.backupDirectory = backup; }
    }
    return result;
  } finally {
    // A failed rollback leaves the backup intact for recovery.
    try { if (staging) await cleanup(staging); }
    finally { await lock.close(); await fs.unlink(lockPath); }
    if (backup && !switched) console.error("原技能备份保留于：" + backup);
  }
}
async function main(args) {
  if (args.length !== 4 || args[0] !== "--source" || args[2] !== "--directory")
    throw new Error("用法：node update-skill.cjs --source <清单URL> --directory <技能目录绝对路径>");
  return updateSkill({ source: args[1], directory: args[3] });
}
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { updateSkill };
