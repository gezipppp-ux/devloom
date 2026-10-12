const fs = require("node:fs");
const path = require("node:path");
const { readState, saveState, updateState } = require("./run-state.cjs");
const { writeConfig } = require("./json-files.cjs");
const { databaseForPath } = require("./database-registry.cjs");
const { appendArtifact, writeArtifact } = require("./artifact-store.cjs");
const { SessionHistoryStore } = require("./session-history-store.cjs");
const { RunRequirementsStore } = require("./run-requirements-store.cjs");

// Owns the on-disk execution intent, task snapshot and long-lived runner lock.
class ExecutionStore {
  constructor(directory) {
    this.directory = directory;
    this.stateFile = path.join(directory, "run.json");
    this.lockDirectory = path.join(directory, ".lock");
    this.locked = false;
  }

  async claimSources(key, sources, options) {
    // Explicit isolated execution fixtures can use an arbitrary directory;
    // never place their membership records outside that directory.
    this.requirements = new RunRequirementsStore(path.basename(this.directory) === key
      ? path.dirname(this.directory) : this.directory);
    this.sourceKey = key;
    (await this.requirements.claim(key, sources, options));
  }

  async releaseUnstartedSources() {
    if (!(await this.exists())) (await this.requirements?.releaseUnstarted(this.sourceKey));
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

  async exists() {
    const database = databaseForPath(this.stateFile);
    if (database) return (await database.readDocument(this.stateFile)) !== undefined;
    return fs.existsSync(this.stateFile);
  }

  async read() {
    return (await readState(this.stateFile));
  }

  async save(state) {
    return (await saveState(this.stateFile, state));
  }

  async update(patch) {
    return (await updateState(this.stateFile, patch));
  }

  async writeTask(task) {
    (await writeConfig(path.join(this.directory, "requirement.json"), task));
  }

  async append(name, value) {
    if (!["events.jsonl", "stderr.log", "initialization.log"].includes(name))
      throw new Error("无效的执行日志类型。");
    (await appendArtifact(path.join(this.directory, name), value));
  }

  async saveHistoryItem(item) {
    await new SessionHistoryStore(this.directory).save(item);
  }

  async captureFinal() {
    const file = path.join(this.directory, "final.md");
    if (databaseForPath(file) && fs.existsSync(file)) {
      (await writeArtifact(file, fs.readFileSync(file), { mimeType: "text/markdown" }));
      fs.unlinkSync(file);
    }
  }
}

async function readRunStatus(directory) {
  return (await new ExecutionStore(directory).read());
}

module.exports = { ExecutionStore, readRunStatus };
