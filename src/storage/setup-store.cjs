const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const { accountError } = require("../domain/account.cjs");
const { SETUP_ID } = require("../domain/setup-state.cjs");

class SetupStore {
  constructor(database) { this.database = database; }
  async read() { return this.database.client.systemSetup.findUniqueOrThrow({ where: { id: SETUP_ID } }); }
  async transaction(operation) {
    try { return await this.database.transaction(operation); }
    catch (error) {
      if (["P2034", "P2002"].includes(error.code)) throw accountError("初始化资料已变更，请重新加载后继续。", 409, "REVISION_CONFLICT");
      throw error;
    }
  }
  async issueToken() {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const issued = await this.transaction(async () => {
      const row = await this.read();
      if (row.status !== "awaiting_admin" || row.initialAdminId || await this.database.client.user.count()) return false;
      await this.update(row.revision, { tokenHash: createHash("sha256").update(token).digest("hex"), tokenExpiresAt: expiresAt });
      return true;
    });
    return issued ? { token, expiresAt } : null;
  }
  async verifyToken(row, token) {
    const actual = createHash("sha256").update(token).digest();
    const expected = Buffer.from(row.tokenHash || "", "hex");
    if (row.status !== "awaiting_admin" || row.initialAdminId || !row.tokenExpiresAt || row.tokenExpiresAt.getTime() <= Date.now() ||
        actual.length !== expected.length || !timingSafeEqual(actual, expected) || await this.database.client.user.count())
      throw accountError("初始化凭证无效或已过期，请从服务终端获取新链接；已创建账号请直接登录。", 403, "SETUP_TOKEN_INVALID");
  }
  fingerprint(step, value) {
    // Keyed fingerprints protect low-entropy initial passwords in idempotency records.
    const sorted = input => Array.isArray(input) ? input.map(sorted) : input && typeof input === "object"
      ? Object.fromEntries(Object.keys(input).sort().map(key => [key, sorted(input[key])])) : input;
    return createHmac("sha256", this.database.encryptionKey).update(JSON.stringify(sorted({ step, skip: Boolean(value.skip), value: value.value || {} }))).digest("hex");
  }
  async reused(requestId, step, inputHash) {
    const previous = await this.database.client.setupOperation.findUnique({ where: { requestId } });
    if (!previous) return false;
    if (previous.step !== step || previous.inputHash !== inputHash) throw accountError("重复请求的初始化内容不一致。", 409, "REQUEST_CONFLICT");
    return true;
  }
  async record(requestId, step, inputHash) { await this.database.client.setupOperation.create({ data: { requestId, step, inputHash } }); }
  async update(revision, data) {
    const result = await this.database.client.systemSetup.updateMany({ where: { id: SETUP_ID, revision }, data: { ...data, revision: { increment: 1 } } });
    if (!result.count) throw accountError("初始化进度已变更，请重新加载。", 409, "REVISION_CONFLICT");
  }
  async resources(row) {
    const departmentIds = Object.values(row.steps.departments?.data || {});
    const accountIds = row.steps.accounts?.data?.map(account => account.id) || [];
    return {
      admin: row.initialAdminId ? await this.database.client.user.findUnique({ where: { id: row.initialAdminId } }) : null,
      departments: await this.database.client.department.findMany({ where: { id: { in: departmentIds } } }),
      accounts: await this.database.client.user.findMany({ where: { id: { in: accountIds } } }),
      project: row.steps.project?.data?.id ? await this.database.client.project.findUnique({ where: { id: row.steps.project.data.id } }) : null,
    };
  }
}
module.exports = { SetupStore };
