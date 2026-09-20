const assert = require("node:assert/strict");
const { test } = require("node:test");
const { memberWorktreeDirectory, normalizeWorktreeDirectory, resolveWorktreeDirectory } = require("../../src/domain/worktree-directory.cjs");

test("member worktree directories use canonical account names without exposing path syntax", () => {
  for (const name of ["alice", "bob", "team.member-01", "member_name", "u-alice", "x".repeat(64)])
    assert.equal(memberWorktreeDirectory(name), name);
  assert.equal(memberWorktreeDirectory(" Alice "), "alice");
  for (const name of [undefined, null, 123, "", "ab", "x".repeat(65), "../alice", "a/b", "a\\b", "a:b", "a b", "user~636f6e", ".alice", "a\u0000b"])
    assert.throws(() => memberWorktreeDirectory(name), /账号|用户|所有者/, String(name));
});

test("portable hazards and the legacy UUID namespace have deterministic collision-free member names", () => {
  const reserved = "u-12345678-1234-4234-8234-123456789abc";
  const encodedNames = ["con", "con.txt", "prn", "aux", "nul", "com1", "com9.log", "lpt1", "lpt9.txt", "alice.", "member..", reserved];
  const names = ["alice", "bob", "conman", "com0", "com10", "lpt10", "u-alice", "u-12345678-1234-4234-8234-123456789abz", ...encodedNames];
  for (const name of encodedNames) {
    const expected = `user~${Buffer.from(name).toString("hex")}`;
    assert.equal(memberWorktreeDirectory(name), expected);
    assert.equal(memberWorktreeDirectory(name.toUpperCase()), expected);
    assert.equal(normalizeWorktreeDirectory(expected), expected);
    assert.equal(resolveWorktreeDirectory("D:\\trees", expected, "win32"), `D:\\trees\\${expected}`);
    assert.equal(resolveWorktreeDirectory("/trees", expected, "linux"), `/trees/${expected}`);
  }
  assert.equal(new Set(names.map(memberWorktreeDirectory)).size, names.length);
  assert.equal(names.some((name) => memberWorktreeDirectory(name) === reserved), false);
});

test("worktree directories join with exactly one host separator on POSIX and Windows", () => {
  for (const base of ["/root", "/root/"])
    assert.equal(resolveWorktreeDirectory(base, "123", "linux"), "/root/123");
  assert.equal(resolveWorktreeDirectory("/", "123", "linux"), "/123");
  assert.equal(resolveWorktreeDirectory("/root", "team\\项目 123", "linux"), "/root/team/项目 123");
  for (const base of ["D:\\root", "D:\\root\\", "D:/root/"])
    assert.equal(resolveWorktreeDirectory(base, "123", "win32"), "D:\\root\\123");
  assert.equal(resolveWorktreeDirectory("D:\\", "team/123", "win32"), "D:\\team\\123");
  assert.equal(resolveWorktreeDirectory("\\\\server\\share", "team\\123", "win32"), "\\\\server\\share\\team\\123");
  assert.equal(normalizeWorktreeDirectory("team\\project-a"), "team/project-a");
});

test("relative worktree directories reject absolute paths, traversal and portable filesystem hazards", () => {
  for (const directory of [
    undefined, null, 123, "", " ", "/123", "\\123", "D:/123", "D:123",
    "\\\\server\\share", ".", "..", "../123", "a/../b", "a/./b", "a//b", "a/",
    " a", "a ", "a.", "a/b ", "a\nb", "a\u0000b", "a\u007fb", "a:b", "a?b", "a*b",
    "CON", "aux.txt", "team/LPT1", "com9.log", "LPT¹", "x".repeat(241),
  ]) assert.throws(() => normalizeWorktreeDirectory(directory), /目录/, String(directory));
  for (const base of ["D:root", "\\root", "relative", ""])
    assert.throws(() => resolveWorktreeDirectory(base, "123", "win32"), /绝对路径/);
  assert.throws(() => resolveWorktreeDirectory("D:\\root", "123", "linux"), /绝对路径/);
});
