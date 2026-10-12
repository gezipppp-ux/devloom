const OUTPUT_LIMIT = 100000;

function initializationItem(entry, index) {
  return {
    id: `worktree-init-${index}`,
    type: "worktreeInitialization",
    command: entry.command,
    status: entry.status === "running" ? "inProgress" : entry.status,
    output: entry.output,
    exitCode: entry.exit_code,
    error: entry.error,
  };
}

module.exports = { OUTPUT_LIMIT, initializationItem };
