const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { RUN_KEY } = require("../domain/run-identity.cjs");
const { readOptional, writeConfig, updateConfig } = require("./json-files.cjs");
const { readState, updateState } = require("./run-state.cjs");
const { MessageImageStore } = require("./message-image-store.cjs");
const { databaseForPath } = require("./database-registry.cjs");
const { writeArtifact, materializeArtifact, appendArtifact } = require("./artifact-store.cjs");
const { SessionHistoryStore } = require("./session-history-store.cjs");
const { RunRequirementsStore } = require("./run-requirements-store.cjs");
const { validateSessionTitle } = require("../domain/session-title.cjs");
const { REQUEST_ID } = require("../domain/requirement-fusion.cjs");
const { SessionPreviewStore } = require("./session-preview-store.cjs");

class RunStore {
  previews(key) { return new SessionPreviewStore(this.dir(key)); }

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

  async read(key) {
    return (await readState(path.join(this.dir(key), "run.json")));
  }

  async hasRun(key) {
    if (this.database) return (await this.database.readDocument(path.join(this.dir(key), "run.json"))) !== undefined;
    return fs.existsSync(path.join(this.dir(key), "run.json"));
  }

  isExecutionLocked(key) {
    return fs.existsSync(path.join(this.dir(key), ".lock"));
  }

  async update(key, patch) {
    return (await updateState(path.join(this.dir(key), "run.json"), patch));
  }

  async writeFinal(key, text) {
    (await writeArtifact(path.join(this.dir(key), "final.md"), text, { mimeType: "text/markdown" }));
  }

  async list() {
    if (this.database) return (await this.database.listDocuments(this.directory))
      .filter(({ path: file }) => path.basename(file) === "run.json")
      .map(({ path: file, value }) => ({ key: path.basename(path.dirname(file)), state: value }));
    if (!fs.existsSync(this.directory)) return [];
    return (await Promise.all(fs
      .readdirSync(this.directory)
      .filter((key) => RUN_KEY.test(key))
      .flatMap(async (key) => {
        try {
          return [{ key, state: (await this.read(key)) }];
        } catch {
          return [];
        }
      }))).flat();
  }

  async readSessionTitle(key, fallback) {
    const saved = (await readOptional(path.join(this.dir(key), "session-title.json")));
    return typeof saved.title === "string" && saved.title.trim() ? saved.title : fallback;
  }

  async writeSessionTitle(key, title) {
    const value = { title: validateSessionTitle(title) };
    (await writeConfig(path.join(this.dir(key), "session-title.json"), value));
    return value.title;
  }

  async isArchived(key) {
    return Boolean((await this.readArchive(key)).archivedAt);
  }

  async readArchive(key) {
    return (await readOptional(path.join(this.dir(key), "session-archive.json")));
  }

  async archive(key) {
    const archivedAt = new Date().toISOString();
    (await writeConfig(path.join(this.dir(key), "session-archive.json"), { archivedAt }));
    return { archivedAt };
  }

  async restore(key) {
    (await writeConfig(path.join(this.dir(key), "session-archive.json"), { archivedAt: null }));
    return { archivedAt: null };
  }

  async deleteRun(key) {
    const directory = this.dir(key);
    (await this.read(key));
    this.release(key);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    return this.database ? (await this.database.deleteRunDirectory(directory)) : true;
  }

  async readExecutionSettings(key) {
    return (await readOptional(path.join(this.dir(key), "execution-settings.json")));
  }

  async readWorktreeDeletion(key) {
    return (await readOptional(path.join(this.dir(key), "worktree-deletion.json")));
  }

  async writeWorktreeDeletion(key, value) {
    (await writeConfig(path.join(this.dir(key), "worktree-deletion.json"), value));
  }

  async writeExecutionSettings(key, settings) {
    (await writeConfig(path.join(this.dir(key), "execution-settings.json"), settings));
  }

  async updateExecutionSettings(key, update) {
    return updateConfig(path.join(this.dir(key), "execution-settings.json"), update);
  }

