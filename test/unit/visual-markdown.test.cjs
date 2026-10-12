const assert = require("node:assert/strict");
const { test } = require("node:test");

async function markdown() {
  const { MarkdownManager } = await import("@tiptap/markdown");
  const helper =
    await import("../../web/src/shared/components/visual-markdown.js");
  return {
    ...helper,
    manager: new MarkdownManager({
      extensions: helper.visualMarkdownExtensions(),
    }),
  };
}
test("visual editor round trips formatting, tables, code and inline attachment images", async () => {
  const { manager, equivalentMarkdown } = await markdown();
  const documents = [
    "# 标题\n\n**粗体**和*斜体*，~~删除~~。\n\n> 引用\n\n- 第一项\n- 第二项\n\n1. one\n2. two",
    "图片前![粘贴图片](/api/projects/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222)图片后",
    "| 列一 | 列二 |\n| --- | --- |\n| 正文 | 内容 |",
    "```js\nconst tag = '<script>';\n```\n\n[文档](/api/projects/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222)",
  ];
  for (const source of documents)
    assert.equal(
      equivalentMarkdown(source, manager.serialize(manager.parse(source))),
      true,
      source,
    );
});
test("standalone and nested images fit the inline schema without losing line breaks", async () => {
  const {
    manager,
    normalizeVisualDocument,
    equivalentMarkdown,
    visualMarkdownExtensions,
  } = await markdown();
  const { getSchema } = await import("@tiptap/vue-3");
  const schema = getSchema(visualMarkdownExtensions());
  for (const source of [
    "![image](attachment)",
    "before\n![image](attachment)\nafter",
    "before\n\n![image](attachment)",
    "> ![image](attachment)",
    "- ![image](attachment)",
  ]) {
    const document = normalizeVisualDocument(manager.parse(source));
    assert.doesNotThrow(() => schema.nodeFromJSON(document).check());
    assert.equal(
      equivalentMarkdown(source, manager.serialize(document)),
      true,
      source,
    );
  }
});
test("lossy conversions are detected and raw HTML is never accepted for visual parsing", async () => {
  const { manager, equivalentMarkdown, hasMarkdownHtml } = await markdown();
  assert.equal(
    equivalentMarkdown(
      "- [x] completed",
      manager.serialize(manager.parse("- [x] completed")),
    ),
    false,
  );
  for (const source of [
    "<img src='https://evil.test/image.png' onerror='alert(1)'>",
    "hello <strong>raw HTML</strong>",
    "<script>alert(1)</script>",
  ]) {
    assert.equal(hasMarkdownHtml(source), true);
    assert.equal(equivalentMarkdown(source, source), false);
  }
  assert.equal(
    hasMarkdownHtml("```html\n<script>safe code</script>\n```"),
    false,
  );
});
test("visual image URLs require both a source mapping and a registered safe target", async () => {
  const { visualImageUrl } = await markdown();
  const { createDraftImageUrl, revokeDraftImageUrl } =
    await import("../../web/src/shared/api/attachment-drafts.js");
  const source =
    "/api/projects/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222";
  assert.equal(visualImageUrl(source, []), "");
  for (const url of [
    "https://evil.test/a.png",
    "data:image/png;base64,aA==",
    "blob:unregistered",
    source,
    `${source}?inline=1&extra=true`,
  ])
    assert.equal(visualImageUrl(source, [{ source, url }]), "");
  assert.equal(
    visualImageUrl(source, [{ source, url: `${source}?inline=1` }]),
    `${source}?inline=1`,
  );
  const url = createDraftImageUrl(
    new globalThis.Blob(["png"], { type: "image/png" }),
  );
  assert.equal(visualImageUrl(source, [{ source, url }]), url);
  revokeDraftImageUrl(url);
  assert.equal(visualImageUrl(source, [{ source, url }]), "");
});
test("visual image serialization never persists blob or data preview URLs", async () => {
  const { manager } = await markdown();
  for (const src of ["blob:preview", "data:image/png;base64,aA=="]) {
    const serialized = manager.serialize({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src, alt: "图片" } }],
        },
      ],
    });
    assert.equal(serialized, "图片");
  }
});

test("rich clipboard plain text replaces only the selection and preserves line breaks without parsing HTML", async () => {
  const { plainTextPasteTransaction, visualMarkdownExtensions } =
    await markdown();
  const { getSchema } = await import("@tiptap/vue-3");
  const { EditorState, TextSelection } = await import("@tiptap/pm/state");
  const schema = getSchema(visualMarkdownExtensions());
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("before SELECT after")]),
  ]);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 8, 14),
  });
  const transaction = plainTextPasteTransaction(
    state,
    "第一行\r\n<script>literal</script>\n第三行",
  );
  const next = state.apply(transaction);
  assert.equal(
    next.doc.textBetween(0, next.doc.content.size, "\n"),
    "before 第一行\n<script>literal</script>\n第三行 after",
  );
  assert.equal(next.doc.childCount, 3);
  assert.equal(transaction.getMeta("paste"), true);
  assert.equal(
    next.doc.descendants((node) => assert.notEqual(node.type.name, "image")),
    undefined,
  );
});

test("plain text clipboard keeps code-block newlines and surrounding marks", async () => {
  const { plainTextPasteTransaction, visualMarkdownExtensions } =
    await markdown();
  const { getSchema } = await import("@tiptap/vue-3");
  const { EditorState, TextSelection } = await import("@tiptap/pm/state");
  const schema = getSchema(visualMarkdownExtensions());
  const code = schema.node("doc", null, [
    schema.node("codeBlock", null, [schema.text("x")]),
  ]);
  const state = EditorState.create({
    schema,
    doc: code,
    selection: TextSelection.create(code, 2),
  });
  const next = state.apply(plainTextPasteTransaction(state, "\nif (a < b) {}"));
  assert.equal(next.doc.firstChild.type.name, "codeBlock");
  assert.equal(next.doc.firstChild.textContent, "x\nif (a < b) {}");
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("bold", [schema.marks.bold.create()]),
    ]),
  ]);
  const boldState = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 3),
  });
  const boldNext = boldState.apply(
    plainTextPasteTransaction(boldState, "中文"),
  );
  assert.equal(boldNext.doc.firstChild.textContent, "bo中文ld");
  assert.equal(boldNext.doc.firstChild.firstChild.marks[0].type.name, "bold");
});
