const { createHash, randomBytes } = require("node:crypto");

function sessionKey(sid) {
  return createHash("sha256").update(sid).digest("hex");
}

class AuthSessionStore {
  constructor(database) {
    this.db = database.handle;
  }
  signingSecret() {
    return this.db
      .transaction(() => {
        let row = this.db
          .prepare("SELECT value FROM auth_metadata WHERE name='cookie-secret'")
          .get();
        if (!row) {
          row = { value: randomBytes(48).toString("hex") };
          this.db
            .prepare(
              "INSERT INTO auth_metadata(name,value) VALUES ('cookie-secret',?)",
            )
            .run(row.value);
        }
        return row.value;
      })
      .immediate();
  }
  set(sid, session, callback) {
    try {
      const expires = new Date(
        session.cookie.expires || Date.now() + 12 * 60 * 60 * 1000,
      ).getTime();
      const copy = { ...session };
      // The plaintext bearer id is never persisted inside the session JSON.
      delete copy.sessionId;
      delete copy.encryptedSessionId;
      this.db
        .prepare(
          "INSERT INTO auth_sessions(sid,session_json,expires_at,user_id) VALUES (?,?,?,?) ON CONFLICT(sid) DO UPDATE SET session_json=excluded.session_json,expires_at=excluded.expires_at,user_id=excluded.user_id",
        )
        .run(
          sessionKey(sid),
          JSON.stringify(copy),
          expires,
          session.userId || null,
        );
      this.db
        .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
        .run(Date.now());
      callback();
    } catch (error) {
      callback(error);
    }
  }
  get(sid, callback) {
    try {
      const row = this.db
        .prepare(
          "SELECT session_json,expires_at FROM auth_sessions WHERE sid=?",
        )
        .get(sessionKey(sid));
      if (!row || row.expires_at <= Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.session_json));
    } catch (error) {
      callback(error);
    }
  }
  destroy(sid, callback) {
    try {
      this.db
        .prepare("DELETE FROM auth_sessions WHERE sid=?")
        .run(sessionKey(sid));
      callback();
    } catch (error) {
      callback(error);
    }
  }
  valid(sid, userId) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM auth_sessions WHERE sid=? AND user_id=? AND expires_at>?",
        )
        .get(sessionKey(sid), userId, Date.now()),
    );
  }
}
module.exports = { AuthSessionStore };
