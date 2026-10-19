const { assertAgentIdentity } = require("../domain/agent-contract.cjs");
const { repositoryCommonDirectory } = require("../git/repository.cjs");
const { presentError } = require("./error-presenter.cjs");
const {
  readTaskGit,
  deleteTaskWorktree,
  forceDeleteTaskWorktree,
} = require("../git/task-operations.cjs");
const { withRepositoryOperation } = require("../storage/git-operations.cjs");

const ACTIVE = new Set([
  "preparing",
  "initializing",
  "starting",
  "running",
  "inProgress",
]);

class SessionGit {
  /** @param {import('./session-manager.cjs').SessionManager} manager */
  constructor(manager) {
    this.manager = manager;
    this.store = manager.store;
  }

  activeReason(key) {
    const runtime = this.manager.sessions.get(key);
    if (
      runtime?.turnId ||
      runtime?.pipelineActive ||
      ACTIVE.has(runtime?.status)
    )
      return "任务正在执行，请先停止并等待本轮结束后再删除 Worktree。";
    if (runtime?.requests?.size)
      return "任务仍有待处理的问题或审批，请先结束本轮。";
    if (this.store.isExecutionLocked(key))
      return "任务执行器仍持有工作区，请等待执行结束。";
    return null;
  }

  async assertIdle(key, state) {
    const reason = this.activeReason(key);
    if (reason) throw new Error(reason);
    assertAgentIdentity(this.manager.agent, state);
    this.store.claim(key);
    if (state.session_id) {
      try {
        await this.manager.agent.connect();
        const result = await this.manager.agent.readSession(state.session_id);
        if (result.status !== "idle")
          throw new Error("active");
      } catch {
        throw new Error("无法确认执行器会话已空闲，请确认本轮已结束且连接正常后重试。");
      }
    }
    this.manager.assertOpen();
    await this.manager.authorize("code.operate");
    const afterRead = this.activeReason(key);
    if (afterRead) throw new Error(afterRead);
  }

  // Called only while the manager holds the per-session operation lock.
  async forceRemove(key, confirmBranch) {
    const state = (await this.store.read(key));
    if (!state.worktree?.path) return;
    if (typeof confirmBranch !== "string" || confirmBranch !== state.worktree.branch)
      throw new Error("请输入完整的任务分支名称以确认强制删除。");
    await this.assertIdle(key, state);
    const common = repositoryCommonDirectory(state.worktree.repository);
    return (await withRepositoryOperation(common, async () => {
      const previous = (await this.store.readWorktreeDeletion(key));
      let record = { ...previous, status: "deleting", force: true,
        path: state.worktree.path, branch: state.worktree.branch,
        startedAt: previous.startedAt || new Date().toISOString(), error: null };
      const persist = async (progress) => {
        record = { ...record, ...progress, updatedAt: new Date().toISOString() };
        (await this.store.writeWorktreeDeletion(key, record));
      };
      (await persist({}));
      try {
        const result = await forceDeleteTaskWorktree(state, previous, persist);
        (await persist({ status: "deleted", worktreeRemoved: true, branchDeleted: true }));
        const runtime = this.manager.sessions.get(key);
        if (runtime) runtime.connected = false;
        this.publish(key, record);
        return result;
      } catch (error) {
        (await persist({ ...error.partial, status: record.worktreeRemoved || error.partial?.worktreeRemoved ? "partial" : "failed", error: presentError(error).message }));
        this.publish(key, record);
        throw error;
      }
    }));
  }

  async read(key) {
    this.manager.assertOpen();
    const state = (await this.store.read(key));
    const deletion = (await this.store.readWorktreeDeletion(key));
    if (deletion.status === "deleted")
      return {
        deleted: true,
        path: state.worktree?.path,
        branch: state.worktree?.branch,
        head: deletion.head,
        canDelete: false,
        deleteReason: "Worktree 与本地分支已删除。",
        deletion,
      };
    const status = readTaskGit(state, deletion);
    const reason = this.activeReason(key);
    return {
      ...status,
      canDelete: Boolean(
        status.canDelete && !reason && !this.manager.operations.has(key),
      ),
      deleteReason:
        reason ||
        (this.manager.operations.has(key)
          ? "任务操作正在进行，请稍后重试。"
          : status.deleteReason),
      deletion: Object.keys(deletion).length ? deletion : null,
    };
  }

  async remove(key, input) {
    return (await this.manager.exclusive(key, async () => {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (field) =>
            ![
              "expectedHead",
              "statusToken",
              "confirmBranch",
              "discardChanges",
            ].includes(field),
        ) ||
        typeof input.expectedHead !== "string" ||
        typeof input.statusToken !== "string" ||
        typeof input.confirmBranch !== "string" ||
        typeof input.discardChanges !== "boolean"
      )
        throw new Error("删除确认信息无效，请重新打开删除确认窗口。");
      const state = (await this.store.read(key));
      const previous = (await this.store.readWorktreeDeletion(key));
      if (previous.status === "deleted")
        return { deleted: true, deletion: previous };
      await this.assertIdle(key, state);
      const common = repositoryCommonDirectory(state.worktree.repository);
      return (await withRepositoryOperation(common, async () => {
        // Validate a fresh snapshot before persisting deletion intent. A later
        // Git operation revalidates it again immediately before removing files.
        const snapshot = readTaskGit(state, previous);
        if (snapshot.deleted) {
          const deletion = {
            ...previous,
            status: "deleted",
            worktreeRemoved: true,
            branchDeleted: true,
            updatedAt: new Date().toISOString(),
          };
          (await this.store.writeWorktreeDeletion(key, deletion));
          this.publish(key, deletion);
          return { deleted: true, deletion };
        }
        if (!snapshot.canDelete)
          throw new Error(snapshot.deleteReason || "当前 Worktree 不能删除。");
        if (
          snapshot.head !== input.expectedHead ||
          snapshot.statusToken !== input.statusToken
        )
          throw new Error("Worktree 状态已变化，请刷新后重新确认删除。");
        if (input.confirmBranch !== state.worktree.branch)
          throw new Error("确认分支名称不匹配。");
        let record = {
          ...previous,
          status: "deleting",
          path: state.worktree.path,
          branch: state.worktree.branch,
          head: snapshot.head,
          taskBranchHead: snapshot.taskBranchHead,
          retainedBranch: snapshot.retainedBranch,
          startedAt: new Date().toISOString(),
          error: null,
        };
        const persist = async (progress) => {
          record = {
            ...record,
            ...progress,
            updatedAt: new Date().toISOString(),
          };
          (await this.store.writeWorktreeDeletion(key, record));
        };
        (await persist({}));
        try {
          const result = await deleteTaskWorktree(
            state,
            input,
            previous,
            persist,
          );
          (await persist({
            status: "deleted",
            worktreeRemoved: true,
            branchDeleted: true,
          }));
          const runtime = this.manager.sessions.get(key);
          if (runtime) runtime.connected = false;
          this.publish(key, record);
          return { ...result, deleted: true, deletion: record };
        } catch (error) {
          (await persist({
            ...error.partial,
            status:
              record.worktreeRemoved || error.partial?.worktreeRemoved
                ? "partial"
                : "failed",
            error: presentError(error).message,
          }));
          this.publish(key, record);
          throw error;
        }
      }));
    }));
  }

  publish(key, deletion) {
    this.manager.emit("event", {
      key,
      type: "worktree",
      deletion,
      readOnlyReason: deletion.worktreeRemoved
        ? "Worktree 已删除，此会话仅供查看。"
        : undefined,
      at: new Date().toISOString(),
    });
  }
}

module.exports = { SessionGit };
