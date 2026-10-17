const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { runWorktreeGit } = require("./worktree-command.cjs");
const { StringDecoder } = require("node:string_decoder");
const { worktreePathIssue } = require("../domain/worktree-path-budget.cjs");

async function* treeEntryBatches(descriptor, signal) {
  const buffer = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let position = 0;
  for (;;) {
    const { bytesRead: bytes } = await descriptor.read(buffer, 0, buffer.length, position);
    if (!bytes) break;
    if (signal?.aborted) throw new Error("任务准备已停止。");
    position += bytes;
    pending += decoder.write(buffer.subarray(0, bytes));
    const records = pending.split("\0");
    pending = records.pop();
    yield records.map((record) => {
      // Only the first TAB separates metadata; tabs/newlines inside a Git
      // pathname must survive unchanged. A gitlink checks out as a directory.
      const separator = record.indexOf("\t");
      const metadata = /^([0-7]{6}) (blob|tree|commit) [a-f0-9]{40,64}$/.exec(
        record.slice(0, separator),
      );
      if (separator < 0 || !metadata)
        throw new Error("Git 返回的仓库文件信息无效，无法校验 Worktree 路径长度。");
      return {
        path: record.slice(separator + 1),
        kind: metadata[2] === "blob" ? "file" : "directory",
      };
    });
  }
  pending += decoder.end();
  if (pending) throw new Error("Git 返回的仓库文件列表不完整，无法校验 Worktree 路径长度。");
}

async function assertWorktreeCheckoutPaths(plan, { signal, timeout } = {}) {
  if (process.platform !== "win32") return;
  const file = path.join(os.tmpdir(), `codex-worktree-paths-${randomUUID()}`);
  const descriptor = await fs.promises.open(file, "wx+", 0o600);
  let issue = worktreePathIssue(plan.path, []);
  try {
    // Send stdout straight to disk: large repositories must not hit execFile's
    // maxBuffer, and NUL-delimited paths preserve Unicode, spaces and newlines.
    await runWorktreeGit(plan.repository, [
      "ls-tree", "-rz", "--full-tree", plan.base_commit,
    ], {
      stdout: descriptor.fd, signal, timeout,
    });
    for await (const entries of treeEntryBatches(descriptor, signal)) {
      const candidate = worktreePathIssue(plan.path, entries);
      if (candidate && (!issue || candidate.maximumRootLength < issue.maximumRootLength))
        issue = candidate;
    }
  } finally {
    await descriptor.close();
    await fs.promises.unlink(file);
  }
  if (!issue) return;
  const advice = issue.maximumRootLength >= 3
    ? `完整 Worktree 根目录最多允许 ${issue.maximumRootLength} 个字符；请缩短系统设置中的成员目录基础路径后重试。`
    : "仓库内文件层级本身过深，请先缩短仓库内路径后重试。";
  throw new Error(
    `无法创建 Worktree：基准提交中的${issue.kind === "directory" ? "目录" : "文件"}「${issue.relativePath}」拼接后为 ${issue.pathLength} 个字符，超过 Windows 的 ${issue.limit} 个字符限制。${advice}尚未创建任务目录或分支。`,
  );
}

module.exports = { assertWorktreeCheckoutPaths };
