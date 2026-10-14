const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { git, gitAsync } = require("./command.cjs");
const { repositoryGit, repositoryCommonDirectory } = require("./repository.cjs");
const { absolutePath, samePath } = require("../shared/paths.cjs");
const { operationReason, registeredWorktrees, sameWorktreePath } = require("./operation-state.cjs");

function taskIdentity(state) {
  const tree = state.worktree;
  if (!tree?.path || !tree.repository || !tree.branch?.startsWith("codex/"))
    throw new Error("没有可验证的 Codex 任务 Worktree。");
  git(tree.repository, ["check-ref-format", `refs/heads/${tree.branch}`]);
  const { repository } = repositoryGit(tree.repository);
  if (!path.isAbsolute(tree.path) || samePath(repository, tree.path))
    throw new Error("不能删除仓库主目录。");
  return { ...tree, repository };
}

function inspectWorktree(state) {
  const tree = taskIdentity(state);
  const entry = registeredWorktrees(tree.repository).find((candidate) => sameWorktreePath(candidate.path, tree.path));
  if (!entry || entry.prunable)
    throw new Error("原 Worktree 已移除或不再属于原仓库。");
  if (fs.lstatSync(tree.path).isSymbolicLink() || !fs.lstatSync(path.join(tree.path, ".git")).isFile())
    throw new Error("Worktree 路径或 Git 标记已变化，不能删除。");
  const common = repositoryCommonDirectory(tree.repository);
  const actualCommon = repositoryCommonDirectory(tree.path);
  const directory = git(tree.path, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  const topLevel = git(tree.path, ["rev-parse", "--show-toplevel"]);
  const backlink = fs.readFileSync(path.join(directory, "gitdir"), "utf8").replace(/\r?\n$/, "");
  const real = (value) => fs.realpathSync.native(value);
  const current = currentBranch(tree);
  if (!samePath(real(common), real(actualCommon)) ||
      !samePath(real(topLevel), real(tree.path)) ||
      samePath(real(repositoryRoot(common)), real(tree.path)) ||
      !samePath(real(path.resolve(directory, backlink)), real(path.join(tree.path, ".git"))) ||
      (entry.branch || null) !== (current ? `refs/heads/${current}` : null))
    throw new Error("Worktree 的仓库或注册关系已变化，不能删除。");
  return { ...tree, currentBranch: current, locked: entry.locked };
}

function verifyWorktree(state) {
  const tree = inspectWorktree(state);
  if (tree.currentBranch !== tree.branch)
    throw new Error("原 Worktree 已不再属于任务分支。");
  if (tree.locked) throw new Error("Worktree 已被 Git 锁定，请先解除锁定。");
  const reason = operationReason(tree.path);
  if (reason) throw new Error(reason);
  return tree;
}

function repositoryRoot(common) {
  // The common Git directory can be separate from the primary checkout.
  // Its own parent is only an additional root guard, never a deletion target.
  return path.dirname(common);
}

function statusEntries(output) {
  const parts = output.split("\0");
  const entries = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (!parts[index]) continue;
    const code = parts[index].slice(0, 2);
    entries.push({ code, file: parts[index].slice(3) });
    if (/[RC]/.test(code)) index += 1;
  }
  return entries;
}

function statusToken(tree, head, upstream, entries) {
  const hash = createHash("sha256").update(JSON.stringify({ path: tree.path, branch: tree.branch, head, upstream, entries }));
  hash.update(git(tree.path, ["diff", "--cached", "--raw", "--abbrev=64", "--no-renames", "--no-ext-diff", "HEAD", "--"]));
  const budget = { remaining: 10000, deadline: Date.now() + 250 };
  for (const { file } of entries) {
    hashFileMetadata(hash, path.join(tree.path, file), budget);
  }
  return hash.digest("hex");
}

function assertMetadataBudget(budget, pendingCount) {
  if (pendingCount > budget.remaining)
    throw new Error("本地文件过多，无法完整验证删除确认。请先在本地清理忽略内容后刷新；系统未删除任何文件。");
  if (Date.now() > budget.deadline)
    throw new Error("本地文件验证耗时过长，无法完整验证删除确认。请先在本地清理忽略内容后刷新；系统未删除任何文件。");
}

