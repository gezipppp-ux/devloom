<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import { EditorState } from "@tiptap/pm/state";
import {
  BoldOutlined,
  ItalicOutlined,
  FontSizeOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  CodeOutlined,
  UndoOutlined,
  RedoOutlined,
} from "@antdv-next/icons";
import MarkdownContent from "./MarkdownContent.vue";
import { createVisualClipboard } from "./visual-markdown-clipboard.js";
import {
  equivalentMarkdown,
  hasMarkdownHtml,
  normalizeVisualDocument,
  plainTextPasteTransaction,
  visualMarkdownExtensions,
} from "./visual-markdown.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  images: { type: Array, default: () => [] },
  disabled: Boolean,
  busy: Boolean,
  label: { type: String, default: "正文" },
  contextKey: { type: [String, Number], default: "" },
  rows: { type: Number, default: 8 },
  inputId: { type: String, default: "" },
  active: { type: Boolean, default: true },
});
const emit = defineEmits(["update:modelValue", "files", "source-request"]);
const incompatible = ref(false),
  imageViews = new Set(),
  insertions = new Set();
const clipboard = createVisualClipboard(() => props.images);
let generation = 0,
  lastEmitted = null,
  loading = false;
const editor = useEditor({
  extensions: visualMarkdownExtensions({
    getImages: () => props.images,
    imageViews,
  }),
  content: "",
  editable: !props.disabled,
  editorProps: {
    attributes: {
      class: "visual-markdown-content tiptap",
      role: "textbox",
      "aria-multiline": "true",
    },
    // Browser rich HTML is untrusted; paste its plain-text representation.
    transformPastedHTML: () => "",
    handleDOMEvents: { copy: clipboard.copy, cut: clipboard.cut },
    handlePaste(view, event) {
      const files = Array.from(event.clipboardData?.files || []);
      const text = event.clipboardData?.getData("text/plain") || "";
      if (props.disabled || incompatible.value) return true;
      if (clipboard.paste(view, event)) return true;
      // Register the insertion before the text transaction so its bookmark follows
      // the replaced selection, even when a clipboard contains both text and files.
      if (files.length && !props.busy)
        emit("files", { files, insert: captureInsertion() });
      if (text) view.dispatch(plainTextPasteTransaction(view.state, text));
      return true;
    },
  },
  onCreate() {
    syncContent(props.modelValue);
    syncAttributes();
  },
  onTransaction({ transaction }) {
    for (const insertion of insertions)
      insertion.bookmark = insertion.bookmark.map(transaction.mapping);
  },
  onUpdate({ editor: current }) {
    if (loading || incompatible.value) return;
    lastEmitted = current.getMarkdown();
    emit("update:modelValue", lastEmitted);
  },
});
function syncContent(value) {
  const current = editor.value;
  if (!current) return;
  clipboard.clear();
  loading = true;
  try {
    // Avoid feeding arbitrary HTML to the extension's HTML parser at all.
    if (hasMarkdownHtml(value)) {
      incompatible.value = true;
      current.commands.clearContent(false);
    } else {
      const parsed = normalizeVisualDocument(current.markdown.parse(value));
      const serialized = current.markdown.serialize(parsed);
      incompatible.value = !equivalentMarkdown(value, serialized);
      current.commands.setContent(incompatible.value ? "" : parsed, {
        emitUpdate: false,
      });
    }
  } catch {
    incompatible.value = true;
    current.commands.clearContent(false);
  } finally {
    // External replacements are new baselines: undo must not resurrect removed
    // attachments or the empty document that preceded the initial server load.
    const nextState = EditorState.create({
      doc: current.state.doc,
      schema: current.schema,
      plugins: current.state.plugins,
    });
    // Tiptap Vue maintains a reactive state mirror through this event; updating
    // only the ProseMirror view would leave can().undo() and commands stale.
    current.emit("beforeTransaction", {
      editor: current,
      transaction: nextState.tr,
      nextState,
    });
    current.view.updateState(nextState);
    current.setEditable(!props.disabled && !incompatible.value, false);
    loading = false;
  }
}
function syncAttributes() {
  editor.value?.setOptions({
    editorProps: {
      attributes: {
        class: "visual-markdown-content tiptap",
        role: "textbox",
        "aria-multiline": "true",
        ...(props.active
          ? { id: props.inputId, "aria-label": props.label }
          : { "aria-hidden": "true" }),
      },
    },
  });
}
function captureInsertion() {
  const current = editor.value;
  if (!current || incompatible.value) return () => {};
  const insertion = {
    generation,
    bookmark: current.state.selection.getBookmark(),
  };
  insertions.add(insertion);
  let used = false;
  return (markdown) => {
    insertions.delete(insertion);
    if (
      used ||
      !markdown ||
      generation !== insertion.generation ||
      !editor.value ||
      props.disabled ||
      incompatible.value
    )
      return;
    used = true;
    const selection = insertion.bookmark.resolve(editor.value.state.doc);
    const parsed = normalizeVisualDocument(
      editor.value.markdown.parse(markdown),
    );
    editor.value
      .chain()
      .focus()
      .insertContentAt({ from: selection.from, to: selection.to }, parsed)
      .run();
  };
}
function insertMarkdown(markdown) {
  captureInsertion()(markdown);
}
function focus() {
  editor.value?.commands.focus();
}
const controls = computed(() => [
  {
    name: "粗体",
    icon: BoldOutlined,
    action: () => editor.value.chain().focus().toggleBold().run(),
    active: editor.value?.isActive("bold"),
  },
  {
    name: "斜体",
    icon: ItalicOutlined,
    action: () => editor.value.chain().focus().toggleItalic().run(),
    active: editor.value?.isActive("italic"),
  },
  {
    name: "二级标题",
    icon: FontSizeOutlined,
    action: () =>
      editor.value.chain().focus().toggleHeading({ level: 2 }).run(),
    active: editor.value?.isActive("heading", { level: 2 }),
  },
  {
    name: "无序列表",
    icon: UnorderedListOutlined,
    action: () => editor.value.chain().focus().toggleBulletList().run(),
    active: editor.value?.isActive("bulletList"),
  },
  {
    name: "有序列表",
    icon: OrderedListOutlined,
    action: () => editor.value.chain().focus().toggleOrderedList().run(),
    active: editor.value?.isActive("orderedList"),
  },
  {
    name: "代码块",
    icon: CodeOutlined,
    action: () => editor.value.chain().focus().toggleCodeBlock().run(),
    active: editor.value?.isActive("codeBlock"),
  },
  {
    name: "撤销",
    icon: UndoOutlined,
    disabled: !editor.value?.can().undo(),
    action: () => editor.value.chain().focus().undo().run(),
  },
  {
    name: "重做",
    icon: RedoOutlined,
    disabled: !editor.value?.can().redo(),
    action: () => editor.value.chain().focus().redo().run(),
  },
]);
watch(
  () => props.modelValue,
  (value) => {
    if (value !== lastEmitted) syncContent(value);
    lastEmitted = null;
  },
);
watch(
  () => props.disabled,
  (value) => editor.value?.setEditable(!value && !incompatible.value, false),
);
watch(() => [props.active, props.label, props.inputId], syncAttributes);
watch(
  () => props.images,
  () => {
    for (const refresh of imageViews) refresh();
  },
  { deep: true },
);
watch(
  () => props.contextKey,
  async () => {
    generation++;
    clipboard.clear();
    insertions.clear();
    lastEmitted = null;
    const expected = generation;
    await nextTick();
    if (expected !== generation || !editor.value) return;
    syncContent(props.modelValue);
  },
  { flush: "sync" },
);
onBeforeUnmount(() => {
  generation++;
  clipboard.clear();
  insertions.clear();
});
const canInsert = computed(
  () =>
    Boolean(editor.value) &&
    !incompatible.value &&
    !props.disabled &&
    !props.busy,
);
defineExpose({ captureInsertion, insertMarkdown, focus, canInsert });
</script>
<template>
  <div class="visual-markdown-editor" :style="{ '--editor-rows': rows }">
    <template v-if="incompatible">
      <p class="visual-markdown-compatibility" role="status">
        {{ $t("这段内容含有需保留的 Markdown 语法，已保留原文。") }}<button
          type="button"
          @click="emit('source-request')"
        >
          {{ $t("使用 Markdown 源码编辑") }}
        </button>
      </p>
      <MarkdownContent :content="modelValue" :images="images" />
    </template>
    <template v-else>
      <div
        class="visual-markdown-toolbar"
        role="toolbar"
        :aria-label="$t('{p0}格式', { p0: label })"
      >
        <button
          v-for="control in controls"
          :key="control.name"
          type="button"
          :aria-label="$t(control.name)"
          :title="$t(control.name)"
          :aria-pressed="control.active"
          :disabled="disabled || control.disabled"
          @mousedown.prevent
          @click="control.action"
        >
          <component :is="control.icon" aria-hidden="true" />
        </button>
      </div>
      <EditorContent :editor="editor" />
    </template>
  </div>
</template>
