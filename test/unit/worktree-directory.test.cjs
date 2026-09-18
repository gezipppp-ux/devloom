const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeWorktreeDirectory, resolveWorktreeDirectory } = require("../../src/domain/worktree-directory.cjs");

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
