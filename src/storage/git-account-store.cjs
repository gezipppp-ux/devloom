const { randomUUID } = require("node:crypto");
const { encodeSecret, decodeSecret } = require("./database-secrets.cjs");
const { accountError } = require("../domain/account.cjs");

class GitAccountStore {
  constructor(database) {
    this.db = database.handle;
    this.key = database.encryptionKey;
  }
  decode(row) {
    if (!row) throw accountError("Git 账号不存在。", 404);
    return {
      id: row.id,
      name: row.name,
      authType: row.auth_type,
      remoteUrl: row.remote_url,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...decodeSecret(row.credentials, this.key),
    };
  }
  list(userId) {
    return this.db
      .prepare(
        "SELECT * FROM user_git_accounts WHERE user_id=? ORDER BY name,id",
      )
      .all(userId)
      .map((row) => this.decode(row));
  }
  read(id, userId) {
    return this.decode(
      this.db
        .prepare("SELECT * FROM user_git_accounts WHERE id=? AND user_id=?")
        .get(id, userId),
    );
  }
  save(userId, value, previous, keyDraftId) {
    return this.db
      .transaction(() => {
        const id = previous?.id || randomUUID(),
          now = new Date().toISOString();
        const credentials =
          value.authType === "http"
            ? { username: value.username, password: value.password }
            : {
                sshPrivateKey: value.sshPrivateKey,
                publicKey: value.publicKey,
              };
        try {
          if (previous) {
            const updated = this.db
              .prepare(
                "UPDATE user_git_accounts SET name=?,auth_type=?,remote_url=?,credentials=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
              )
              .run(
                value.name,
                value.authType,
                value.remoteUrl,
                encodeSecret(credentials, this.key),
                now,
                id,
                userId,
                previous.revision,
              );
            if (!updated.changes)
              throw accountError(
                "Git 账号在检测期间已更改，请刷新后重试。",
                409,
              );
          } else
            this.db
              .prepare(
                "INSERT INTO user_git_accounts(id,user_id,name,auth_type,remote_url,credentials,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)",
              )
              .run(
                id,
                userId,
                value.name,
                value.authType,
                value.remoteUrl,
                encodeSecret(credentials, this.key),
                now,
                now,
              );
          if (
            keyDraftId &&
            !this.db
              .prepare(
                "DELETE FROM git_key_drafts WHERE id=? AND user_id=? AND expires_at>?",
              )
              .run(keyDraftId, userId, Date.now()).changes
          )
            throw accountError("SSH 密钥草稿已失效，请重新生成。", 409);
        } catch (error) {
          if (error.code === "SQLITE_CONSTRAINT_UNIQUE")
            throw accountError("同名 Git 账号已存在。", 409);
          throw error;
        }
        return this.read(id, userId);
      })
      .immediate();
  }
  createKeyDraft(userId, keyPair) {
    return this.db
      .transaction(() => {
        this.db
          .prepare(
            "DELETE FROM git_key_drafts WHERE expires_at<=? OR user_id=?",
          )
          .run(Date.now(), userId);
        const id = randomUUID(),
          expiresAt = Date.now() + 86400000;
        this.db
          .prepare(
            "INSERT INTO git_key_drafts(id,user_id,credentials,expires_at) VALUES (?,?,?,?)",
          )
          .run(id, userId, encodeSecret(keyPair, this.key), expiresAt);
        return { id, publicKey: keyPair.publicKey, expiresAt };
      })
      .immediate();
  }
  keyDraft(id, userId) {
    const row = this.db
      .prepare(
        "SELECT credentials FROM git_key_drafts WHERE id=? AND user_id=? AND expires_at>?",
      )
      .get(id, userId, Date.now());
    if (!row) throw accountError("SSH 密钥草稿已失效，请重新生成。", 404);
    return decodeSecret(row.credentials, this.key);
  }
  remove(id, userId) {
    return this.db
      .transaction(() => {
        const referenced = this.db
          .prepare(
            "SELECT s.data FROM workspace_settings s JOIN workspaces w ON w.id=s.workspace_id WHERE w.owner_user_id=?",
          )
          .all(userId)
          .some(({ data }) => JSON.parse(data).codex?.git_account_id === id);
        if (referenced)
          throw accountError("该 Git 账号仍被工作区使用，不能删除。", 409);
        if (
          !this.db
            .prepare("DELETE FROM user_git_accounts WHERE id=? AND user_id=?")
            .run(id, userId).changes
        )
          throw accountError("Git 账号不存在。", 404);
      })
      .immediate();
  }
}
module.exports = { GitAccountStore };
