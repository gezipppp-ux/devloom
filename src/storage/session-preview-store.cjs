const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { TextDecoder } = require("node:util");
const { readOptional, writeConfig, updateConfig } = require("./json-files.cjs");
const { PREVIEW_ID, MAX_PREVIEW_BYTES, validatePreviewState, previewError } = require("../domain/session-preview.cjs");

const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 32);
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

class SessionPreviewStore {
  constructor(directory) {
    this.directory = path.join(directory, "previews");
    this.index = path.join(this.directory, "index.json");
  }

  async updateIndex(update) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await updateConfig(this.index, update); }
      catch (error) {
        if (error.code !== "P2034") throw error;
        if (attempt === 2) throw previewError("预览状态已更新，请重新载入后再调整。", 409);
      }
    }
  }

  async capture({ itemId, turnId, reference, ordinal, worktree, allowCapture = true }) {
    const id = hash(`${turnId || ""}\0${itemId}\0${ordinal}`);
    const known = (await readOptional(this.index)).entries?.find(entry => entry.id === id);
    if (known) return known;
    if (!allowCapture) throw previewError("此历史预览尚未保存，请重新生成。", 404);
    if (!worktree || !path.isAbsolute(reference.path) || !/\.html?$/i.test(reference.path))
      throw previewError("预览必须是当前任务内的 HTML 文件。");
    const rootInfo = await fs.lstat(worktree);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw previewError("预览不能使用符号链接。");
    const root = await fs.realpath(worktree);
    if (!inside(root, path.resolve(reference.path))) throw previewError("预览文件不在当前任务内。");
    const file = await fs.realpath(reference.path);
    if (!inside(root, file)) throw previewError("预览文件不在当前任务内。");
    // Reject symlinks/junctions in every component, including the source leaf.
    let current = root;
    for (const segment of path.relative(root, path.resolve(reference.path)).split(path.sep)) {
      current = path.join(current, segment);
      if ((await fs.lstat(current)).isSymbolicLink()) throw previewError("预览不能使用符号链接。");
    }
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let html;
    try {
      const info = await handle.stat();
      const currentInfo = await fs.stat(file);
      if (await fs.realpath(reference.path) !== file || currentInfo.dev !== info.dev || currentInfo.ino !== info.ino)
        throw previewError("预览文件在读取时发生变化，请重新生成。");
      if (!info.isFile() || info.size > MAX_PREVIEW_BYTES || info.nlink > 1)
        throw previewError("预览必须是小于 1 MiB 的独立 HTML 文件。");
      const data = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
      let size = 0;
      while (size < data.length) {
        const { bytesRead } = await handle.read(data, size, data.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_PREVIEW_BYTES) throw previewError("预览文件过大。");
      html = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, size));
    } finally { await handle.close(); }
    // Blob and registry commit use immutable content-addressed storage. A race
    // may leave an unreferenced document but cannot replace an accepted version.
    const digest = hash(html);
    await writeConfig(path.join(this.directory, `${digest}.html.json`), { html });
    const saved = await this.updateIndex(index => {
      const entries = index.entries || [];
      if (entries.some(entry => entry.id === id)) return index;
      if (entries.length >= 1000) throw previewError("此会话已达到预览数量上限。");
      const group = hash(path.relative(root, file));
      const version = entries.filter(entry => entry.group === group).length + 1;
      return { entries: [...entries, { id, group, version, digest,
        title: reference.title || path.basename(file), itemId, turnId: turnId || null,
        createdAt: new Date().toISOString(), revision: 0, state: { widget: null, controls: {} } }] };
    });
    return saved.entries.find(entry => entry.id === id);
  }

  async read(id) {
    if (!PREVIEW_ID.test(id || "")) throw previewError("无效的预览标识。");
    const index = await readOptional(this.index);
    const entry = index.entries?.find(entry => entry.id === id);
    if (!entry) throw previewError("预览不存在。", 404);
    const versions = index.entries.filter(value => value.group === entry.group);
    return { ...entry, versions, latest: versions.at(-1).id === id };
  }

  async content(id) {
    const entry = await this.read(id);
    const data = await readOptional(path.join(this.directory, `${entry.digest}.html.json`));
    if (typeof data.html !== "string" || hash(data.html) !== entry.digest)
      throw previewError("预览快照缺失或已损坏。", 404);
    return data.html;
  }

  async save(id, revision, state) {
    if (!PREVIEW_ID.test(id || "") || !Number.isSafeInteger(revision) || revision < 0)
      throw previewError("无效的预览修订号。");
    state = validatePreviewState(state);
    const index = await this.updateIndex(value => {
      const entry = value.entries?.find(item => item.id === id);
      if (!entry) throw previewError("预览不存在。", 404);
      if (value.entries.filter(item => item.group === entry.group).at(-1).id !== id)
        throw previewError("历史预览为只读，请切换到最新版本。", 409);
      if (entry.revision !== revision) throw previewError("预览状态已更新，请重新载入后再调整。", 409);
      entry.state = state;
      entry.revision++;
      entry.savedAt = new Date().toISOString();
      return value;
    });
    return index.entries.find(entry => entry.id === id);
  }
}
module.exports = { SessionPreviewStore };
