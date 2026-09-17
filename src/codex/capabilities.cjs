const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const cache = new Map();

// Read the installed executable's stable protocol, without opening a thread or
// executing a task. Unknown versions must not silently emulate auto approval.
async function inspectExecutionCapabilities(resolved) {
  const identities = await Promise.all(
    [resolved.command, ...resolved.args]
      .filter((file) => path.isAbsolute(file))
      .map(async (file) => {
        try {
          const stat = await fs.stat(file);
          return [file, stat.mtimeMs, stat.size];
        } catch {
          return [file];
        }
      }),
  );
  const key = JSON.stringify([resolved, identities]);
  if (cache.has(key)) return cache.get(key);
  const pending = inspect(resolved);
  cache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function inspect({ command, args }) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "web-coding-capabilities-"),
  );
  try {
    const env = { ...process.env };
    delete env.CODEX_THREAD_ID;
    for (const key of Object.keys(env))
      if (key.startsWith("TAPD_")) delete env[key];
    await execute(
      command,
      [...args, "app-server", "generate-json-schema", "--out", directory],
      {
        env,
        cwd: os.tmpdir(),
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      },
    );
    const schemas = await Promise.all(
      ["ThreadStartParams", "ThreadResumeParams", "TurnStartParams"].map(
        async (name) =>
          JSON.parse(
            await fs.readFile(
              path.join(directory, "v2", `${name}.json`),
              "utf8",
            ),
          ),
      ),
    );
    return {
      autoReview: schemas.every(
        (schema) =>
          schema.properties?.approvalsReviewer &&
          schema.definitions?.ApprovalsReviewer?.enum?.includes("auto_review"),
      ),
    };
  } finally {
    // mkdtemp creates this exact child; never clean a configured data directory.
    if (
      path.dirname(directory) !== path.resolve(os.tmpdir()) ||
      !path.basename(directory).startsWith("web-coding-capabilities-")
    )
      throw new Error("Unexpected protocol cache directory.");
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

module.exports = { inspectExecutionCapabilities };
