<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import { PaperClipOutlined, FileTextOutlined, CloseOutlined } from "@antdv-next/icons";
import MarkdownContent from "./MarkdownContent.vue";
import FeedbackMessage from "./FeedbackMessage.vue";
const VisualMarkdownEditor = shallowRef(null), visualLoadError = ref(false);
let mounted = true;
import("./VisualMarkdownEditor.vue").then(module => {
  if (mounted) VisualMarkdownEditor.value = module.default;
}).catch(() => { if (mounted) visualLoadError.value = true; });
const props = defineProps({
  modelValue: { type: String, default: "" }, label: { type: String, default: "正文" },
  disabled: Boolean, required: Boolean, rows: { type: Number, default: 8 },
  images: { type: Array, default: () => [] }, attachments: { type: Array, default: () => [] },
  error: { type: String, default: "" }, busy: Boolean, contextKey: { type: [String, Number], default: "" },
  accept: { type: String, default: "" },
  attachmentLabel: { type: String, default: "待保存附件" },
  attachmentHint: { type: String, default: "随内容一起保存" },
  uploadHint: { type: String, default: "单个附件最多 10 MiB，每次合计 20 MiB。" },
  attachButtonLabel: { type: String, default: "添加附件" },
  showHelp: { type: Boolean, default: true },
});
const emit = defineEmits(["update:modelValue", "files", "remove"]);
const id = useId(), textarea = ref(null), visual = ref(null), picker = ref(null), mode = ref("write");
const modes = [["write", "写作"], ["source", "Markdown源码"], ["preview", "预览"]];
const sourceMode = computed(() => mode.value === "source" || (mode.value === "write" && visualLoadError.value));
const canAttach = computed(() => !props.disabled && !props.busy && (mode.value !== "write" || sourceMode.value || Boolean(visual.value?.canInsert)));
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
  const insert = mode.value === "write" && !sourceMode.value ? visual.value.captureInsertion() : captureSourceInsertion();
  emit("files", { files: Array.from(files), insert });
}
function paste(event) {
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length || props.disabled || props.busy) return;
  if (!event.clipboardData.getData("text/plain")) event.preventDefault();
  filesSelected(files);
}
function focusEditor() { if (sourceMode.value) textarea.value?.focus(); else if (mode.value === "write") visual.value?.focus(); }
function sizeLabel(size) { return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.ceil(size / 1024))} KiB`; }
watch(() => props.contextKey, () => { generation++; mode.value = "write"; selection = { start: 0, end: 0 }; }, { flush: "sync" });
onBeforeUnmount(() => { mounted = false; generation++; });
</script>
<template>
  <div class="markdown-editor" :class="{ 'is-disabled': disabled }" :style="{ '--editor-rows': rows }" role="group" :aria-label="$t('{p0}编辑器', { p0: $t(label) })">
    <label :for="mode === 'preview' ? undefined : id" @click="focusEditor">{{ $t(label) }}</label>
    <div class="markdown-editor-surface">
      <div class="markdown-editor-toolbar">
        <div class="markdown-editor-modes" :aria-label="$t('{p0}编辑模式', { p0: $t(label) })">
          <button v-for="[value, title] in modes" :key="value" type="button" :aria-pressed="mode === value" :disabled="busy" @click="mode = value">{{ $t(title) }}</button>
        </div>
        <button class="markdown-attach-button" type="button" :disabled="!canAttach" @click="picker.click()"><PaperClipOutlined aria-hidden="true" />{{ busy ? $t("读取附件中…") : $t(attachButtonLabel) }}</button>
        <input ref="picker" type="file" :accept="accept" multiple hidden :disabled="!canAttach" @change="filesSelected($event.target.files); $event.target.value = ''" />
      </div>
      <VisualMarkdownEditor v-if="VisualMarkdownEditor" v-show="mode === 'write'" ref="visual" :model-value="modelValue" :label="$t(label)" :input-id="id" :active="mode === 'write'" :images="images" :disabled="disabled" :busy="busy" :rows="rows" :context-key="contextKey" @update:model-value="emit('update:modelValue', $event)" @files="emit('files', $event)" @source-request="mode = 'source'" />
      <div v-if="mode === 'write' && !VisualMarkdownEditor && !visualLoadError" class="markdown-editor-loading" role="status">{{ $t("正在加载写作编辑器，可切换到 Markdown 源码继续编辑。") }}</div>
      <p v-if="mode === 'write' && visualLoadError" class="markdown-editor-load-error" role="status">{{ $t("写作编辑器加载失败，已使用 Markdown 源码编辑，内容可正常保存。") }}</p>
      <textarea v-if="sourceMode" :id="id" ref="textarea" class="markdown-source" :value="modelValue" :aria-label="$t(label)" :disabled="disabled || busy" :required="required" :rows="rows" maxlength="60000" spellcheck="false" @input="emit('update:modelValue', $event.target.value)" @select="remember" @click="remember" @keyup="remember" @blur="remember" @paste="paste"></textarea>
      <div v-if="mode === 'preview'" class="markdown-editor-preview"><MarkdownContent v-if="modelValue" :content="modelValue" :images="images" /><span v-else class="muted">{{ $t("暂无内容") }}</span></div>
    </div>
    <span v-if="showHelp" class="markdown-editor-help">{{ mode === 'source' ? $t("正在编辑 Markdown 源码，可切回写作查看图片。") : $t("直接粘贴图片，或添加附件；图片与文字一起编辑。") }}</span>
    <div v-if="attachments.length" class="markdown-attachment-section">
      <div class="markdown-attachment-heading"><span>{{ $t(attachmentLabel) }}</span><span>{{ attachments.length }} {{ $t("个 ·") }} {{ $t(attachmentHint) }}</span></div>
      <ul class="markdown-attachments">
        <li v-for="item in attachments" :key="item.id">
          <img v-if="item.previewUrl" class="markdown-attachment-thumbnail" :src="item.previewUrl" alt="" />
          <span v-else class="markdown-attachment-icon"><FileTextOutlined aria-hidden="true" /></span>
          <span class="markdown-attachment-info"><strong :title="item.name">{{ item.name }}</strong><small>{{ sizeLabel(item.size) }}</small></span>
          <button class="markdown-remove-attachment" type="button" :disabled="disabled || busy" :aria-label="$t('移除附件 {p0}', { p0: item.name })" :title="$t('移除附件 {p0}', { p0: item.name })" @click="emit('remove', item.id)"><CloseOutlined aria-hidden="true" /></button>
        </li>
      </ul>
    </div>
    <span v-if="showHelp" class="markdown-editor-help markdown-upload-limit">{{ $t(uploadHint) }}</span>
    <FeedbackMessage :message="error" type="error" />
  </div>
</template>
