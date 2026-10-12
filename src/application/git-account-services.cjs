const { GitAccountStore } = require("../storage/git-account-store.cjs");
const {
  validateGitAccount,
  gitAccountId,
  resolveAccountRemote,
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
      projects,
    } = {},
  ) {
    this.store = new GitAccountStore(database);
    this.checkConnection = checkConnection;
    this.generateKeyPair = generateKeyPair;
    this.projects = projects;
  }
  async list(actor) {
    return (await this.store.list(actor.id)).map(publicGitAccount);
  }
  async generateKey(actor, authorize) {
    const keyPair = await this.generateKeyPair();
    await authorize?.();
    return (await this.store.createKeyDraft(actor.id, keyPair));
  }
  async candidate(actor, input, id) {
    const value = validateGitAccount(input);
    const previous = id
      ? (await this.store.read(gitAccountId(id), actor.id))
      : undefined;
    if (previous && value.revision !== previous.revision) throw accountError("Git 账号已变更，请使用当前修订号保存。", 409);
    if (value.authType === "http") {
      if (!value.password && previous?.authType === "http")
        value.password = previous.password;
      if (!value.password) throw accountError("请填写密码或访问令牌。");
    } else {
      const keyPair = value.keyDraftId
        ? (await this.store.keyDraft(value.keyDraftId, actor.id))
        : previous;
      if (!keyPair?.sshPrivateKey)
        throw accountError("请先生成 SSH 密钥，并将公钥添加到 Git 服务。");
      value.sshPrivateKey = keyPair.sshPrivateKey;
      value.publicKey = keyPair.publicKey;
    }
    return { value, previous };
  }
  async check(actor, input, id) {
    const { projectId, ...draft } = input;
    const context = await this.projects.authorize(projectId, actor, "code.operate");
    const value = id && !Object.keys(draft).length ? await this.store.read(gitAccountId(id), actor.id) : (await this.candidate(actor, draft, id)).value;
    const remote = resolveAccountRemote(value, context.project.remoteUrl);
    await this.checkConnection(value, remote);
    const current = await this.projects.authorize(projectId, actor, "code.operate");
    if (current.project.revision !== context.project.revision)
      throw accountError("项目或仓库在检测期间已变更，请重试。", 409);
    return { ok: true };
  }
  async save(actor, input, id, authorize) {
    const { value, previous } = (await this.candidate(actor, input, id));
    await authorize?.();
    return publicGitAccount(
      (await this.store.save(actor.id, value, previous, value.keyDraftId)),
    );
  }
  async remove(actor, id) {
    (await this.store.remove(gitAccountId(id), actor.id));
  }
}
module.exports = { GitAccountServices };
