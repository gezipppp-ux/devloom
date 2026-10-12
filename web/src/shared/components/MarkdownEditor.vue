<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { PaperClipOutlined, FileTextOutlined, CloseOutlined } from "@antdv-next/icons";
import MarkdownContent from "./MarkdownContent.vue";
const VisualMarkdownEditor = defineAsyncComponent(() => import("./VisualMarkdownEditor.vue"));
const props = defineProps({
  modelValue: { type: String, default: "" }, label: { type: String, default: "正文" },
  disabled: Boolean, required: Boolean, rows: { type: Number, default: 8 },
  images: { type: Array, default: () => [] }, attachments: { type: Array, default: () => [] },
  error: { type: String, default: "" }, busy: Boolean, contextKey: { type: [String, Number], default: "" },
});
const emit = defineEmits(["update:modelValue", "files", "remove"]);
const id = useId(), textarea = ref(null), visual = ref(null), picker = ref(null), mode = ref("write");
const modes = [["write", "写作"], ["source", "Markdown源码"], ["preview", "预览"]];
const canAttach = computed(() => !props.disabled && !props.busy && (mode.value !== "write" || Boolean(visual.value?.canInsert)));
let generation = 0, selection = { start: 0, end: 0 };
function remember() {
  if (textarea.value) selection = { start: textarea.value.selectionStart, end: textarea.value.selectionEnd };
}
function captureSourceInsertion() {
  remember();
  if (!textarea.value) selection = { start: props.modelValue.length, end: props.modelValue.length };
  const current = generation, cursor = { ...selection }, original = props.modelValue;
  return async markdown => {
    if (!markdown || current !== generation || props.disabled) return;
    const value = props.modelValue;
    const start = value === original ? cursor.start : Math.min(cursor.start, value.length);
    const end = value === original ? cursor.end : start;
    const insertion = `${start && value[start - 1] !== "\n" ? "\n" : ""}${markdown}\n`;
    emit("update:modelValue", value.slice(0, start) + insertion + value.slice(end));
    await nextTick();
    if (current !== generation) return;
    textarea.value?.focus();
    textarea.value?.setSelectionRange(start + insertion.length, start + insertion.length);
  };
}
function filesSelected(files) {
  if (!canAttach.value || !files.length) return;
  const insert = mode.value === "write" ? visual.value.captureInsertion() : captureSourceInsertion();
  emit("files", { files: Array.from(files), insert });
}
function paste(event) {
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length || props.disabled || props.busy) return;
  if (!event.clipboardData.getData("text/plain")) event.preventDefault();
  filesSelected(files);
}
function focusEditor() { if (mode.value === "write") visual.value?.focus(); }
function sizeLabel(size) { return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.ceil(size / 1024))} KiB`; }
watch(() => props.contextKey, () => { generation++; mode.value = "write"; selection = { start: 0, end: 0 }; }, { flush: "sync" });
onBeforeUnmount(() => { generation++; });
</script>
<template>
  <div class="markdown-editor" :class="{ 'is-disabled': disabled }" role="group" :aria-label="`${label}编辑器`">
    <label :for="mode === 'preview' ? undefined : id" @click="focusEditor">{{ label }}</label>
    <div class="markdown-editor-surface">
      <div class="markdown-editor-toolbar">
        <div class="markdown-editor-modes" :aria-label="`${label}编辑模式`">
          <button v-for="[value, title] in modes" :key="value" type="button" :aria-pressed="mode === value" :disabled="busy" @click="mode = value">{{ title }}</button>
        </div>
        <button class="markdown-attach-button" type="button" :disabled="!canAttach" @click="picker.click()"><PaperClipOutlined aria-hidden="true" />{{ busy ? '读取附件中…' : '添加图片 / 附件' }}</button>
        <input ref="picker" type="file" multiple hidden :disabled="!canAttach" @change="filesSelected($event.target.files); $event.target.value = ''" />
      </div>
      <VisualMarkdownEditor v-show="mode === 'write'" ref="visual" :model-value="modelValue" :label="label" :input-id="id" :active="mode === 'write'" :images="images" :disabled="disabled" :busy="busy" :rows="rows" :context-key="contextKey" @update:model-value="emit('update:modelValue', $event)" @files="emit('files', $event)" @source-request="mode = 'source'" />
      <textarea v-if="mode === 'source'" :id="id" ref="textarea" class="markdown-source" :value="modelValue" :aria-label="label" :disabled="disabled || busy" :required="required" :rows="rows" maxlength="60000" spellcheck="false" @input="emit('update:modelValue', $event.target.value)" @select="remember" @click="remember" @keyup="remember" @blur="remember" @paste="paste"></textarea>
      <div v-if="mode === 'preview'" class="markdown-editor-preview"><MarkdownContent v-if="modelValue" :content="modelValue" :images="images" /><span v-else class="muted">暂无内容</span></div>
    </div>
    <span class="markdown-editor-help">{{ mode === 'source' ? '正在编辑 Markdown 源码，可切回写作查看图片。' : '直接粘贴图片，或添加附件；图片与文字一起编辑。' }}</span>
    <div v-if="attachments.length" class="markdown-attachment-section">
      <div class="markdown-attachment-heading"><span>待保存附件</span><span>{{ attachments.length }} 个 · 随内容一起保存</span></div>
      <ul class="markdown-attachments">
        <li v-for="item in attachments" :key="item.id">
          <img v-if="item.previewUrl" class="markdown-attachment-thumbnail" :src="item.previewUrl" alt="" />
          <span v-else class="markdown-attachment-icon"><FileTextOutlined aria-hidden="true" /></span>
          <span class="markdown-attachment-info"><strong :title="item.name">{{ item.name }}</strong><small>{{ sizeLabel(item.size) }}</small></span>
          <button class="markdown-remove-attachment" type="button" :disabled="disabled || busy" :aria-label="`移除附件 ${item.name}`" :title="`移除附件 ${item.name}`" @click="emit('remove', item.id)"><CloseOutlined aria-hidden="true" /></button>
        </li>
      </ul>
    </div>
    <span class="markdown-editor-help markdown-upload-limit">单个附件最多 10 MiB，每次合计 20 MiB。</span>
    <p v-if="error" role="alert" class="markdown-editor-error">{{ error }}</p>
  </div>
</template>
