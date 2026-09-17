const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { absolutePath, samePath } = require("../shared/paths.cjs");

function repositoryGit(value) {
  const repository = fs.realpathSync(absolutePath(value, "代码仓库"));
  const git = (args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (
    !samePath(
      fs.realpathSync(git(["rev-parse", "--show-toplevel"])),
      repository,
    )
  )
    throw new Error("请选择 Git 仓库根目录。");
  return { repository, git };
}
function listBaseRefs(value) {
  const { git } = repositoryGit(value);
  const output = git([
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname)%00%(objecttype)%00%(*objecttype)%00%(symref)",
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);
  const refs = output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [ref, type, targetType, symbolic] = line.trim().split("\0");
      if (symbolic || (type !== "commit" && targetType !== "commit")) return [];
      const kind = ref.startsWith("refs/heads/")
        ? "local"
        : ref.startsWith("refs/remotes/")
          ? "remote"
          : "tag";
      const name = ref.replace(/^refs\/(heads|remotes|tags)\//, "");
      return [
        {
          value: ref,
          label: `${{ local: "本地分支", remote: "远程分支", tag: "标签" }[kind]} · ${name}`,
          kind,
          name,
        },
      ];
    });
  return [
    { value: "HEAD", label: "HEAD · 当前检出提交", kind: "head", name: "HEAD" },
    ...refs,
  ];
}
module.exports = { repositoryGit, listBaseRefs };
