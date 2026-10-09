const fs = require("node:fs");
const path = require("node:path");
const { RUN_KEY, sourceFor, runKey } = require("../domain/run-identity.cjs");
const { MAX_REQUIREMENTS } = require("../domain/requirement-fusion.cjs");
const { databaseForPath } = require("./database-registry.cjs");
const { readOptional, writeConfig } = require("./json-files.cjs");
const { withFileLock } = require("./file-lock.cjs");

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

  read(key) {
    return readOptional(this.file(key));
  }

  transaction(operation) {
    return this.database ? this.database.transaction(operation)
      : withFileLock(path.join(this.directory, "requirements"), operation, "需求归属");
  }

  assignments() {
    let documents;
    if (this.database) documents = this.database.listDocuments(this.directory)
      .filter(({ path: file }) => ["run.json", "requirements.json"].includes(path.basename(file)));
    else documents = fs.existsSync(this.directory) ? fs.readdirSync(this.directory)
      .filter(key => RUN_KEY.test(key))
      .flatMap(key => ["run.json", "requirements.json"].map(name => {
        const file = path.join(this.directory, key, name);
        return { path: file, value: readOptional(file) };
      })) : [];
    const result = new Map();
    for (const { path: file, value } of documents) {
      const key = path.basename(path.dirname(file));
      const sources = value.sources || value.workitem?.sources ||
        (value.workitem ? [value.source || sourceFor("tapd", value.workitem)] : []);
      for (const source of sources) result.set(runKey(source), key);
    }
    return result;
  }

  claim(key, sources, { fingerprint = "", addition } = {}) {
    return this.transaction(() => {
      const saved = this.read(key);
      if (addition && saved.additions?.some(entry => entry.id === addition.id)) {
        const previous = saved.additions.find(entry => entry.id === addition.id);
        if (previous.fingerprint !== addition.fingerprint)
          throw new Error("同一操作标识不能提交不同需求，请重新打开表单。");
        return saved;
      }
      if (saved.fingerprint && fingerprint && saved.fingerprint !== fingerprint)
        throw new Error("同一任务标识不能提交不同需求，请重新打开表单。");
      const assignments = this.assignments();
      for (const source of sources) {
        const owner = assignments.get(runKey(source));
        if (owner && (owner !== key || addition))
          throw new Error(`需求 ${source.id} 已归属任务 ${owner}，请打开原任务。`);
      }
      const state = addition ? readOptional(path.join(this.directory, key, "run.json")) : {};
      const previousSources = saved.sources || state.workitem?.sources ||
        (state.workitem ? [state.source || sourceFor("tapd", state.workitem)] : []);
      const members = addition ? [...previousSources, ...sources] : sources;
      if (members.length > MAX_REQUIREMENTS)
        throw new Error("一个任务最多关联 20 条需求。");
      const value = { ...saved, sources: members,
        ...(fingerprint ? { fingerprint } : {}),
        ...(addition ? { additions: [...(saved.additions || []), addition] } : {}) };
      writeConfig(this.file(key), value);
      return value;
    });
  }

  updateAddition(key, id, update) {
    return this.transaction(() => {
      const saved = this.read(key);
      const entry = saved.additions?.find(item => item.id === id);
      if (!entry) throw new Error("追加资料不存在。");
      Object.assign(entry, update(entry));
      writeConfig(this.file(key), saved);
      return entry;
    });
  }

  releaseUnstarted(key) {
    return this.transaction(() => {
      // A competing CLI may hold the same task while a Web launch fails to
      // acquire its execution lock. Never release that runner's reservation.
      if (fs.existsSync(path.join(this.directory, key, ".lock"))) return;
      const state = path.join(this.directory, key, "run.json");
      if (this.database) {
        if (!this.database.readDocument(state)) this.database.deleteDocument(this.file(key));
      } else if (!fs.existsSync(state)) fs.rmSync(this.file(key), { force: true });
    });
  }
}

module.exports = { RunRequirementsStore };
