const assert = require('node:assert/strict');
const { test } = require('node:test');
const { absolutePath, samePath } = require('../../src/shared/paths.cjs');

test('Windows paths require an explicit drive or UNC share and compare extended namespaces consistently', () => {
  for (const value of ['\\worktrees', '/worktrees', 'C:worktrees', '\\\\server', '//server'])
    assert.throws(() => absolutePath(value, 'root', 'win32'), /绝对路径/);
  for (const value of ['D:\\项目 files', '\\\\server\\share\\项目 files', '\\\\?\\C:\\项目 files'])
    assert.equal(absolutePath(value, 'root', 'win32'), value);
  assert.equal(samePath('C:\\Projects\\Repo', '\\\\?\\c:\\projects\\repo', 'win32'), true);
  assert.equal(samePath('\\\\Server\\Share\\Repo', '\\\\?\\UNC\\server\\share\\repo', 'win32'), true);
  assert.equal(samePath('C:\\Repo', 'D:\\Repo', 'win32'), false);
});

test('Linux validation preserves significant Unicode and trailing spaces without folding case', () => {
  assert.equal(absolutePath('/srv/项目 files ', 'root', 'linux'), '/srv/项目 files ');
  assert.equal(samePath('/srv/项目 files ', '/srv/项目 files', 'linux'), false);
  assert.equal(samePath('/srv/Repo', '/srv/repo', 'linux'), false);
  assert.throws(() => absolutePath('C:\\repo', 'root', 'linux'), /绝对路径/);
});
