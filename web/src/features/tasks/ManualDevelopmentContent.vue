<script setup>
import { computed, onUnmounted, ref } from "vue";
import MarkdownEditor from "../../shared/components/MarkdownEditor.vue";
import { uploadManualImage } from "../../shared/api/api.js";
import { createDraftImageUrl, revokeDraftImageUrl } from "../../shared/api/attachment-drafts.js";

const props = defineProps({ modelValue: { type: String, default: "" }, imageIds: { type: Array, default: () => [] }, disabled: Boolean });
const emit = defineEmits(["update:modelValue", "update:imageIds", "uploading", "validity-change"]);
const attachments = ref([]), busy = ref(false), error = ref("");
const images = computed(() => attachments.value.map(item => ({ source: item.source, url: item.previewUrl })));
let alive = true;
onUnmounted(() => {
  alive = false;
  for (const item of attachments.value) revokeDraftImageUrl(item.previewUrl);
});
async function add({ files, insert }) {
  if (!alive || busy.value || props.disabled) return;
  error.value = "";
  if (attachments.value.length + files.length > 20) { error.value = "最多上传 20 张图片。"; emit("validity-change", false); return; }
  busy.value = true;
  emit("uploading", true);
  const links = [];
  try {
    for (const file of files) {
      if (!alive) return;
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("每张图片须为非空文件，且不超过 10 MiB。");
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("仅支持 PNG、JPEG、WebP 图片。");
      // The server verifies the bitmap before its object URL is approved for preview.
      const result = await uploadManualImage(file);
      if (!alive) return;
      const source = `manual-image:${result.id}`, name = file.name || "参考图片";
      attachments.value.push({ id: result.id, source, name, size: file.size, previewUrl: createDraftImageUrl(file) });
      emit("update:imageIds", attachments.value.map(item => item.id));
      const label = name.replace(/[\\[\]<>`!*_]/g, "_").replace(/[\r\n]/g, " ");
      links.push(`![${label}](${source})`);
    }
  } catch (failure) {
    if (alive) error.value = failure.message || "图片上传失败，请重试。";
  } finally {
    // Keep successful uploads inline even if a later file in the batch fails.
    if (alive) {
      try { await insert(links.join("\n")); }
      finally {
        if (alive) {
          busy.value = false;
          emit("uploading", false);
          emit("validity-change", !error.value);
        }
      }
    }
  }
}
function remove(id) {
  if (busy.value || props.disabled) return;
  const item = attachments.value.find(entry => entry.id === id);
  if (item) revokeDraftImageUrl(item.previewUrl);
  attachments.value = attachments.value.filter(entry => entry.id !== id);
  emit("update:imageIds", attachments.value.map(entry => entry.id));
}
</script>
<template>
  <MarkdownEditor :model-value="modelValue" :label="$t('开发目标与验收条件')" :rows="6" :disabled="disabled"
    :busy="busy" :images="images" :attachments="attachments" :error="error"
    accept="image/png,image/jpeg,image/webp" attach-button-label="添加图片" :attachment-label="$t('参考图片')"
    :attachment-hint="$t('随启动一起发送')" :upload-hint="$t('PNG、JPEG、WebP，每张最多 10 MiB，最多 20 张。')"
    @update:model-value="emit('update:modelValue', $event)" @files="add" @remove="remove" />
  <p v-if="error" class="field-hint">{{ $t("图片未全部上传，请重试添加失败图片，或明确忽略后启动。") }}</p>
  <button v-if="error" type="button" :disabled="disabled || busy" @click="error = ''; emit('validity-change', true)">{{ $t("忽略未上传的图片") }}</button>
</template>
