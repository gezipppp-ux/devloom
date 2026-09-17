const OUTPUT_LIMIT = 100000;

function text(value) {
  return typeof value === "string" ? value : "";
}
function printable(value) {
  return value == null
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
}
function normalizeItem(item, turnId) {
  const type =
    {
      agent_message: "agentMessage",
      command_execution: "commandExecution",
      file_change: "fileChange",
    }[item.type] || item.type;
  return {
    id: item.id,
    turnId,
    type,
    status: item.status || "completed",
    text: text(
      item.text ||
        item.plan ||
        (Array.isArray(item.summary) ? item.summary.join("\n") : "") ||
        (Array.isArray(item.content)
          ? item.content
              .filter((part) => part?.type === "text")
              .map((part) => part.text)
              .join("\n")
          : ""),
    ).slice(-OUTPUT_LIMIT),
    command: text(item.command),
    output: text(item.aggregatedOutput ?? item.aggregated_output).slice(
      -OUTPUT_LIMIT,
    ),
    exitCode: item.exitCode ?? item.exit_code,
    changes: item.changes,
    name: item.tool || item.name,
    error: item.error?.message,
    arguments: printable(item.arguments).slice(-OUTPUT_LIMIT),
    result: printable(item.result || item.contentItems).slice(-OUTPUT_LIMIT),
  };
}

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

module.exports = { OUTPUT_LIMIT, normalizeItem, initializationItem };
