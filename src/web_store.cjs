const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { RUN_KEY, sourceFor } = require("./run_identity.cjs");
const { samePath, readOptional, writeConfig } = require("./settings.cjs");
const {
  defaultTaskMetadata,
  validateTaskMetadata,
} = require("./task_metadata.cjs");

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

class RunStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.owned = new Set();
  }

  claim(key) {
    if (this.owned.has(key)) return;
    const file = path.join(this.dir(key), "web-owner.json");
    fs.mkdirSync(this.dir(key), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(file, JSON.stringify({ pid: process.pid }), {
          flag: "wx",
          mode: 0o600,
        });
        this.owned.add(key);
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const owner = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0)
          throw new Error("会话所有权记录无效，请检查 web-owner.json。");
        try {
          process.kill(owner.pid, 0);
        } catch (probe) {
          if (probe.code === "ESRCH") {
            fs.unlinkSync(file);
            continue;
          }
        }
        throw new Error("该 session 已由另一个 Web CLI 服务持有。");
      }
    }
    throw new Error("会话所有权发生变化，请刷新后重试。");
  }

  releaseAll() {
    for (const key of this.owned) {
      const file = path.join(this.dir(key), "web-owner.json");
      try {
        if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid)
          fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    this.owned.clear();
  }

  dir(key) {
    if (!RUN_KEY.test(key)) throw new Error("无效的任务标识。");
    return path.join(this.directory, key);
  }

  read(key) {
    return JSON.parse(
      fs.readFileSync(path.join(this.dir(key), "run.json"), "utf8"),
    );
  }

  list() {
    if (!fs.existsSync(this.directory)) return [];
    return fs
      .readdirSync(this.directory)
      .filter((key) => RUN_KEY.test(key))
      .flatMap((key) => {
        try {
          return [this.summary(key, this.read(key))];
        } catch {
          return [];
        }
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  summary(key, state) {
    return {
      key,
      title: state.workitem.title,
      source: state.source || sourceFor("tapd", state.workitem),
      storyId: state.workitem.id,
      workspaceId: state.workitem.workspace_id,
      sessionId: state.session_id,
      metadata: this.readTaskMetadata(key, state.workitem),
      codex: state.codex
        ? {
            model: text(state.codex.model),
            reasoningEffort: text(state.codex.reasoning_effort),
          }
        : null,
      execution: state.execution,
      transition: state.transition,
      updatedAt: state.updated_at,
      imageCount: state.image_count,
      worktree: state.worktree,
    };
  }

  worktreeReason(state) {
    const tree = state.worktree;
    if (!tree?.path || !tree.repository || !tree.branch)
      return "尚未创建工作区";
    try {
      const entries = execFileSync(
        "git",
        ["-C", tree.repository, "worktree", "list", "--porcelain", "-z"],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const match = entries.split("\0\0").find((entry) => {
        const location = entry
          .split("\0")
          .find((line) => line.startsWith("worktree "))
          ?.slice(9);
        return location && samePath(location, tree.path);
      });
      if (
        !match ||
        !match.split("\0").includes(`branch refs/heads/${tree.branch}`) ||
        !fs.existsSync(path.join(tree.path, ".git"))
      )
        return "工作区或分支已移除，此任务仅供查看";
      return null;
    } catch {
      return "无法验证原工作区，请检查仓库路径";
    }
  }

  readTaskMetadata(key, item) {
    const saved = readOptional(path.join(this.dir(key), "task-metadata.json"));
    return validateTaskMetadata(saved, defaultTaskMetadata(item));
  }

  writeTaskMetadata(key, input, item) {
    const metadata = validateTaskMetadata(
      input,
      this.readTaskMetadata(key, item),
    );
    writeConfig(path.join(this.dir(key), "task-metadata.json"), metadata);
    return metadata;
  }

  legacyHistory(key) {
    const file = path.join(this.dir(key), "events.jsonl");
    if (!fs.existsSync(file)) return [];
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - 2 * 1024 * 1024);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      const lines = buffer.toString("utf8").split("\n");
      if (start) lines.shift();
      return lines
        .flatMap((line) => {
          try {
            const event = JSON.parse(line);
            return event.type === "item.completed" && event.item
              ? [normalizeItem(event.item)]
              : [];
          } catch {
            return [];
          }
        })
        .slice(-100);
    } finally {
      fs.closeSync(fd);
    }
  }

  writeWeb(key, data) {
    const file = path.join(this.dir(key), "web-session.json");
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(`${file}.tmp`, file);
  }

  readWeb(key) {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(this.dir(key), "web-session.json"), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  log(key, event) {
    fs.mkdirSync(this.dir(key), { recursive: true });
    fs.appendFileSync(
      path.join(this.dir(key), "web-events.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
      { mode: 0o600 },
    );
  }

  taskFile(key) {
    const current = path.join(this.dir(key), "requirement.json");
    return fs.existsSync(current)
      ? current
      : path.join(this.dir(key), "tapd-task.json");
  }

  requirement(key, state = this.read(key)) {
    let task = {};
    let warning = "";
    try {
      task = JSON.parse(fs.readFileSync(this.taskFile(key), "utf8"));
    } catch (error) {
      warning =
        error.code === "ENOENT"
          ? "任务资料快照缺失，已显示运行记录中保存的需求内容。"
          : "任务资料快照无法读取，已显示运行记录中保存的需求内容。";
    }
    const item = { ...state.workitem, ...task.workitem };
    return {
      id: text(String(item.id || "")),
      title: text(item.title),
      sourceUrl: text(item.detail_url),
      capturedAt: text(task.generated_at || state.created_at),
      description: text(item.description),
      markdown: text(item.markdown_description),
      prompt: text(task.codex_prompt),
      warning,
      images: (task.images || []).map((image, index) => ({
        index,
        name: path.basename(image.path || `image-${index + 1}`),
        source: text(image.source),
        url: `${this.apiPrefix || "/api"}/runs/${key}/images/${index}`,
      })),
    };
  }

  images(key) {
    try {
      const task = JSON.parse(fs.readFileSync(this.taskFile(key), "utf8"));
      return (task.images || []).map((image, index) => ({
        index,
        name: path.basename(image.path),
        url: `${this.apiPrefix || "/api"}/runs/${key}/images/${index}`,
      }));
    } catch {
      return [];
    }
  }

  imagePath(key, index) {
    if (!/^\d+$/.test(index)) throw new Error("无效的图片编号");
    const task = JSON.parse(fs.readFileSync(this.taskFile(key), "utf8"));
    const file = fs.realpathSync(task.images?.[Number(index)]?.path || "");
    const root = fs.realpathSync(this.dir(key));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("图片不属于当前任务");
    return file;
  }
}

module.exports = { OUTPUT_LIMIT, RunStore, normalizeItem };
