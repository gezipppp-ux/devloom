const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { structuredPatch } = require("diff");
const { gitAsync } = require("./command.cjs");
const { worktreeReason } = require("./worktree-access.cjs");
const { samePath } = require("../shared/paths.cjs");

const MAX_BYTES = 512 * 1024;
const MAX_FILES = 20000;
const MAX_LINES = 10000;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

async function query(tree, args, options = {}) {
  try {
    return await gitAsync(tree, ["--no-optional-locks", "--literal-pathspecs", ...args], {
      trim: false, timeout: 10000, maxBuffer: 4 * 1024 * 1024, ...options,
    });
  } catch {
    throw new Error("无法读取 Git 文件信息，请刷新后重试；仓库可能正在变化或超过读取限制。");
  }
}

function assertTree(state) {
  const reason = worktreeReason(state);
  if (reason) throw new Error(reason);
  const tree = path.resolve(state.worktree.path);
  // A replacement symlink/junction must not turn a recorded worktree into a file browser.
  for (let current = tree; ; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Worktree 路径含符号链接，不能读取文件。");
    if (path.dirname(current) === current) break;
  }
  return tree;
}

function relativeFile(tree, value) {
  if (typeof value !== "string" || !value || value.length > 4096 || /[\x00-\x1f]/.test(value))
    throw new Error("文件路径无效。");
  let file = value.replaceAll("\\", "/");
  if (path.isAbsolute(file)) file = path.relative(tree, file).replaceAll("\\", "/");
  file = file.replace(/^\.\//, "");
  if (!file || file.split("/").some((part) => !part || part === ".." || part === "." || part.toLowerCase() === ".git") || /[:]/.test(file))
    throw new Error("只能读取当前任务 Worktree 内的文件。");
  return file;
}

function currentFile(tree, relative) {
  let current = tree;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === "ENOENT") return { exists: false, text: "", reason: null }; throw error; }
    if (stat.isSymbolicLink()) throw new Error("不支持预览符号链接或目录链接。");
    if (index < parts.length - 1) {
      if (!stat.isDirectory()) throw new Error("文件路径已变化，请刷新后重试。");
      continue;
    }
    if (!stat.isFile()) return { exists: true, text: null, reason: "仅支持普通文本文件，不能预览目录或子模块。" };
    if (stat.size > MAX_BYTES) return { exists: true, text: null, reason: "文件超过 512 KiB，暂不支持预览和对比。" };
    const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino) throw new Error("文件已变化，请刷新后重试。");
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let size = 0, count;
      do { count = fs.readSync(fd, buffer, size, buffer.length - size, size); size += count; } while (count && size < buffer.length);
      const after = fs.fstatSync(fd);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("文件正在写入，请稍后刷新。");
      return decode(buffer.subarray(0, size));
    } finally { fs.closeSync(fd); }
  }
}

function decode(buffer) {
  let reason = null, text = null;
  if (buffer.length > MAX_BYTES) reason = "文件超过 512 KiB，暂不支持预览和对比。";
  else if (buffer.includes(0)) reason = "二进制文件暂不支持文本预览和对比。";
  else {
    try { text = utf8.decode(buffer); }
    catch { reason = "文件不是有效的 UTF-8 文本，暂不支持预览和对比。"; }
    if (text && text.split("\n").length > MAX_LINES) { text = null; reason = "文件超过 10000 行，暂不支持预览和对比。"; }
  }
  return { exists: true, text, reason };
}

async function context(state, scope) {
  if (!["task", "head"].includes(scope)) throw new Error("无效的比较范围。");
  const tree = assertTree(state);
  const head = (await query(tree, ["rev-parse", "--verify", "HEAD"])).trim();
  const ref = scope === "head" ? head : state.worktree.base_commit;
  let base = null, reason = null;
  if (!/^[a-f0-9]{40,64}$/i.test(ref || "")) reason = "此任务没有记录起始提交，请切换到未提交变更。";
  else {
    try { base = (await query(tree, ["rev-parse", "--verify", `${ref}^{commit}`])).trim(); }
    catch { reason = "比较提交已不可用，请切换比较范围或检查仓库。"; }
  }
  return { tree, head, base, reason, scope };
}

