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

function encodeSecret(value, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ encrypted: 1, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
}

function decodeSecret(serialized, key) {
  const secret = JSON.parse(serialized);
  if (secret?.encrypted !== 1 || typeof secret.nonce !== "string" || typeof secret.tag !== "string" || typeof secret.data !== "string")
    throw new Error("Git 凭据加密数据无效。");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(secret.data, "base64")), decipher.final(),
  ]).toString("utf8"));
}

module.exports = { loadEncryptionKey, encodeSecret, decodeSecret };
