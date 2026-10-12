const fs = require("node:fs");
const path = require("node:path");
const { git: gitCommand } = require("./command.cjs");
const { absolutePath, samePath } = require("../shared/paths.cjs");

function repositoryGit(value) {
  const repository = fs.realpathSync.native(absolutePath(value, "代码仓库"));
  const git = (args) =>
    gitCommand(repository, args, { timeout: 10000 });
  if (
    !samePath(
      fs.realpathSync.native(git(["rev-parse", "--show-toplevel"])),
      repository,
    )
  )
    throw new Error("请选择 Git 仓库根目录。");
  return { repository, git };
}

function repositoryCommonDirectory(repository) {
  return fs.realpathSync.native(gitCommand(repository, [
    "rev-parse", "--path-format=absolute", "--git-common-dir",
  ], { timeout: 10000 }));
}

function repositoryRoot(repository) {
  return path.resolve(gitCommand(repository, ["rev-parse", "--show-toplevel"]));
}

function resolveCommit(repository, ref) {
  const commit = gitCommand(repository, [
    "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`,
  ]);
  if (!/^[a-f\d]{40,64}$/i.test(commit))
    throw new Error("Git did not return a valid base commit.");
  return commit;
}
function listBaseBranches(value) {
  const { git } = repositoryGit(value);
  const output = git([
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname)%00%(objecttype)%00%(*objecttype)%00%(symref)",
    "refs/remotes/origin",
  ]);
  const refs = output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [ref, type, targetType, symbolic] = line.trim().split("\0");
      if (symbolic || (type !== "commit" && targetType !== "commit")) return [];
      const name = ref.replace(/^refs\/remotes\/origin\//, "");
      return [
        {
          value: name,
          label: `origin/${name}`,
          name,
        },
      ];
    });
  return refs;
}
module.exports = { repositoryGit, repositoryCommonDirectory, repositoryRoot, resolveCommit, listBaseBranches };