async function catalog(ctx) {
  const [working, original] = await Promise.all([
    query(ctx.tree, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
    ctx.base ? query(ctx.tree, ["ls-tree", "-r", "--name-only", "-z", ctx.base]) : "",
  ]);
  const files = [...new Set((working + original).split("\0").filter(Boolean))];
  if (files.length > MAX_FILES) throw new Error("仓库文件超过 20000 个，暂不支持文件定位。");
  return files;
}

async function changedFiles(ctx) {
  if (!ctx.base) return [];
  const [diff, untracked] = await Promise.all([
    query(ctx.tree, ["diff", "--name-status", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", ctx.base, "--"]),
    query(ctx.tree, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const parts = diff.split("\0");
  const files = [];
  for (let index = 0; parts[index];) {
    const status = parts[index++][0], first = parts[index++];
    files.push(status === "R" || status === "C"
      ? { path: parts[index++], previousPath: first, status }
      : { path: first, previousPath: null, status });
  }
  const existing = new Set(files.map((file) => file.path));
  for (const file of untracked.split("\0").filter(Boolean)) {
    if (!existing.has(file)) files.push({ path: file, previousPath: null, status: "A" });
  }
  if (files.length > MAX_FILES) throw new Error("变更文件过多，暂不支持列出。");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function originalFile(ctx, file) {
  if (!ctx.base) return { exists: false, text: null, reason: ctx.reason };
  const entry = await query(ctx.tree, ["ls-tree", "-l", "-z", ctx.base, "--", file]);
  if (!entry) return { exists: false, text: "", reason: null };
  const match = /^(\d+) (\w+) ([a-f0-9]+)\s+(\d+|-)\t/.exec(entry);
  if (!match || !["100644", "100755"].includes(match[1])) return { exists: true, text: null, reason: "比较版本不是普通文本文件。" };
  if (Number(match[4]) > MAX_BYTES) return { exists: true, text: null, reason: "比较版本超过 512 KiB，暂不支持对比。" };
  return decode(await query(ctx.tree, ["cat-file", "blob", match[3]], { encoding: null, maxBuffer: MAX_BYTES + 1 }));
}

async function verifySnapshot(state, ctx) {
  if (!samePath(assertTree(state), ctx.tree) || (await query(ctx.tree, ["rev-parse", "--verify", "HEAD"])).trim() !== ctx.head)
    throw new Error("Worktree 或当前提交已变化，请刷新后重试。");
}

async function listTaskFiles(state, scope = "task") {
  const ctx = await context(state, scope);
  if (ctx.reason) throw new Error(ctx.reason);
  const files = await changedFiles(ctx);
  await verifySnapshot(state, ctx);
  return { ...ctx, files };
}

async function readTaskFile(state, requested, scope = "task") {
  const ctx = await context(state, scope);
  const requestedPath = relativeFile(ctx.tree, requested);
  const [paths, changed] = await Promise.all([catalog(ctx), changedFiles(ctx)]);
  const equal = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  const basenameOnly = !requestedPath.includes("/") && !path.isAbsolute(requested.replaceAll("\\", "/")) && !requested.startsWith("./");
  const candidates = paths.filter((file) => equal(basenameOnly ? file.split("/").at(-1) : file, requestedPath));
  if (!candidates.length) throw new Error("未找到此文件；它可能已移动、被忽略或不属于当前任务。");
  if (candidates.length > 1) return { ...ctx, candidates: candidates.sort() };
  const file = relativeFile(ctx.tree, candidates[0]);
  const change = changed.find((entry) => equal(entry.path, file));
  const previousPath = change?.previousPath || file;
  relativeFile(ctx.tree, previousPath);
  const before = await originalFile(ctx, previousPath);
  // Read the working file after all asynchronous Git operations, from a verified path.
  await verifySnapshot(state, ctx);
  const current = currentFile(ctx.tree, file);
  let diff = null, reason = ctx.reason || current.reason || before.reason;
  if (!reason) {
    diff = structuredPatch(previousPath, file, before.text.replaceAll("\r\n", "\n"), current.text.replaceAll("\r\n", "\n"), "", "", { context: 3, timeout: 250, maxEditLength: 20000 });
    if (!diff) reason = "文件差异过大，暂不支持对比；仍可查看源码。";
  }
  return { ...ctx, file, previousPath, current, before, hunks: diff?.hunks || [], reason, status: change?.status || "unchanged" };
}

module.exports = { listTaskFiles, readTaskFile };
