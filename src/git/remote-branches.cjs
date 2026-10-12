const { git, gitAsync } = require("./command.cjs");
const { withGitAccount } = require("./account-credentials.cjs");

function parseRemoteBranches(output) {
  const branches = new Map();
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/heads\/(.+)$/.exec(line);
    if (!match) throw new Error("Git 返回的远端分支列表无效，请刷新后重试。");
    branches.set(match[2], { name: match[2], commit: match[1] });
  }
  return [...branches.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function listRemoteBranches(repository, credentials) {
  const remote = "origin";
  let address;
  try { address = git(repository, ["remote", "get-url", "--all", remote]); }
  catch { throw new Error("开发仓库未配置 origin 远端。"); }
  const verify = () => {
    if (git(repository, ["remote", "get-url", "--all", remote]) !== address ||
        (credentials && address !== credentials.remoteUrl))
      throw new Error("远端地址已变更，不能使用此工作区保存的 Git 账号。");
  };
  verify();
  let output;
  const args = ["ls-remote", "--heads", "--refs", "--", remote];
  if (credentials) output = await withGitAccount(credentials.account, credentials.remoteUrl, run => {
    verify();
    return run(["-C", repository, ...args], { timeout: 30000 });
  });
  else {
    try { output = await gitAsync(repository, args, { timeout: 30000 }); }
    catch { throw new Error("读取远端分支失败，请检查网络、Git 账号和仓库访问权限。"); }
  }
  verify();
  return { branches: parseRemoteBranches(output), fetchedAt: new Date().toISOString() };
}

module.exports = { listRemoteBranches, parseRemoteBranches };
