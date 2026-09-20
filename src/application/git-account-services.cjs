const { GitAccountStore } = require("../storage/git-account-store.cjs");
const {
  validateGitAccount,
  gitAccountId,
} = require("../domain/git-account.cjs");
const { accountError } = require("../domain/account.cjs");
const { testGitConnection } = require("../git/account-credentials.cjs");
const { generateSshKeyPair } = require("../git/ssh-key-pair.cjs");
const { publicGitAccount } = require("./git-account-presenter.cjs");

class GitAccountServices {
  constructor(
    database,
    {
      checkConnection = testGitConnection,
      generateKeyPair = generateSshKeyPair,
    } = {},
  ) {
    this.store = new GitAccountStore(database);
    this.checkConnection = checkConnection;
    this.generateKeyPair = generateKeyPair;
  }
  list(actor) {
    return this.store.list(actor.id).map(publicGitAccount);
  }
  async generateKey(actor, authorize) {
    const keyPair = await this.generateKeyPair();
    authorize?.();
    return this.store.createKeyDraft(actor.id, keyPair);
  }
  candidate(actor, input, id) {
    const value = validateGitAccount(input);
    const previous = id
      ? this.store.read(gitAccountId(id), actor.id)
      : undefined;
    if (value.authType === "http") {
      if (!value.password && previous?.authType === "http")
        value.password = previous.password;
      if (!value.password) throw accountError("请填写密码或访问令牌。");
    } else {
      const keyPair = value.keyDraftId
        ? this.store.keyDraft(value.keyDraftId, actor.id)
        : previous;
      if (!keyPair?.sshPrivateKey)
        throw accountError("请先生成 SSH 密钥，并将公钥添加到 Git 服务。");
      value.sshPrivateKey = keyPair.sshPrivateKey;
      value.publicKey = keyPair.publicKey;
    }
    return { value, previous };
  }
  async check(actor, input, id) {
    const { value } = this.candidate(actor, input, id);
    await this.checkConnection(value, value.remoteUrl);
    return { ok: true };
  }
  async save(actor, input, id, authorize) {
    const { value, previous } = this.candidate(actor, input, id);
    await this.checkConnection(value, value.remoteUrl);
    authorize?.();
    return publicGitAccount(
      this.store.save(actor.id, value, previous, value.keyDraftId),
    );
  }
  remove(actor, id) {
    this.store.remove(gitAccountId(id), actor.id);
  }
}
module.exports = { GitAccountServices };
