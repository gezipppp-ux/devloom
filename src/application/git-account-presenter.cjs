function publicGitAccount(account) {
  return {
    id: account.id,
    name: account.name,
    authType: account.authType,
    host: account.host,
    authorName: account.authorName || "",
    authorEmail: account.authorEmail || "",
    revision: account.revision,
    username: account.username || "",
    publicKey: account.publicKey || "",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
module.exports = { publicGitAccount };
