const { git, gitAsync } = require("./command.cjs");
const { repositoryGit, resolveCommit } = require("./repository.cjs");
const { samePath } = require("../shared/paths.cjs");
const { operationReason, registeredWorktrees } = require("./operation-state.cjs");
const { withGitAccount } = require("./account-credentials.cjs");

function localBranches(repository) {
  return git(repository, [
    "for-each-ref", "--format=%(refname)%00%(upstream)%00%(upstream:remotename)", "refs/heads",
  ]).split("\n").filter(Boolean).map((line) => {
    const [ref, upstream, remote] = line.replace(/\r$/, "").split("\0");
    return { ref, name: ref.slice(11), upstream: upstream || null, remote: remote || null };
  });
}

function readRepositoryStatus(value, baseRef = "HEAD") {
  const { repository } = repositoryGit(value);
  const remotes = git(repository, ["remote"]).split(/\r?\n/).filter(Boolean).map((name) => ({ name }));
  let current = null;
  try { current = git(repository, ["symbolic-ref", "--quiet", "HEAD"]); } catch { /* Detached HEAD. */ }
  const requested = baseRef === "HEAD" ? current : baseRef;
  const branch = localBranches(repository).find(({ ref, name }) => ref === requested || name === requested);
  const remote = remotes.some(({ name }) => name === branch?.remote)
    ? branch.remote
    : remotes.find(({ name }) => name === "origin")?.name || remotes[0]?.name || null;
  let updateReason = null;
  if (!branch) updateReason = "基准引用必须是本地分支；远程引用、标签和提交不能直接更新。";
  else if (branch.ref !== current) updateReason = "请先在仓库目录检出该基准分支，再更新基准分支。";
  else if (!branch.upstream || !remotes.some(({ name }) => name === branch.remote))
    updateReason = "基准分支尚未配置远端上游，请先在本地设置跟踪分支。";
  else if (registeredWorktrees(repository).find((tree) => samePath(tree.path, repository))?.locked)
    updateReason = "仓库目录已被 Git 锁定，请先解除锁定。";
  else if (git(repository, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
    updateReason = "仓库目录有未提交或未跟踪的文件，请先交由 Codex 或在本地处理。";
  else updateReason = operationReason(repository);
  return {
    repository, baseRef, branch: branch?.name || null, remote, remotes,
    upstream: branch?.upstream?.replace(/^refs\/remotes\//, "") || null,
    canUpdate: !updateReason, updateReason,
  };
}

function selectedRemote(repository, remote) {
  const remotes = git(repository, ["remote"]).split(/\r?\n/).filter(Boolean);
  const selected = remote || (remotes.includes("origin") ? "origin" : remotes[0]);
  if (typeof selected !== "string" || selected.startsWith("-") || !remotes.includes(selected))
    throw new Error("请选择仓库中已配置的远端。请先在本地配置远端仓库。");
  return selected;
}

async function fetchRepository(value, remote, credentials) {
  const { repository } = repositoryGit(value);
  const selected = selectedRemote(repository, remote);
  if (credentials && git(repository, ["remote", "get-url", "--all", selected]) !== credentials.remoteUrl)
    throw new Error("远端地址已变更，不能使用此工作区保存的 Git 账号。");
  try {
    if (credentials)
      await withGitAccount(credentials.account, credentials.remoteUrl, (run) => run(["-C", repository, "fetch", "--prune", "--", selected]));
    else await gitAsync(repository, ["fetch", "--prune", "--", selected]);
  } catch {
    throw new Error("获取远端更新失败，请检查网络、远端地址及服务端 Git 凭据；操作不会弹出登录窗口。");
  }
  return { remote: selected, fetchedAt: new Date().toISOString() };
}

async function updateBaseBranch(value, baseRef = "HEAD", remote, credentials, authorize = async () => {}) {
  const before = readRepositoryStatus(value, baseRef);
  if (!before.canUpdate) throw new Error(before.updateReason);
  const selected = selectedRemote(before.repository, remote || before.remote);
  if (selected !== before.remote) throw new Error("更新基准分支必须使用该分支已配置的远端上游。");
  const head = git(before.repository, ["rev-parse", "--verify", "HEAD"]);
  const fetched = await fetchRepository(before.repository, selected, credentials);
  await authorize();
  const current = readRepositoryStatus(before.repository, baseRef);
  if (!current.canUpdate) throw new Error(current.updateReason);
  if (current.branch !== before.branch || current.upstream !== before.upstream ||
      git(before.repository, ["rev-parse", "--verify", "HEAD"]) !== head)
    throw new Error("获取更新期间仓库分支已发生变化，请刷新后重试。");
  const upstream = localBranches(before.repository).find((branch) => branch.name === current.branch).upstream;
  const commit = resolveCommit(before.repository, upstream);
  try {
    await authorize();
    await gitAsync(before.repository, ["merge", "--ff-only", "--no-edit", "--no-overwrite-ignore", "--", commit]);
  } catch {
    throw new Error("无法快进更新基准分支。分支可能已分叉，或文件阻止更新，请交由 Codex 或在本地处理。");
  }
  return { ...fetched, branch: current.branch, head: git(before.repository, ["rev-parse", "HEAD"]) };
}

module.exports = { readRepositoryStatus, fetchRepository, updateBaseBranch };
