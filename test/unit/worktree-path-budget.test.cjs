const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { worktreePathIssue } = require("../../src/domain/worktree-path-budget.cjs");

function files(paths) {
  return paths.map((relativePath) => ({ path: relativePath, kind: "file" }));
}

test("Windows checkout budgets allow exact limits and reject the next UTF-16 character", () => {
  const root = "D:\\wt\\task";
  const name = "x".repeat(259 - root.length - 1);
  assert.equal(worktreePathIssue(root, files([name]), "win32"), null);
  assert.deepEqual(worktreePathIssue(root, files([`${name}界`]), "win32"), {
    relativePath: `${name}界`,
    kind: "file",
    pathLength: 260,
    limit: 259,
    maximumRootLength: root.length - 1,
  });
  const parent = "d".repeat(247 - root.length - 1);
  assert.equal(worktreePathIssue(root, files([`${parent}/x`]), "win32"), null);
  const directory = worktreePathIssue(root, files([`${parent}d/x`]), "win32");
  assert.equal(directory.kind, "directory");
  assert.equal(directory.pathLength, 248);
  assert.equal(directory.limit, 247);
  assert.equal(directory.maximumRootLength, root.length - 1);
});

test("path budgets report the most restrictive file or parent and preserve real names", () => {
  const root = `D:\\${"r".repeat(170)}`;
  const relativePath = `界 面/${"component-".repeat(12)}.vue`;
  const issue = worktreePathIssue(root, files(["short.txt", relativePath, "other.txt"]), "win32");
  assert.equal(issue.relativePath, relativePath);
  assert.equal(issue.pathLength, path.win32.join(root, relativePath).length);
  assert.equal(issue.maximumRootLength, 259 - relativePath.length - 1);
  assert.equal(worktreePathIssue(root, files([relativePath]), "linux"), null);
  assert.equal(worktreePathIssue(root, files([relativePath]), "darwin"), null);
  assert.equal(worktreePathIssue(`D:\\${"r".repeat(245)}`, [], "win32").kind, "directory");
});

test("path budgets handle UNC roots, root trailing separators and deep parents", () => {
  const root = "\\\\server\\share\\wt\\";
  const parent = "dir/" + "x".repeat(240);
  const issue = worktreePathIssue(root, files([`${parent}/a`]), "win32");
  assert.equal(issue.kind, "directory");
  assert.equal(issue.relativePath, parent);
  assert.equal(issue.pathLength, path.win32.join(root, parent).length);
  assert.equal(worktreePathIssue("C:\\", files(["x".repeat(256)]), "win32"), null);
  assert.equal(worktreePathIssue("C:\\", files(["x".repeat(257)]), "win32").pathLength, 260);
});

test("explicit tree and gitlink directories use the directory limit even without children", () => {
  const root = "D:\\wt\\task";
  const relativePath = "s".repeat(248 - root.length - 1);
  assert.equal(worktreePathIssue(root, files([relativePath]), "win32"), null);
  const issue = worktreePathIssue(root, [{ path: relativePath, kind: "directory" }], "win32");
  assert.equal(issue.kind, "directory");
  assert.equal(issue.pathLength, 248);
  assert.equal(issue.limit, 247);
});
