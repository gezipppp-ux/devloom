<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { ref } from "vue";
import { PaperClipOutlined } from "@antdv-next/icons";
import { appApi, uploadSessionImage } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
const props = defineProps({ endpoint: { type: String, required: true }, canEdit: Boolean, title: { type: String, default: '附件' } });
const emit = defineEmits(["uploaded"]);
const offset = ref(0);
const { data, loading, saving, error, notice, reload, perform } = useResource(() => appApi(`${props.endpoint}/files?offset=${offset.value}`));
function page(value) { offset.value = value; void reload(); }
function upload(event) {
  const file = event.target.files?.[0]; event.target.value = "";
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { error.value = "附件不能超过 10 MiB。"; return; }
  return perform(() => uploadSessionImage(`/api${props.endpoint}/files?name=${encodeURIComponent(file.name)}`, file), () => { void reload(); emit("uploaded"); });
}
</script>
<template><section class="project-section" :aria-label="$t(title)"><h3 class="issue-panel-heading"><PaperClipOutlined aria-hidden="true" />{{ $t(title) }}</h3><FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" /><p v-if="loading" role="status">{{ $t("正在读取附件…") }}</p><ul class="project-file-list"><li v-for="file in data?.items" :key="file.id"><a :href="file.url" download>{{ file.name }}</a><small>{{ Math.ceil(file.size / 1024) }} KiB</small></li></ul><p v-if="data && !data.items.length" class="muted">{{ $t("暂无附件。") }}</p><label v-if="canEdit" class="project-file-upload">{{ $t("上传附件（最多 10 MiB）") }}<input type="file" :disabled="saving" @change="upload" /></label><div class="actions"><button v-if="offset" @click="page(Math.max(0, offset - 30))">{{ $t("上一页") }}</button><button v-if="data?.nextOffset != null" @click="page(data.nextOffset)">{{ $t("下一页") }}</button></div></section></template>
