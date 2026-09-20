function publicGitAccount(account) {
  return {
    id: account.id,
    name: account.name,
    authType: account.authType,
    remoteUrl: account.remoteUrl,
    username: account.username || "",
    publicKey: account.publicKey || "",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
module.exports = { publicGitAccount };
