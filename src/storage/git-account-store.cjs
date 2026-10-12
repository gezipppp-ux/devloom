const { randomUUID } = require("node:crypto");
const { encodeSecret, decodeSecret } = require("./database-secrets.cjs");
const { accountError } = require("../domain/account.cjs");

class GitAccountStore {
  constructor(database) { this.database = database; this.key = database.encryptionKey; }

  async decode(row) {
    if (!row) throw accountError("Git 账号不存在。", 404);
    return { id: row.id, name: row.name, authType: row.authType, remoteUrl: row.remoteUrl, host: row.host, authorName: row.authorName, authorEmail: row.authorEmail, revision: row.revision,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), ...decodeSecret(row.credentials, this.key) };
  }

  async list(userId) {
    return (await Promise.all((await this.database.client.gitAccount.findMany({ where: { userId }, orderBy: [{ name: "asc" }, { id: "asc" }] }))
      .map(async (row) => (await this.decode(row)))));
  }

  async read(id, userId) {
    return (await this.decode(await this.database.client.gitAccount.findFirst({ where: { id, userId } })));
  }

  async isReferenced(id, userId) {
    if (await this.database.client.developmentSpace.count({ where: { gitAccountId: id, userId } })) return true;
    return await this.database.client.workspaceSetting.count({ where: {
      workspace: { ownerUserId: userId }, data: { path: ["execution", "gitAccountId"], equals: id },
    } }) > 0;
  }

  async save(userId, value, previous, keyDraftId) {
    try {
      return await this.database.transaction(async () => {
        const id = previous?.id || randomUUID();
        const credentials = value.authType === "http" ? { username: value.username, password: value.password }
          : { sshPrivateKey: value.sshPrivateKey, publicKey: value.publicKey };
        const data = { name: value.name, authType: value.authType, remoteUrl: "", host: value.host || "", authorName: value.authorName || "", authorEmail: value.authorEmail || "",
          credentials: encodeSecret(credentials, this.key) };
        if (previous) {
          if ((previous.authType !== value.authType || previous.host !== value.host) && await this.isReferenced(id, userId))
            throw accountError("该 Git 账号仍被开发空间使用，不能切换主机或认证方式；请新建其他账号。", 409);
          const updated = await this.database.client.gitAccount.updateMany({ where: { id, userId, revision: previous.revision },
            data: { ...data, revision: { increment: 1 } } });
          if (!updated.count) throw accountError("Git 账号在检测期间已更改，请刷新后重试。", 409);
        } else {
          await this.database.client.gitAccount.create({ data: { id, userId, ...data } });
        }
        if (keyDraftId && !(await this.database.client.gitKeyDraft.deleteMany({
          where: { id: keyDraftId, userId, expiresAt: { gt: new Date() } },
        })).count) throw accountError("SSH 密钥草稿已失效，请重新生成。", 409);
        return (await this.read(id, userId));
      });
    } catch (error) {
      if (error.code === "P2002") throw accountError("同名 Git 账号已存在。", 409);
      if (error.code === "P2034") throw accountError("Git 账号数据已变更，请刷新后重试。", 409);
      throw error;
    }
  }

  async createKeyDraft(userId, keyPair) {
    return this.database.transaction(async () => {
      await this.database.client.gitKeyDraft.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lte: new Date() } }] } });
      const id = randomUUID();
      const expiresAt = Date.now() + 86400000;
      await this.database.client.gitKeyDraft.create({ data: { id, userId, credentials: encodeSecret(keyPair, this.key), expiresAt: new Date(expiresAt) } });
      return { id, publicKey: keyPair.publicKey, expiresAt };
    });
  }

  async keyDraft(id, userId) {
    const row = await this.database.client.gitKeyDraft.findFirst({ where: { id, userId, expiresAt: { gt: new Date() } } });
    if (!row) throw accountError("SSH 密钥草稿已失效，请重新生成。", 404);
    return decodeSecret(row.credentials, this.key);
  }

  async remove(id, userId) {
    return this.database.transaction(async () => {
      if (await this.isReferenced(id, userId)) throw accountError("该 Git 账号仍被工作区使用，不能删除。", 409);
      if (!(await this.database.client.gitAccount.deleteMany({ where: { id, userId } })).count)
        throw accountError("Git 账号不存在。", 404);
    });
  }
}

module.exports = { GitAccountStore };
