function canRetryPreparation(state) {
  return Boolean(state && ["failed", "interrupted", "cancelled"].includes(state.execution?.status)
    && !state.session_id && !state.execution_started_at && !state.initialization
    && state.transition?.status === "not_started"
    && state.worktree?.repository && state.worktree.baseline?.branch
    && !state.worktree.path && !state.worktree.branch && !state.worktree.base_commit && !state.worktree.baseline.commit);
}

module.exports = { canRetryPreparation };
