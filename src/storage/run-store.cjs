const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { RUN_KEY } = require("../domain/run-identity.cjs");
const { normalizeItem } = require("../domain/session-item.cjs");
const { readOptional, writeConfig, updateConfig } = require("./json-files.cjs");
const { readState, updateState } = require("./run-state.cjs");
const { MessageImageStore } = require("./message-image-store.cjs");
const { databaseForPath } = require("./database-registry.cjs");
const { writeArtifact, materializeArtifact, appendArtifact } = require("./artifact-store.cjs");
const { SessionHistoryStore } = require("./session-history-store.cjs");
const { RunRequirementsStore } = require("./run-requirements-store.cjs");
const {
  defaultTaskMetadata,
  validateTaskMetadata,
} = require("../domain/task-metadata.cjs");
const { validateSessionTitle } = require("../domain/session-title.cjs");
const { REQUEST_ID } = require("../domain/requirement-fusion.cjs");

class RunStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.owned = new Set();
    this.ownerToken = randomUUID();
    this.database = databaseForPath(this.directory);
    this.requirements = new RunRequirementsStore(this.directory);
  }

  claim(key) {
    if (this.owned.has(key)) return;
    const file = path.join(this.dir(key), "web-owner.json");
    const recovery = path.join(this.dir(key), "web-owner-recovery");
    fs.mkdirSync(this.dir(key), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(
          file,
          JSON.stringify({ pid: process.pid, token: this.ownerToken }),
          {
            flag: "wx",
            mode: 0o600,
          },
        );
        this.owned.add(key);
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          fs.mkdirSync(recovery);
        } catch (lockError) {
          if (lockError.code !== "EEXIST") throw lockError;
          throw new Error(
            "会话所有权正在检查。请稍后重试；若原服务异常退出，请确认其已停止后检查 web-owner-recovery。",
          );
        }
        try {
          // Re-read only while holding the recovery guard. A stale snapshot
          // must never authorize unlinking a different claimant's new owner.
          let owner;
          try {
            owner = JSON.parse(fs.readFileSync(file, "utf8"));
          } catch (readError) {
            if (readError.code === "ENOENT") continue;
            throw readError;
          }
          if (!Number.isInteger(owner.pid) || owner.pid <= 0)
            throw new Error("会话所有权记录无效，请检查 web-owner.json。");
          try {
            process.kill(owner.pid, 0);
          } catch (probe) {
            if (probe.code === "ESRCH") {
              fs.unlinkSync(file);
              continue;
            }
          }
          throw new Error("该 session 已由另一个 Web CLI 服务持有。");
        } finally {
          fs.rmdirSync(recovery);
        }
      }
    }
    throw new Error("会话所有权发生变化，请刷新后重试。");
  }

  releaseAll() {
    for (const key of [...this.owned]) this.release(key);
  }

  release(key) {
    if (!this.owned.has(key)) return;
    {
      const file = path.join(this.dir(key), "web-owner.json");
      try {
        const owner = JSON.parse(fs.readFileSync(file, "utf8"));
        if (owner.pid === process.pid && owner.token === this.ownerToken)
          fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    this.owned.delete(key);
  }

  dir(key) {
    if (!RUN_KEY.test(key)) throw new Error("无效的任务标识。");
    return path.join(this.directory, key);
  }

  read(key) {
    return readState(path.join(this.dir(key), "run.json"));
  }

  hasRun(key) {
    if (this.database) return this.database.readDocument(path.join(this.dir(key), "run.json")) !== undefined;
    return fs.existsSync(path.join(this.dir(key), "run.json"));
  }

  isExecutionLocked(key) {
    return fs.existsSync(path.join(this.dir(key), ".lock"));
  }

  update(key, patch) {
    return updateState(path.join(this.dir(key), "run.json"), patch);
  }

  writeFinal(key, text) {
    writeArtifact(path.join(this.dir(key), "final.md"), text, { mimeType: "text/markdown" });
  }

  list() {
    if (this.database) return this.database.listDocuments(this.directory)
      .filter(({ path: file }) => path.basename(file) === "run.json")
      .map(({ path: file, value }) => ({ key: path.basename(path.dirname(file)), state: value }));
    if (!fs.existsSync(this.directory)) return [];
    return fs
      .readdirSync(this.directory)
      .filter((key) => RUN_KEY.test(key))
      .flatMap((key) => {
        try {
          return [{ key, state: this.read(key) }];
        } catch {
          return [];
        }
      });
  }

  readTaskMetadata(key, item) {
    const saved = readOptional(path.join(this.dir(key), "task-metadata.json"));
    return validateTaskMetadata(saved, defaultTaskMetadata(item));
  }

  writeTaskMetadata(key, input, item) {
    return updateConfig(path.join(this.dir(key), "task-metadata.json"), (saved) =>
      validateTaskMetadata(input, validateTaskMetadata(saved, defaultTaskMetadata(item))),
    );
  }

  readSessionTitle(key, fallback) {
    const saved = readOptional(path.join(this.dir(key), "session-title.json"));
    return typeof saved.title === "string" && saved.title.trim() ? saved.title : fallback;
  }

  writeSessionTitle(key, title) {
    const value = { title: validateSessionTitle(title) };
    writeConfig(path.join(this.dir(key), "session-title.json"), value);
    return value.title;
  }

  isArchived(key) {
    return Boolean(this.readArchive(key).archivedAt);
  }

  readArchive(key) {
    return readOptional(path.join(this.dir(key), "session-archive.json"));
  }

  archive(key) {
    const archivedAt = new Date().toISOString();
    writeConfig(path.join(this.dir(key), "session-archive.json"), { archivedAt });
    return { archivedAt };
  }

  restore(key) {
    writeConfig(path.join(this.dir(key), "session-archive.json"), { archivedAt: null });
    return { archivedAt: null };
  }

  deleteRun(key) {
    const directory = this.dir(key);
    this.read(key);
    this.release(key);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    return this.database ? this.database.deleteRunDirectory(directory) : true;
  }

  readExecutionSettings(key) {
    return readOptional(path.join(this.dir(key), "execution-settings.json"));
  }

  readWorktreeDeletion(key) {
    return readOptional(path.join(this.dir(key), "worktree-deletion.json"));
  }

  writeWorktreeDeletion(key, value) {
    writeConfig(path.join(this.dir(key), "worktree-deletion.json"), value);
  }

  writeExecutionSettings(key, settings) {
    writeConfig(path.join(this.dir(key), "execution-settings.json"), settings);
  }

  legacyHistory(key) {
    if (this.database) return this.savedHistory(key).items;
    const file = path.join(this.dir(key), "events.jsonl");
    if (!fs.existsSync(file)) return [];
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - 2 * 1024 * 1024);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      const lines = buffer.toString("utf8").split("\n");
      if (start) lines.shift();
      return lines
        .flatMap((line) => {
          try {
            const event = JSON.parse(line);
            return event.type === "item.completed" && event.item
              ? [normalizeItem(event.item)]
              : [];
          } catch {
            return [];
          }
        })
        .slice(-100);
    } finally {
      fs.closeSync(fd);
    }
  }

  writeWeb(key, data) {
    writeConfig(path.join(this.dir(key), "web-session.json"), data);
  }

  readWeb(key) {
    if (this.database) return readOptional(path.join(this.dir(key), "web-session.json"));
    try {
      return JSON.parse(
        fs.readFileSync(path.join(this.dir(key), "web-session.json"), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  log(key, event) {
    appendArtifact(
      path.join(this.dir(key), "web-events.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    );
  }

  saveHistoryItem(key, item) {
    new SessionHistoryStore(this.dir(key)).save(item);
  }

  recordNotification(key, notification) {
    if (this.database) appendArtifact(path.join(this.dir(key), "codex-events.jsonl"),
      `${JSON.stringify(notification)}\n`);
  }

  savedHistory(key, cursor) {
    return new SessionHistoryStore(this.dir(key)).list(cursor);
  }

  historyItemIdsBefore(key, itemIds, beforeId) {
    return new SessionHistoryStore(this.dir(key)).idsBefore(itemIds, beforeId);
  }

  reconcileHistory(key, items, startedAt) {
    new SessionHistoryStore(this.dir(key)).reconcile(items, startedAt);
  }

  taskFile(key) {
    const current = path.join(this.dir(key), "requirement.json");
    if (this.database) return current;
    return fs.existsSync(current)
      ? current
      : path.join(this.dir(key), "tapd-task.json");
  }

  readTask(key) {
    if (this.database) {
      const value = this.database.readDocument(this.taskFile(key));
      if (!value) throw Object.assign(new Error("任务资料不存在。"), { code: "ENOENT" });
      return value;
    }
    return JSON.parse(fs.readFileSync(this.taskFile(key), "utf8"));
  }

  imagePath(key, index) {
    if (!/^\d+$/.test(index)) throw new Error("无效的图片编号");
    const task = this.readTask(key);
    return this.taskImagePath(key, task, index);
  }

  additionDirectory(key, id) {
    if (!REQUEST_ID.test(id)) throw new Error("追加资料标识无效。");
    return path.join(this.dir(key), "additions", id);
  }

  additionImagePath(key, id, index) {
    this.additionDirectory(key, id);
    if (!/^\d+$/.test(index)) throw new Error("无效的图片编号。");
    const task = this.requirements.read(key).additions?.find(entry => entry.id === id)?.task;
    if (!task) throw new Error("追加资料不存在。");
    return this.taskImagePath(key, task, index);
  }

  additionMessageImages(key, id) {
    const addition = this.requirements.read(key).additions?.find(entry => entry.id === id);
    if (!addition) throw new Error("追加资料不存在。");
    const images = this.messageImages(key);
    const ids = addition.messageImageIds || addition.task.images.map((_, index) =>
      images.save(fs.readFileSync(this.additionImagePath(key, id, String(index)))).id);
    if (!addition.messageImageIds)
      this.requirements.updateAddition(key, id, () => ({ messageImageIds: ids }));
    return ids.map(imageId => images.read(imageId));
  }

  taskImagePath(key, task, index) {
    if (this.database) {
      const recorded = task.images?.[Number(index)]?.path;
      if (!recorded) throw Object.assign(new Error("任务图片不存在。"), { code: "ENOENT" });
      const relative = path.relative(this.dir(key), recorded);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("图片不属于当前任务。");
      return materializeArtifact(recorded);
    }
    const file = fs.realpathSync.native(task.images?.[Number(index)]?.path || "");
    const root = fs.realpathSync.native(this.dir(key));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("图片不属于当前任务");
    return file;
  }

  messageImages(key) {
    this.read(key);
    return new MessageImageStore(this.dir(key));
  }
}

module.exports = { RunStore };
