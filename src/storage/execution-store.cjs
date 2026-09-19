const fs = require("node:fs");
const path = require("node:path");
const { readState, saveState, updateState } = require("./run-state.cjs");
const { writeConfig } = require("./json-files.cjs");
const { databaseForPath } = require("./database-registry.cjs");
const { appendArtifact, writeArtifact } = require("./artifact-store.cjs");
const { SessionHistoryStore } = require("./session-history-store.cjs");
const { normalizeItem } = require("../domain/session-item.cjs");

// Owns the on-disk execution intent, task snapshot and long-lived runner lock.
class ExecutionStore {
  constructor(directory) {
    this.directory = directory;
    this.stateFile = path.join(directory, "run.json");
    this.lockDirectory = path.join(directory, ".lock");
    this.locked = false;
  }

  lock() {
    fs.mkdirSync(this.directory, { recursive: true });
    try {
      fs.mkdirSync(this.lockDirectory);
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error(
          `This requirement is locked: ${this.lockDirectory}. Check whether its runner is still active.`,
        );
      throw error;
    }
    this.locked = true;
  }

  release() {
    if (!this.locked) return;
    fs.rmdirSync(this.lockDirectory);
    this.locked = false;
  }

  exists() {
    const database = databaseForPath(this.stateFile);
    if (database) return database.readDocument(this.stateFile) !== undefined;
    return fs.existsSync(this.stateFile);
  }

  read() {
    return readState(this.stateFile);
  }

  save(state) {
    return saveState(this.stateFile, state);
  }

  update(patch) {
    return updateState(this.stateFile, patch);
  }

  writeTask(task) {
    writeConfig(path.join(this.directory, "requirement.json"), task);
  }

  append(name, value) {
    if (!["events.jsonl", "stderr.log", "initialization.log"].includes(name))
      throw new Error("无效的执行日志类型。");
    appendArtifact(path.join(this.directory, name), value);
    if (name === "events.jsonl" && databaseForPath(this.directory)) {
      for (const line of String(value).split("\n").filter(Boolean)) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (["item.started", "item.completed"].includes(event.type) && event.item)
          new SessionHistoryStore(this.directory).save(normalizeItem(event.item, event.turn_id));
      }
    }
  }

  captureFinal() {
    const file = path.join(this.directory, "final.md");
    if (databaseForPath(file) && fs.existsSync(file)) {
      writeArtifact(file, fs.readFileSync(file), { mimeType: "text/markdown" });
      fs.unlinkSync(file);
    }
  }
}

function readRunStatus(directory) {
  return new ExecutionStore(directory).read();
}

module.exports = { ExecutionStore, readRunStatus };
