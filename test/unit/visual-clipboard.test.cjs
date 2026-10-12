const assert = require("node:assert/strict");
const { test } = require("node:test");

const source = "/api/projects/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222";
async function fixture() {
  const { createVisualClipboard } = await import("../../web/src/shared/components/visual-markdown-clipboard.js");
  const { visualMarkdownExtensions } = await import("../../web/src/shared/components/visual-markdown.js");
  const { getSchema } = await import("@tiptap/vue-3");
  const { EditorState, AllSelection } = await import("@tiptap/pm/state");
  const schema = getSchema(visualMarkdownExtensions());
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [
    schema.text("bold", [schema.marks.bold.create()]),
    schema.nodes.image.create({ src: source, alt: "proof" }),
    schema.text("after"),
  ])]);
  const view = {
    state: EditorState.create({ schema, doc, selection: new AllSelection(doc) }),
    editable: true,
    dispatch(transaction) { this.state = this.state.apply(transaction); },
    serializeForClipboard(slice) { return { dom: { innerHTML: "<p>fixture</p>" }, text: "boldafter", slice }; },
  };
  const data = new Map();
  const event = {
    preventDefault() {},
    clipboardData: {
      clearData() { data.clear(); },
      setData(type, value) { data.set(type, value); },
      getData(type) { return data.get(type) || ""; },
    },
  };
  let images = [{ source, url: `${source}?inline=1` }];
  const clipboard = createVisualClipboard(() => images);
  return { doc, view, event, clipboard, createVisualClipboard, removeImage() { images = []; } };
}

test("internal cut and paste preserves image identity and formatting", async () => {
  const { doc, view, event, clipboard } = await fixture();
  assert.equal(clipboard.cut(view, event), true);
  assert.equal(view.state.doc.textContent, "");
  assert.equal(clipboard.paste(view, event), true);
  assert.deepEqual(view.state.doc.toJSON(), doc.toJSON());
  clipboard.clear();
});

test("clipboard document cannot be injected through arbitrary MIME data", async () => {
  const { doc, view, event, clipboard } = await fixture();
  clipboard.copy(view, event);
  event.clipboardData.setData("application/x-web-coding-visual-selection", JSON.stringify({ type: "image", attrs: { src: "https://evil.test/image" } }));
  assert.equal(clipboard.paste(view, event), false);
  assert.deepEqual(view.state.doc.toJSON(), doc.toJSON());
  clipboard.clear();
});

test("clipboard cannot resurrect removed attachments or survive source context disposal", async () => {
  const { view, event, clipboard, removeImage } = await fixture();
  clipboard.copy(view, event);
  removeImage();
  assert.equal(clipboard.paste(view, event), false);
  clipboard.clear();
  assert.equal(clipboard.paste(view, event), false);
});

test("another field can paste approved images but not images missing in its attachment context", async () => {
  const { view, event, clipboard, createVisualClipboard } = await fixture();
  clipboard.copy(view, event);
  const missing = createVisualClipboard();
  assert.equal(missing.paste(view, event), false);
  missing.clear();
  const sameIssue = createVisualClipboard(() => [{ source, url: `${source}?inline=1` }]);
  assert.equal(sameIssue.paste(view, event), true);
  clipboard.clear();
  assert.equal(sameIssue.paste(view, event), false);
});
