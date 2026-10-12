const { listTaskFiles, readTaskFile } = require("../git/task-files.cjs");
const { presentFileList, presentFile } = require("./session-file-presenter.cjs");

class SessionFiles {
  /** @param {import('./session-manager.cjs').SessionManager} manager */
  constructor(manager) { this.manager = manager; }

  async state(key) {
    this.manager.assertOpen();
    const store = this.manager.store;
    if (!(await store.hasRun(key))) throw Object.assign(new Error("任务不存在。"), { statusCode: 404 });
    const deletion = (await store.readWorktreeDeletion(key));
    if (deletion.worktreeRemoved || ["deleted", "deleting", "partial"].includes(deletion.status))
      throw new Error("Worktree 已删除或正在清理，无法读取文件。会话历史仍可查看。");
    return (await store.read(key));
  }

  async list(key, scope) {
    const result = await listTaskFiles((await this.state(key)), scope);
    (await this.state(key));
    return presentFileList(result);
  }

  async read(key, file, scope) {
    const result = await readTaskFile((await this.state(key)), file, scope);
    (await this.state(key));
    return presentFile(result);
  }
}

module.exports = { SessionFiles };
