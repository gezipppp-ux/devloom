const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { databaseForPath } = require("./database-registry.cjs");

function missing(file) {
  return Object.assign(new Error(`保存的资料不存在：${path.basename(file)}`), { code: "ENOENT" });
}

function artifactKey(database, file) {
  return path.relative(database.dataRoot, path.resolve(file)).split(path.sep).join("/");
}

// Database blobs are authoritative; files in the data root are disposable inputs
// for external processes. Never follow a cache symlink outside that root.
function materializeArtifact(file) {
  const database = databaseForPath(file);
  if (!database) return file;
  const blob = database.readBlob(file);
  if (!blob) throw missing(file);
  const relative = path.relative(database.dataRoot, path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("资料路径不属于数据目录。");
  let current = database.dataRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("资料缓存不能使用符号链接。");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (digest === createHash("sha256").update(blob.data).digest("hex")) return file;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, blob.data, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return file;
}

function writeArtifact(file, data, options = {}) {
  const database = databaseForPath(file);
  if (database) {
    database.putBlob(file, Buffer.isBuffer(data) ? data : Buffer.from(data), options);
    if (options.materialize) materializeArtifact(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, { mode: 0o600 });
}

function appendArtifact(file, data) {
  const database = databaseForPath(file);
  if (!database) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, data, { mode: 0o600 });
    return;
  }
  database.handle.prepare("INSERT INTO log_chunks(path,data,created_at) VALUES (?,?,?)")
    .run(artifactKey(database, file), Buffer.isBuffer(data) ? data : Buffer.from(data), new Date().toISOString());
}

module.exports = { writeArtifact, materializeArtifact, appendArtifact };
