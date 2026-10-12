const assert = require("node:assert/strict");
const { test } = require("node:test");

const project = "11111111-1111-4111-8111-111111111111";
async function fixture() {
  const { effectScope, ref } = await import("vue");
  const { useProjectAttachments } =
    await import("../../web/src/features/projects/use-project-attachments.js");
  const scope = effectScope(),
    projectId = ref(project);
  const draft = scope.run(() => useProjectAttachments(projectId));
  return { draft, scope, projectId };
}
function file(name, data, type = "application/octet-stream") {
  return new globalThis.File([data], name, { type });
}

test("attachment draft keeps immutable upload payloads and only previews detected raster files", async () => {
  const { draft, scope } = await fixture();
  const { isDraftImageUrl } =
    await import("../../web/src/shared/api/attachment-drafts.js");
  try {
    const markdown = await draft.add([
      file(
        "<pic>[test].png",
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]),
      ),
      file("danger.svg", "<svg onload='alert(1)'/>", "image/png"),
    ]);
    assert.match(markdown, /!\[_pic__test_.png\]\(\/api\/projects\//);
    assert.match(markdown, /\n\[danger.svg\]/);
    assert.equal(draft.images.value.length, 1);
    const url = draft.images.value[0].url;
    assert.ok(isDraftImageUrl(url));
    const payload = draft.serialize();
    assert.deepEqual(Object.keys(payload[0]), [
      "id",
      "name",
      "mimeType",
      "data",
    ]);
    assert.equal(payload[0].mimeType, "image/png");
    assert.equal(
      Buffer.from(payload[1].data, "base64").toString(),
      "<svg onload='alert(1)'/>",
    );
    draft.remove(payload[0].id);
    assert.equal(isDraftImageUrl(url), false);
    assert.equal(draft.pending.value.length, 1);
  } finally {
    scope.stop();
  }
});

test("reset invalidates an outstanding file read and allows a new independent add", async () => {
  const { draft, scope } = await fixture();
  try {
    let resolve;
    const old = draft.add([
      {
        name: "old.txt",
        size: 1,
        arrayBuffer: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
    ]);
    assert.equal(draft.busy.value, true);
    assert.equal(await draft.add([file("ignored.txt", "x")]), "");
    draft.reset();
    await draft.add([file("new.txt", "new")]);
    resolve(new Uint8Array([1]).buffer);
    assert.equal(await old, "");
    assert.deepEqual(
      draft.pending.value.map((item) => item.name),
      ["new.txt"],
    );
    assert.equal(draft.busy.value, false);
  } finally {
    scope.stop();
  }
});

test("partial failures retain already accepted attachments and project changes revoke previews", async () => {
  const { draft, scope, projectId } = await fixture();
  const { isDraftImageUrl } =
    await import("../../web/src/shared/api/attachment-drafts.js");
  try {
    const markdown = await draft.add([
      file("good.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
      { name: "large", size: 11 * 1024 * 1024 },
    ]);
    assert.ok(markdown.startsWith("![good.png]"));
    assert.match(draft.error.value, /10 MiB/);
    assert.equal(draft.pending.value.length, 1);
    const url = draft.images.value[0].url;
    projectId.value = "22222222-2222-4222-8222-222222222222";
    assert.equal(draft.pending.value.length, 0);
    assert.equal(isDraftImageUrl(url), false);
    assert.equal(draft.error.value, "");
  } finally {
    scope.stop();
  }
});
