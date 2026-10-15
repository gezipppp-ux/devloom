const assert = require("node:assert/strict");
const { test } = require("node:test");

test("person options match names, usernames, full pinyin and initials without exposing IDs", async () => {
  const { filterPinyinOption } = await import("../../web/src/shared/components/pinyin-search.js");
  const person = { value: "private-user-id", label: "张三（dev-01）" };
  for (const query of ["", "  ", "张", "张三", "DEV-01", "zhangsan", " ZS ", "zhang san", "张s", "zsan"])
    assert.equal(filterPinyinOption(query, person), true, query);
  for (const query of ["李四", "lisi", "ls", "private-user-id", "zsx"])
    assert.equal(filterPinyinOption(query, person), false, query);
  assert.equal(filterPinyinOption("someone", undefined), false);
});

test("person search handles polyphonic surnames and ü/v spellings", async () => {
  const { filterPinyinOption } = await import("../../web/src/shared/components/pinyin-search.js");
  for (const [label, queries] of [["单明（user-02）", ["shanming", "sm"]], ["曾乐（user-03）", ["zengle", "zl"]], ["吕布（user-04）", ["lvbu", "lübu", "lb"]]])
    for (const query of queries) assert.equal(filterPinyinOption(query, { label }), true, `${label}: ${query}`);
});