function hashFileMetadata(hash, file, budget) {
  const pending = [file];
  while (pending.length) {
    assertMetadataBudget(budget, pending.length);
    budget.remaining -= 1;
    const current = pending.pop();
    hash.update(JSON.stringify(current));
    try {
      const stat = fs.lstatSync(current, { bigint: true });
      hash.update(`${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`);
      // Git collapses ignored directories into one status entry. Their own
      // timestamps do not change when an existing descendant file is edited.
      // lstat deliberately avoids following links outside the task worktree.
      if (stat.isDirectory()) {
        const directory = fs.opendirSync(current);
        const names = [];
        try {
          let entry;
          while ((entry = directory.readSync())) {
            assertMetadataBudget(budget, pending.length + names.length + 1);
            names.push(entry.name);
          }
        } finally {
          directory.closeSync();
        }
        for (const name of names.sort().reverse()) pending.push(path.join(current, name));
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("removed");
    }
  }
}

function branchHead(tree) {
  try {
    git(tree.repository, ["show-ref", "--verify", "--quiet", `refs/heads/${tree.branch}`]);
    return git(tree.repository, ["rev-parse", "--verify", "--end-of-options", `refs/heads/${tree.branch}`]);
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
}

function pathExists(value) {
  try { fs.lstatSync(value); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function currentBranch(tree) {
  if (!tree?.path) return null;
  try {
    return git(tree.path, ["symbolic-ref", "--quiet", "--short", "HEAD"]).trim() || null;
  } catch (error) {
    if (error.status === 1) return null;
    return null;
  }
}

function recoveryState(state, deletion) {
  const tree = taskIdentity(state);
  if (!samePath(deletion.path || "", tree.path) || deletion.branch !== tree.branch ||
      !/^[a-f\d]{40,64}$/i.test(deletion.head || ""))
    throw new Error("删除记录与原任务不一致，不能继续删除。");
  if (pathExists(tree.path) || registeredWorktrees(tree.repository).some((entry) =>
    samePath(entry.path, tree.path) || entry.branch === `refs/heads/${tree.branch}`))
    throw new Error("原路径或分支已被重新使用，不能继续删除。");
  const head = branchHead(tree);
  if (head && head !== deletion.head) throw new Error("任务分支已有新的提交，不能继续删除。");
  return {
    tree, head,
    token: createHash("sha256").update(JSON.stringify({ path: tree.path, branch: tree.branch, head, recovery: true })).digest("hex"),
  };
}

function readTaskGit(state, deletion = {}) {
  const empty = {
    path: state.worktree?.path || null, branch: state.worktree?.branch || null,
    currentBranch: currentBranch(state.worktree),
    head: null, upstream: null, unpublished: null, ahead: null, behind: null,
    upstreamMissing: null, warning: null,
    changedFiles: null, untrackedFiles: null, ignoredFiles: null,
    clean: null, statusToken: null, canDelete: false, deleteReason: null,
  };
  try {
    if (deletion.worktreeRemoved ||
        (deletion.status === "deleting" && state.worktree?.path && !pathExists(state.worktree.path))) {
      const recovery = recoveryState(state, deletion);
      return {
        ...empty, head: recovery.head || deletion.head, statusToken: recovery.token,
        worktreeRemoved: true, branchDeleted: !recovery.head, deleted: !recovery.head,
        canDelete: Boolean(recovery.head),
        deleteReason: recovery.head ? null : "Worktree 和本地分支已删除。",
      };
    }
    const tree = inspectWorktree(state);
    const head = git(tree.path, ["rev-parse", "--verify", "HEAD"]);
    const upstreamRef = tree.currentBranch
      ? git(tree.path, ["for-each-ref", "--format=%(upstream)", `refs/heads/${tree.currentBranch}`])
      : "";
    const upstream = upstreamRef.startsWith("refs/remotes/")
      ? upstreamRef.slice("refs/remotes/".length)
      : null;
    let ahead = null, behind = null, upstreamMissing = false;
    if (upstream) {
      try {
        git(tree.path, ["show-ref", "--verify", "--quiet", upstreamRef]);
      } catch (error) {
        if (error.status !== 1) throw error;
        upstreamMissing = true;
      }
      if (!upstreamMissing) {
        const counts = git(tree.path, ["rev-list", "--left-right", "--count", `${upstreamRef}...HEAD`, "--"]).trim().split(/\s+/).map(Number);
        if (counts.length !== 2 || counts.some((count) => !Number.isSafeInteger(count) || count < 0))
          throw new Error("无法读取与上游分支的提交差异。");
        [behind, ahead] = counts;
      }
    }
    const output = git(tree.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
    const entries = statusEntries(output);
    const changedFiles = entries.filter(({ code }) => code !== "??" && code !== "!!").length;
    const untrackedFiles = entries.filter(({ code }) => code === "??").length;
    const ignoredFiles = entries.filter(({ code }) => code === "!!").length;
    const status = {
      ...empty, path: tree.path, branch: tree.branch, currentBranch: tree.currentBranch, head, upstream,
      unpublished: !upstream, ahead, behind, changedFiles, untrackedFiles, ignoredFiles,
      upstreamMissing,
      warning: upstreamMissing ? "远端上游已不存在，无法计算待推送数量。" : null,
      clean: changedFiles + untrackedFiles === 0,
    };
    const deleteReason = tree.currentBranch !== tree.branch
      ? "当前 Worktree 已切换到其他分支；请恢复记录的任务分支后再删除。"
      : tree.locked
        ? "Worktree 已被 Git 锁定，请先解除锁定。"
        : operationReason(tree.path);
    if (deleteReason) {
      status.deleteReason = deleteReason;
      return status;
    }
    try {
      status.statusToken = statusToken(tree, head, { ref: upstreamRef, ahead, behind }, entries);
      status.canDelete = true;
    } catch (error) {
      // Deletion requires a complete fingerprint; an incomplete fingerprint
      // does not invalidate Git metrics already read successfully.
      status.deleteReason = error.message?.startsWith("Command failed")
        ? "无法完整验证删除确认，请在本地检查仓库。"
        : error.message;
    }
    return status;
  } catch (error) {
    return { ...empty, deleteReason: error.message?.startsWith("Command failed") ? "无法验证原 Worktree 的 Git 状态，请在本地检查仓库。" : error.message };
  }
}

async function removeBranch(tree, head, allowForce) {
  if (branchHead(tree) !== head) throw new Error("任务分支已有新的提交，请检查后重试。");
  try {
    await gitAsync(tree.repository, ["branch", "-d", "--", tree.branch]);
  } catch {
    if (branchHead(tree) !== head) throw new Error("任务分支已有新的提交，请检查后重试。");
    if (!allowForce) throw new Error("本地分支尚未安全合入，请确认丢弃本地内容后重试分支清理。");
    // The caller has explicitly confirmed the full branch name and loss of local work.
    await gitAsync(tree.repository, ["branch", "-D", "--", tree.branch]);
  }
}

async function deleteTaskWorktree(state, input = {}, deletion = {}, onProgress = async () => {}) {
  const snapshot = readTaskGit(state, deletion);
  if (snapshot.deleted) return { deleted: true, path: snapshot.path, branch: snapshot.branch, worktreeRemoved: true, branchDeleted: true };
  if (!snapshot.canDelete) throw new Error(snapshot.deleteReason);
  if (input.confirmBranch !== snapshot.branch) throw new Error("请输入完整的任务分支名称以确认删除。");
  if (input.expectedHead !== snapshot.head || input.statusToken !== snapshot.statusToken)
    throw new Error("Worktree 状态已变化，请刷新并重新确认删除。");
  const risk = snapshot.worktreeRemoved || snapshot.unpublished || snapshot.ahead === null || snapshot.ahead > 0 ||
    snapshot.changedFiles > 0 || snapshot.untrackedFiles > 0 || snapshot.ignoredFiles > 0;
  if (risk && input.discardChanges !== true)
    throw new Error("请确认丢弃未提交、未推送的内容及目录内所有文件后再删除。");
  const tree = snapshot.worktreeRemoved ? recoveryState(state, deletion).tree : verifyWorktree(state);
  const progress = { path: tree.path, branch: tree.branch, head: snapshot.head, worktreeRemoved: true, branchDeleted: false };
  if (!snapshot.worktreeRemoved) {
    try {
      await gitAsync(tree.repository, ["worktree", "remove", ...(risk ? ["--force"] : []), "--", tree.path]);
    } catch {
      const error = new Error("删除 Worktree 失败，请检查文件是否被占用；系统不会直接递归删除目录。");
      try {
        recoveryState(state, progress);
        error.partial = progress;
        await onProgress(progress);
      } catch { /* Preserve only a verifiably removed worktree as partial progress. */ }
      throw error;
    }
  }
  try {
    await onProgress(progress);
    await removeBranch(tree, snapshot.head, input.discardChanges === true);
    const completed = { ...progress, branchDeleted: true, deleted: true };
    await onProgress(completed);
    return completed;
  } catch {
    const error = new Error("Worktree 目录已删除，但本地分支清理尚未完成。请刷新后重试，不会重新创建目录。");
    error.partial = progress;
    throw error;
  }
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function forceDeletionTarget(state, deletion) {
  const tree = taskIdentity(state);
  tree.path = absolutePath(tree.path, "任务目录");
  if (samePath(tree.path, path.parse(tree.path).root))
    throw new Error("不能删除磁盘或文件系统根目录。");
  // Check every existing ancestor before any recursive removal, including
  // junctions and dangling links. Only the recorded absolute directory is used.
  for (let current = tree.path; ; current = path.dirname(current)) {
    if (pathExists(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error("任务目录或其父目录已被符号链接替换，不能强制删除。");
    if (samePath(current, path.dirname(current))) break;
  }
  const entries = registeredWorktrees(tree.repository);
  const common = repositoryCommonDirectory(tree.repository);
  if ([tree.repository, common, ...entries.filter((entry) => !samePath(entry.path, tree.path)).map((entry) => entry.path)]
    .some((protectedPath) => containsPath(tree.path, protectedPath)))
    throw new Error("任务目录包含仓库或其他 Worktree，不能强制删除。");
  if (entries.some((entry) => !samePath(entry.path, tree.path) && entry.branch === `refs/heads/${tree.branch}`))
    throw new Error("任务分支已被其他 Worktree 使用，不能强制删除。");
  const entry = entries.find((candidate) => samePath(candidate.path, tree.path));
  const exists = pathExists(tree.path);
  const stat = exists ? fs.lstatSync(tree.path, { bigint: true }) : null;
  const directoryIdentity = stat ? `${stat.dev}:${stat.ino}` : null;
  if (exists && Object.hasOwn(deletion, "directoryIdentity") && deletion.directoryIdentity !== directoryIdentity)
    throw new Error("原任务目录已被替换，不能强制删除。");
  if ((deletion.worktreeRemoved || deletion.status === "deleted") && (exists || entry))
    throw new Error("原任务路径已被重新使用，不能强制删除。");
  if (exists && !fs.lstatSync(tree.path).isDirectory())
    throw new Error("任务目录已被其他文件替换，不能强制删除。");
  if (entry && (entry.locked || entry.branch !== `refs/heads/${tree.branch}`))
    throw new Error("Worktree 已锁定或不再属于任务分支，不能强制删除。");
  if (exists && pathExists(path.join(tree.path, ".git"))) {
    if (!entry) throw new Error("原路径包含未登记的 Git 仓库，不能强制删除。");
    verifyWorktree(state);
  }
  const head = branchHead(tree);
  if (Object.hasOwn(deletion, "expectedHead") && head && head !== deletion.expectedHead)
    throw new Error("任务分支在清理期间发生变化，请重新确认删除。");
  if ((deletion.worktreeRemoved || deletion.status === "deleted") && head && head !== deletion.head)
    throw new Error("任务分支已有新的提交，不能继续删除。");
  return { tree, head, registered: Boolean(entry), exists, directoryIdentity };
}

async function forceDeleteTaskWorktree(state, deletion = {}, onProgress = () => {}) {
  let target = forceDeletionTarget(state, deletion);
  const guard = { ...deletion, directoryIdentity: target.directoryIdentity, expectedHead: target.head };
  const progress = {
    path: target.tree.path, branch: target.tree.branch, head: target.head || deletion.head,
    directoryIdentity: target.directoryIdentity,
    worktreeRemoved: Boolean(deletion.worktreeRemoved), branchDeleted: Boolean(deletion.branchDeleted),
  };
  try {
    await onProgress(progress);
    target = forceDeletionTarget(state, guard);
    if (target.registered) {
      try {
        await gitAsync(target.tree.repository, ["worktree", "remove", "--force", "--", target.tree.path]);
      } catch {
        // Git can leave a partly removed directory (for example with nested
        // repositories). Revalidate ownership and path boundaries before cleanup.
        target = forceDeletionTarget(state, guard);
      }
    }
    target = forceDeletionTarget(state, guard);
    if (target.exists) {
      await fs.promises.rm(target.tree.path, { recursive: true, force: true, maxRetries: 3 });
    }
    target = forceDeletionTarget(state, guard);
    if (target.registered)
      await gitAsync(target.tree.repository, ["worktree", "remove", "--force", "--", target.tree.path]);
    target = forceDeletionTarget(state, guard);
    if (target.exists || target.registered) throw new Error("任务目录或 Worktree 登记尚未清理完成。");
    progress.worktreeRemoved = true;
    await onProgress(progress);
    if (target.head) await removeBranch(target.tree, target.head, true);
    progress.branchDeleted = true;
    await onProgress(progress);
    return { ...progress, deleted: true };
  } catch (cause) {
    throw Object.assign(new Error(`强制清理未完成：${cause.message} 会话记录已保留，可重试。`), { partial: progress });
  }
}

module.exports = { readTaskGit, deleteTaskWorktree, forceDeleteTaskWorktree };
