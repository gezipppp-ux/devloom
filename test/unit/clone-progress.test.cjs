const assert = require("node:assert/strict");
const { test } = require("node:test");
const { cloneProgressParser } = require("../../src/git/clone-progress.cjs");

test("clone progress parses CR-delimited chunks and exposes only known stages and bounded percentages", () => {
  const events = [], parse = cloneProgressParser(value => events.push(value));
  parse("Cloning into 'secret-path'...\nremote: Counting objects: 100% (4/4), done.\nReceiv");
  parse("ing objects:  25% (1/4), 50 KiB | 1 MiB/s\rReceiving objects: 25% (1/4)\r");
  parse("remote: credential password=sensitive\nReceiving objects: 999%\nReceiving objects: 100% (4/4)\n");
  parse("Resolving deltas: 50%\rUpdating files: 100%\r");
  assert.deepEqual(events, [
    { stage: "counting", percent: 100 }, { stage: "receiving", percent: 25 },
    { stage: "receiving", percent: 100 }, { stage: "resolving", percent: 50 }, { stage: "checkout", percent: 100 },
  ]);
  parse("x".repeat(20000));
  parse("\nReceiving objects: 100%\n");
  assert.deepEqual(events.at(-1), { stage: "receiving", percent: 100 });
  assert.doesNotMatch(JSON.stringify(events), /secret|sensitive/);
});