  async writeWeb(key, data) {
    (await writeConfig(path.join(this.dir(key), "web-session.json"), data));
  }

  async readWeb(key) {
    if (this.database) return (await readOptional(path.join(this.dir(key), "web-session.json")));
    try {
      return JSON.parse(
        fs.readFileSync(path.join(this.dir(key), "web-session.json"), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  async log(key, event) {
    (await appendArtifact(
      path.join(this.dir(key), "web-events.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    ));
  }

  async saveHistoryItem(key, item) {
    (await new SessionHistoryStore(this.dir(key)).save(item));
  }

  async recordNotification(key, notification) {
    if (this.database) (await appendArtifact(path.join(this.dir(key), "agent-events.jsonl"),
      `${JSON.stringify(notification)}\n`));
  }

  async savedHistory(key, cursor) {
    return (await new SessionHistoryStore(this.dir(key)).list(cursor));
  }

  async historyItemIdsBefore(key, itemIds, beforeId) {
    return (await new SessionHistoryStore(this.dir(key)).idsBefore(itemIds, beforeId));
  }

  async reconcileHistory(key, items, startedAt) {
    (await new SessionHistoryStore(this.dir(key)).reconcile(items, startedAt));
  }

  taskFile(key) {
    return path.join(this.dir(key), "requirement.json");
  }

  async readTask(key) {
    if (this.database) {
      const value = (await this.database.readDocument(this.taskFile(key)));
      if (!value) throw Object.assign(new Error("任务资料不存在。"), { code: "ENOENT" });
      return value;
    }
    return JSON.parse(fs.readFileSync(this.taskFile(key), "utf8"));
  }

  async imagePath(key, index) {
    if (!/^\d+$/.test(index)) throw new Error("无效的图片编号");
    const task = (await this.readTask(key));
    return (await this.taskImagePath(key, task, index));
  }

  additionDirectory(key, id) {
    if (!REQUEST_ID.test(id)) throw new Error("追加资料标识无效。");
    return path.join(this.dir(key), "additions", id);
  }

  async additionImagePath(key, id, index) {
    this.additionDirectory(key, id);
    if (!/^\d+$/.test(index)) throw new Error("无效的图片编号。");
    const task = (await this.requirements.read(key)).additions?.find(entry => entry.id === id)?.task;
    if (!task) throw new Error("追加资料不存在。");
    return (await this.taskImagePath(key, task, index));
  }

  async additionMessageImages(key, id) {
    const addition = (await this.requirements.read(key)).additions?.find(entry => entry.id === id);
    if (!addition) throw new Error("追加资料不存在。");
    const images = (await this.messageImages(key));
    const ids = addition.messageImageIds || [];
    if (!addition.messageImageIds) {
      // Each save updates the same image index; parallel transactions can
      // conflict or overwrite membership in explicit file fixtures.
      for (const index of addition.task.images.keys()) {
        const file = await this.additionImagePath(key, id, String(index));
        ids.push((await images.save(fs.readFileSync(file))).id);
      }
    }
    if (!addition.messageImageIds)
      (await this.requirements.updateAddition(key, id, () => ({ messageImageIds: ids })));
    return (await Promise.all(ids.map(async imageId => (await images.read(imageId)))));
  }

  async taskImagePath(key, task, index) {
    if (this.database) {
      const recorded = task.images?.[Number(index)]?.path;
      if (!recorded) throw Object.assign(new Error("任务图片不存在。"), { code: "ENOENT" });
      const relative = path.relative(this.dir(key), recorded);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("图片不属于当前任务。");
      return (await materializeArtifact(recorded));
    }
    const file = fs.realpathSync.native(task.images?.[Number(index)]?.path || "");
    const root = fs.realpathSync.native(this.dir(key));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("图片不属于当前任务");
    return file;
  }

  async messageImages(key) {
    (await this.read(key));
    return new MessageImageStore(this.dir(key));
  }
}

module.exports = { RunStore };
