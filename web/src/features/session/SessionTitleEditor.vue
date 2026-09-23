<script setup>
import { onUnmounted, ref, watch } from "vue";
import { EditOutlined } from "@antdv-next/icons";
import { api } from "../../shared/api/api.js";

const props = defineProps({
  taskKey: { type: String, required: true },
  title: { type: String, required: true },
});
const emit = defineEmits(["saved"]);
const editing = ref(false), busy = ref(false), draft = ref(""), error = ref("");
let titleRevision = 0;
watch(
  () => [props.taskKey, props.title],
  () => {
    titleRevision++;
    if (!editing.value) draft.value = props.title;
  },
  { flush: "sync", immediate: true },
);
onUnmounted(() => { titleRevision++; });
function start() {
  draft.value = props.title;
  error.value = "";
  editing.value = true;
}
function cancel() {
  editing.value = false;
  error.value = "";
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const revision = titleRevision;
  const key = props.taskKey;
  try {
    const result = await api(`/runs/${key}/title`, { title: draft.value });
    // The same save is broadcast through SSE before its HTTP response in some
    // browsers. Treat that matching update as confirmation, while a different
    // peer title still wins over this delayed response.
    if (revision === titleRevision) emit("saved", key, result.title);
    if (revision === titleRevision || props.title === result.title)
      editing.value = false;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="session-title-editor">
    <template v-if="editing">
      <label class="sr-only" :for="`session-title-${taskKey}`">会话标题</label>
      <input
        :id="`session-title-${taskKey}`"
        v-model="draft"
        type="text"
        maxlength="200"
        :disabled="busy"
        @keyup.enter="save"
        @keyup.escape="cancel"
      />
      <button type="button" class="primary compact" :disabled="busy" @click="save">
        {{ busy ? "保存中…" : "保存" }}
      </button>
      <button type="button" :disabled="busy" @click="cancel">取消</button>
    </template>
    <template v-else>
      <span class="session-heading" :title="title">{{ title }}</span>
      <button type="button" class="icon-button" aria-label="修改会话标题" title="修改会话标题" @click="start">
        <EditOutlined aria-hidden="true" />
      </button>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>
