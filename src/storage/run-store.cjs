const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { RUN_KEY } = require("../domain/run-identity.cjs");
const { normalizeItem } = require("../domain/session-item.cjs");
const { readOptional, writeConfig, updateConfig } = require("./json-files.cjs");
const { updateState } = require("./run-state.cjs");
const {
  defaultTaskMetadata,
  validateTaskMetadata,
} = require("../domain/task-metadata.cjs");

class RunStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.owned = new Set();
    this.ownerToken = randomUUID();
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
    for (const key of this.owned) {
      const file = path.join(this.dir(key), "web-owner.json");
      try {
        const owner = JSON.parse(fs.readFileSync(file, "utf8"));
        if (owner.pid === process.pid && owner.token === this.ownerToken)
          fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    this.owned.clear();
  }

  dir(key) {
    if (!RUN_KEY.test(key)) throw new Error("无效的任务标识。");
    return path.join(this.directory, key);
  }

  read(key) {
    return JSON.parse(
      fs.readFileSync(path.join(this.dir(key), "run.json"), "utf8"),
    );
  }

  hasRun(key) {
    return fs.existsSync(path.join(this.dir(key), "run.json"));
  }

  isExecutionLocked(key) {
    return fs.existsSync(path.join(this.dir(key), ".lock"));
  }

  update(key, patch) {
    return updateState(path.join(this.dir(key), "run.json"), patch);
  }

  writeFinal(key, text) {
    fs.writeFileSync(path.join(this.dir(key), "final.md"), text, {
      mode: 0o600,
    });
  }

  list() {
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

  readExecutionSettings(key) {
    return readOptional(path.join(this.dir(key), "execution-settings.json"));
  }

  writeExecutionSettings(key, settings) {
    writeConfig(path.join(this.dir(key), "execution-settings.json"), settings);
  }

  legacyHistory(key) {
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
    fs.mkdirSync(this.dir(key), { recursive: true });
    fs.appendFileSync(
      path.join(this.dir(key), "web-events.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
      { mode: 0o600 },
    );
  }

  taskFile(key) {
    const current = path.join(this.dir(key), "requirement.json");
    return fs.existsSync(current)
      ? current
      : path.join(this.dir(key), "tapd-task.json");
  }

  readTask(key) {
    return JSON.parse(fs.readFileSync(this.taskFile(key), "utf8"));
  }

  imagePath(key, index) {
    if (!/^\d+$/.test(index)) throw new Error("无效的图片编号");
    const task = this.readTask(key);
    const file = fs.realpathSync.native(task.images?.[Number(index)]?.path || "");
    const root = fs.realpathSync.native(this.dir(key));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("图片不属于当前任务");
    return file;
  }
}

module.exports = { RunStore };
