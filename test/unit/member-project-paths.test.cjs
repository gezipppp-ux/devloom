const assert = require("node:assert/strict");
const { test } = require("node:test");
const { projectDirectoryName, memberDirectoryName, validateDirectoryName, resolveProjectDirectory } = require("../../src/domain/member-project-paths.cjs");

test("project directories use portable Git basenames and bounded collision suffixes", () => {
  for (const remote of ["https://gitee.com/____gezi/web-coding.git", "git@gitee.com:____gezi/web-coding.git", "ssh://git@gitee.com/____gezi/web-coding.git", "https://git.example/team/web-coding.git/"])
    assert.equal(projectDirectoryName(remote), "web-coding");
  assert.equal(projectDirectoryName("https://git.example/team/Web-Coding.git", "a1b2c3d4"), "Web-Coding-a1b2c3d4");
  assert.equal(projectDirectoryName("https://git.example/team/repo.git", "a1b2c3d4-2"), "repo-a1b2c3d4-2");
  assert.equal(projectDirectoryName(`https://git.example/${"r".repeat(120)}.git`, "a1b2c3d4").length, 120);
  for (const name of ["CON", "nul.txt", "repo.", "%2fescape", "..", "r".repeat(121)])
    assert.throws(() => projectDirectoryName(`https://git.example/team/${name}.git`), /目录/);
  assert.throws(() => projectDirectoryName("https://git.example/repo.git", "../bad"), /后缀/);
});

test("member worktree directories use canonical account names without exposing path syntax", () => {
  for (const name of ["alice", "bob", "team.member-01", "member_name", "u-alice", "x".repeat(64)])
    assert.equal(memberDirectoryName(name), name);
  assert.equal(memberDirectoryName(" Alice "), "alice");
  for (const name of [undefined, null, 123, "", "ab", "x".repeat(65), "../alice", "a/b", "a\\b", "a:b", "a b", "user~636f6e", ".alice", "a\u0000b"])
    assert.throws(() => memberDirectoryName(name), /账号|用户|所有者/, String(name));
});

test("portable hazards have deterministic collision-free member names without legacy namespace rules", () => {
  const reserved = "u-12345678-1234-4234-8234-123456789abc";
  const encodedNames = ["con", "con.txt", "prn", "aux", "nul", "com1", "com9.log", "lpt1", "lpt9.txt", "alice.", "member.."];
  const names = ["alice", "bob", "conman", "com0", "com10", "lpt10", "u-alice", "u-12345678-1234-4234-8234-123456789abz", ...encodedNames];
  for (const name of encodedNames) {
    const expected = `user~${Buffer.from(name).toString("hex")}`;
    assert.equal(memberDirectoryName(name), expected);
    assert.equal(memberDirectoryName(name.toUpperCase()), expected);
    assert.equal(validateDirectoryName(expected), expected);
    assert.equal(resolveProjectDirectory("D:\\trees", expected, "win32"), `D:\\trees\\${expected}`);
    assert.equal(resolveProjectDirectory("/trees", expected, "linux"), `/trees/${expected}`);
  }
  assert.equal(new Set(names.map(memberDirectoryName)).size, names.length);
  assert.equal(memberDirectoryName(reserved), reserved);
});

test("worktree directories join with exactly one host separator on POSIX and Windows", () => {
  for (const base of ["/root", "/root/"])
    assert.equal(resolveProjectDirectory(base, "123", "linux"), "/root/123");
  assert.equal(resolveProjectDirectory("/", "123", "linux"), "/123");
  assert.equal(resolveProjectDirectory("/root", "项目 123", "linux"), "/root/项目 123");
  for (const base of ["D:\\root", "D:\\root\\", "D:/root/"])
    assert.equal(resolveProjectDirectory(base, "123", "win32"), "D:\\root\\123");
  assert.equal(resolveProjectDirectory("D:\\", "123", "win32"), "D:\\123");
  assert.equal(resolveProjectDirectory("\\\\server\\share", "123", "win32"), "\\\\server\\share\\123");
  assert.throws(() => validateDirectoryName("team\\project-a"), /目录/);
});

test("relative worktree directories reject absolute paths, traversal and portable filesystem hazards", () => {
  for (const directory of [
    undefined, null, 123, "", " ", "/123", "\\123", "D:/123", "D:123",
    "\\\\server\\share", ".", "..", "../123", "a/../b", "a/./b", "a//b", "a/",
    " a", "a ", "a.", "a/b ", "a\nb", "a\u0000b", "a\u007fb", "a:b", "a?b", "a*b",
    "CON", "aux.txt", "team/LPT1", "com9.log", "LPT¹", "x".repeat(241),
  ]) assert.throws(() => validateDirectoryName(directory), /目录/, String(directory));
  for (const base of ["D:root", "\\root", "relative", ""])
    assert.throws(() => resolveProjectDirectory(base, "123", "win32"), /绝对路径/);
  assert.throws(() => resolveProjectDirectory("D:\\root", "123", "linux"), /绝对路径/);
});
