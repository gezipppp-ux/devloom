const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { createTapdChannel } = require("../../src/channels/tapd/adapter.cjs");
const { runKey, sourceFor } = require("../../src/domain/run-identity.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { session, temporary, png } = require("../support/helpers.cjs");

test("fusion validation preserves legacy identities and rejects duplicate, foreign, oversized and invalid selections before network", async t => {
  const root = temporary(t), configFile = path.join(root, "config.json");
  (await writeConfig(configFile, { workspace: { id: randomUUID() }, tapd: { session } }));
  const channel = createTapdChannel(configFile, { detail: () => assert.fail("validation must not fetch") });
  const input = { requestId: randomUUID(), workspace: "1", title: "融合", items: [{ id: "11" }] };
  const result = await channel.resolve(input);
  const key = runKey(sourceFor("tapd", result.item));
  assert.match(key, /^tapd-[0-9a-f]{32}$/);
  assert.equal(runKey(sourceFor("tapd", { workspace_id: "1", id: "11" })), "1-11");
  assert.equal(result.item.fusion_mode, undefined);
  const legacy = await channel.resolve({ ...input, fusionMode: "sequence" });
  assert.equal(legacy.item.fusion_mode, "sequence", "old payload fingerprints retain the supplied mode");
  for (const patch of [{ items: [] }, { items: Array(21).fill(input.items[0]) },
    { requestId: "../bad" }, { title: "" }, { fusionMode: "arbitrary" },
    { workspace: "2" }, { items: [{ id: "11", type: "story", workspace: "2" }] },
    { items: [input.items[0], input.items[0]] }, { items: [{ id: "../11", type: "story" }] },
    { items: [{ id: "11", type: "invalid" }] }])
    await assert.rejects(channel.resolve({ ...input, ...patch }));
});

test("ordered fusion renders its captured template once with raw sources and global image attribution", async t => {
  const root = temporary(t), configFile = path.join(root, "config.json");
  const config = { tapd: { session }, prompt_templates: {
    tapd: "单条模板不应混入\n{{title}}\n{{id}}\n{{content}}\n{{images}}\n{{supplement}}",
    tapd_fusion: "自定义融合约束\n{{title}} / {{workspace_id}} / {{requirement_count}}\n{{requirements}}\n{{images}}\n{{supplement}}",
  } };
  (await writeConfig(configFile, config));
  const channel = createTapdChannel(configFile, { detail: async (_, item) => ({ ...item, title: `标题 ${item.id}`,
    detail_url: `https://www.tapd.cn/1/prong/stories/view/${item.id}`,
    markdown_description: `正文 ${item.id} 保留 {{title}} $&\n![截图](data:image/png;base64,${png.toString("base64")})`,
  }) });
  const resolved = await channel.resolve({ requestId: randomUUID(), workspace: "1", title: "整体改造",
    supplementaryInstructions: "融合说明保留 {{images}} $&",
    items: [{ id: "12", type: "bug" }, { id: "11", type: "story" }] });
  (await writeConfig(configFile, { ...config, prompt_templates: { ...config.prompt_templates,
    tapd_fusion: config.prompt_templates.tapd_fusion.replace("自定义融合约束", "新模板") } }));
  const { task } = await channel.prepare({ ...resolved, directory: root });
  assert.deepEqual(task.requirements.map(entry => entry.workitem.id), ["12", "11"]);
  assert.equal(task.prompt.split("自定义融合约束").length - 1, 1);
  assert.doesNotMatch(task.prompt, /单条模板不应混入|新模板/);
  assert.match(task.prompt, /整体改造 \/ 1 \/ 2/);
  assert.ok(task.prompt.includes("正文 12 保留 {{title}} $&"));
  assert.ok(task.prompt.includes("融合说明保留 {{images}} $&"));
  assert.match(task.prompt, /来源：https:\/\/www.tapd.cn\/1\/prong\/stories\/view\/11/);
  assert.deepEqual(task.images.map(image => [image.index, image.source_id]), [[1, "12"], [2, "11"]]);
  for (const [index, source] of task.requirements.entries()) {
    assert.equal(source.prompt, undefined, "child snapshots contain raw materials without repeated execution rules");
    assert.ok(task.prompt.includes(source.workitem.markdown_description));
    assert.ok(task.prompt.includes(`图片 ${index + 1}（第 ${index + 1} 条需求 #${source.workitem.id}）：${source.images[0].path}`));
  }
  // Use the image service seam to exercise the aggregate limit independently
  // of per-source duplicate-URL normalization.
  const oversized = createTapdChannel(configFile, { detail: async (_, item) => item,
    prepareMaterials: async item => ({ execution_ready: true, workitem: item, content: "body",
      images: Array.from({ length: 11 }, (_, index) => ({ path: path.join(root, `${item.id}-${index}.png`) })) }) });
  await assert.rejects(oversized.prepare({ ...resolved, directory: root }), /超过 20 张/);
  const unavailable = createTapdChannel(configFile, { detail: async (_, item) => item,
    prepareMaterials: async () => { throw new Error("图片无法下载"); } });
  await assert.rejects(unavailable.prepare({ ...resolved, directory: root }), /图片无法下载/);
  const tooLong = createTapdChannel(configFile, { detail: async (_, item) => ({ ...item,
    markdown_description: "正文".repeat(65000) }) });
  await assert.rejects(tooLong.prepare({ ...resolved, directory: root }), /超过 240000 字/);
  const empty = createTapdChannel(configFile, { detail: async (_, item) => item });
  await assert.rejects(empty.prepare({ ...resolved, directory: root }), /缺少描述和图片/);
});
