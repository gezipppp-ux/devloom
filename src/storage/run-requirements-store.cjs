const fs = require("node:fs");
const path = require("node:path");
const { RUN_KEY, recordedSources, runKey } = require("../domain/run-identity.cjs");
const { MAX_REQUIREMENTS } = require("../domain/requirement-fusion.cjs");
const { databaseForPath } = require("./database-registry.cjs");
const { readOptional, writeConfig } = require("./json-files.cjs");
const { withAsyncFileLock } = require("./file-lock.cjs");

// Source membership and addition snapshots commit together. Network preparation
// happens outside this workspace-wide, short transaction/fixture file lock.
class RunRequirementsStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.database = databaseForPath(this.directory);
  }

  file(key) {
    if (!RUN_KEY.test(key)) throw new Error("无效的任务标识。");
    return path.join(this.directory, key, "requirements.json");
  }

  async read(key) {
    return (await readOptional(this.file(key)));
  }

  async transaction(operation) {
    return this.database ? (await this.database.transaction(operation))
      : (await withAsyncFileLock(path.join(this.directory, "requirements"), operation, "需求归属"));
  }

  async assignments() {
    let documents;
    if (this.database) documents = (await this.database.listDocuments(this.directory))
      .filter(({ path: file }) => ["run.json", "requirements.json"].includes(path.basename(file)));
    else documents = fs.existsSync(this.directory) ? (await Promise.all(fs.readdirSync(this.directory)
      .filter(key => RUN_KEY.test(key))
      .flatMap(async key => (await Promise.all(["run.json", "requirements.json"].map(async name => {
        const file = path.join(this.directory, key, name);
        return { path: file, value: (await readOptional(file)) };
      })))))).flat() : [];
    const result = new Map();
    for (const { path: file, value } of documents) {
      const key = path.basename(path.dirname(file));
      const sources = recordedSources(value);
      for (const source of sources) result.set(runKey(source), key);
    }
    return result;
  }

  async claim(key, sources, { fingerprint = "", addition } = {}) {
    return (await this.transaction(async () => {
      const saved = (await this.read(key));
      if (addition && saved.additions?.some(entry => entry.id === addition.id)) {
        const previous = saved.additions.find(entry => entry.id === addition.id);
        if (previous.fingerprint !== addition.fingerprint)
          throw new Error("同一操作标识不能提交不同需求，请重新打开表单。");
        return saved;
      }
      if (saved.fingerprint && fingerprint && saved.fingerprint !== fingerprint)
        throw new Error("同一任务标识不能提交不同需求，请重新打开表单。");
      const assignments = (await this.assignments());
      for (const source of sources) {
        const owner = assignments.get(runKey(source));
        if (owner && (owner !== key || addition))
          throw new Error(`需求 ${source.id} 已归属任务 ${owner}，请打开原任务。`);
      }
      const state = addition ? (await readOptional(path.join(this.directory, key, "run.json"))) : {};
      const previousSources = saved.sources || recordedSources(state);
      const members = addition ? [...previousSources, ...sources] : sources;
      if (members.length > MAX_REQUIREMENTS)
        throw new Error("一个任务最多关联 20 条需求。");
      const value = { ...saved, sources: members,
        ...(fingerprint ? { fingerprint } : {}),
        ...(addition ? { additions: [...(saved.additions || []), addition] } : {}) };
      (await writeConfig(this.file(key), value));
      return value;
    }));
  }

  async updateAddition(key, id, update) {
    return (await this.transaction(async () => {
      const saved = (await this.read(key));
      const entry = saved.additions?.find(item => item.id === id);
      if (!entry) throw new Error("追加资料不存在。");
      Object.assign(entry, await update(entry));
      (await writeConfig(this.file(key), saved));
      return entry;
    }));
  }

  async releaseUnstarted(key) {
    return (await this.transaction(async () => {
      // A competing CLI may hold the same task while a Web launch fails to
      // acquire its execution lock. Never release that runner's reservation.
      if (fs.existsSync(path.join(this.directory, key, ".lock"))) return;
      const state = path.join(this.directory, key, "run.json");
      if (this.database) {
        if (!(await this.database.readDocument(state))) (await this.database.deleteDocument(this.file(key)));
      } else if (!fs.existsSync(state)) fs.rmSync(this.file(key), { force: true });
    }));
  }
}

module.exports = { RunRequirementsStore };
