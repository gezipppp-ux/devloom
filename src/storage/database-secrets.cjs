const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");

function loadEncryptionKey(dataRoot) {
  if (process.env.RUNNER_ENCRYPTION_KEY) {
    if (!/^[a-f0-9]{64}$/i.test(process.env.RUNNER_ENCRYPTION_KEY))
      throw new Error("RUNNER_ENCRYPTION_KEY 必须是 64 位十六进制密钥。");
    return Buffer.from(process.env.RUNNER_ENCRYPTION_KEY, "hex");
  }
  const file = path.join(dataRoot, "secrets", "database.key");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw new Error("数据库凭据主密钥无效。");
  return key;
}

function encodeSettings(value, key) {
  const copy = structuredClone(value);
  if (copy.tapd?.session) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(copy.tapd.session), "utf8"), cipher.final()]);
    copy.tapd.session = { encrypted: 1, nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
  }
  return JSON.stringify(copy);
}

function decodeSettings(serialized, key) {
  const value = JSON.parse(serialized);
  const secret = value.tapd?.session;
  if (secret?.encrypted === 1) {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    value.tapd.session = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(secret.data, "base64")), decipher.final(),
    ]).toString("utf8"));
  }
  return value;
}

module.exports = { loadEncryptionKey, encodeSettings, decodeSettings };
