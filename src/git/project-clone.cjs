const fs = require("node:fs");
const path = require("node:path");
const { cloneGitRepository } = require("./account-credentials.cjs");
const { repositoryGit } = require("./repository.cjs");
const { assertDirectoryBoundary } = require("../shared/directory-boundary.cjs");

async function cloneProject({
  account,
  remote,
  target,
  memberStorageRoot,
  publish = () => target,
  signal,
  onProgress = () => {},
  preserveOnFailure = false,
}) {
  if (signal?.aborted) throw new Error("克隆已中断。");
  assertDirectoryBoundary(memberStorageRoot, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assertDirectoryBoundary(memberStorageRoot, target);
  try {
    fs.mkdirSync(target);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error("项目目录已存在，请使用其他项目；不会覆盖已有代码。");
    throw error;
  }
  const owned = fs.lstatSync(target);
  try {
    await onProgress({ stage: "connecting", percent: null });
    await cloneGitRepository(account, remote, target, { signal, onProgress });
    if (signal?.aborted) throw new Error("克隆已中断。");
    await onProgress({ stage: "publishing", percent: null });
    assertDirectoryBoundary(memberStorageRoot, target);
    repositoryGit(target);
    return await publish();
  } catch (error) {
    if (preserveOnFailure) throw error;
    // Only remove the exact directory claimed by this attempt, never a contender's checkout.
    try {
      assertDirectoryBoundary(memberStorageRoot, target);
      const current = fs.lstatSync(target);
      if (current.dev === owned.dev && current.ino === owned.ino)
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Leave changed or inaccessible paths for the operator. */
    }
    throw error;
  }
}

module.exports = { cloneProject };
