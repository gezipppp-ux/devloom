const { createHash } = require("node:crypto");
const { OUTPUT_LIMIT } = require("../domain/session-item.cjs");

function imageSources(content) {
  if (!Array.isArray(content)) return [];
  return content.flatMap(part => {
    if (["localImage", "local_image"].includes(part?.type) && typeof part.path === "string") return [{ path: part.path }];
    if (part?.type !== "image" || typeof part.url !== "string") return [];
    const data = /^data:image\/(?:png|jpe?g|webp);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(part.url);
    return data ? [{ sha256: createHash("sha256").update(Buffer.from(data[1], "base64")).digest("hex") }] : [];
  });
}

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
      user_message: "userMessage",
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
    imageSources: imageSources(item.content),
  };
}

module.exports = { normalizeItem };
