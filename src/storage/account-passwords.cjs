const {
  randomBytes,
  scrypt: deriveKey,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");
const { password } = require("../domain/account.cjs");

const scrypt = promisify(deriveKey);

async function hashPassword(value) {
  password(value);
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(value, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${key.toString("hex")}`;
}

async function verifyPassword(value, encoded) {
  if (typeof value !== "string" || value.length > 256) return false;
  const parts = String(encoded || "").split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "16384" ||
    parts[2] !== "8" ||
    parts[3] !== "1"
  )
    return false;
  const key = await scrypt(value, parts[4], 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(parts[5], "hex");
  return expected.length === key.length && timingSafeEqual(key, expected);
}

module.exports = { hashPassword, verifyPassword };
