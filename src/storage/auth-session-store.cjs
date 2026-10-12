const { createHash, randomBytes } = require("node:crypto");

function sessionKey(sid) { return createHash("sha256").update(sid).digest("hex"); }

function deliver(operation, callback) {
  Promise.resolve().then(operation).then((value) => callback(null, value), callback);
}

class AuthSessionStore {
  constructor(database) { this.database = database; }

  async signingSecret() {
    // Empty-update upserts may be emulated by Prisma with a read then insert.
    // A native conflict-ignoring insert protects concurrent server startup.
    await this.database.client.authMetadata.createMany({
      data: [{ name: "cookie-secret", value: randomBytes(48).toString("hex") }], skipDuplicates: true,
    });
    const row = await this.database.client.authMetadata.findUniqueOrThrow({ where: { name: "cookie-secret" } });
    return row.value;
  }

  set(sid, session, callback) {
    deliver(async () => {
      const expiresAt = new Date(session.cookie.expires || Date.now() + 12 * 60 * 60 * 1000);
      const copy = { ...session };
      delete copy.sessionId;
      delete copy.encryptedSessionId;
      // Session plugins may supply Date instances; persist their JSON form.
      const data = JSON.parse(JSON.stringify(copy));
      const record = { data, expiresAt, userId: session.userId || null };
      await this.database.client.authSession.upsert({ where: { sid: sessionKey(sid) },
        create: { sid: sessionKey(sid), ...record }, update: record });
      await this.database.client.authSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    }, callback);
  }

  get(sid, callback) {
    deliver(async () => {
      const row = await this.database.client.authSession.findUnique({ where: { sid: sessionKey(sid) } });
      return row && row.expiresAt.getTime() > Date.now() ? row.data : null;
    }, callback);
  }

  destroy(sid, callback) {
    deliver(async () => { await this.database.client.authSession.deleteMany({ where: { sid: sessionKey(sid) } }); }, callback);
  }

  async valid(sid, userId) {
    return await this.database.client.authSession.count({ where: { sid: sessionKey(sid), userId, expiresAt: { gt: new Date() } } }) > 0;
  }
}

module.exports = { AuthSessionStore };
