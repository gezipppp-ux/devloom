const { listTaskFiles, readTaskFile } = require("../git/task-files.cjs");
const { presentFileList, presentFile } = require("./session-file-presenter.cjs");

class SessionFiles {
  constructor(manager) { this.manager = manager; }

  state(key) {
    this.manager.assertOpen();
    const store = this.manager.store;
    if (!store.hasRun(key)) throw Object.assign(new Error("任务不存在。"), { statusCode: 404 });
    const deletion = store.readWorktreeDeletion(key);
    if (deletion.worktreeRemoved || ["deleted", "deleting", "partial"].includes(deletion.status))
      throw new Error("Worktree 已删除或正在清理，无法读取文件。会话历史仍可查看。");
    return store.read(key);
  }

  async list(key, scope) {
    const result = await listTaskFiles(this.state(key), scope);
    this.state(key);
    return presentFileList(result);
  }

  async read(key, file, scope) {
    const result = await readTaskFile(this.state(key), file, scope);
    this.state(key);
    return presentFile(result);
  }
}

module.exports = { SessionFiles };
