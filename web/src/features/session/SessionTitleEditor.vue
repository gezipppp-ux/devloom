<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { nextTick, onUnmounted, ref, watch } from "vue";
import { EditOutlined } from "@antdv-next/icons";
import { api } from "../../shared/api/api.js";

const props = defineProps({
  taskKey: { type: String, required: true },
  title: { type: String, required: true },
});
const emit = defineEmits(["saved"]);
const editing = ref(false), busy = ref(false), draft = ref(""), error = ref("");
const input = ref(), editButton = ref();
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
  void nextTick(() => { input.value?.focus(); input.value?.select(); });
}
function cancel() {
  if (busy.value) return;
  editing.value = false;
  error.value = "";
  void nextTick(() => editButton.value?.focus());
}
function saveFromKeyboard(event) {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void save();
}
function cancelFromKeyboard(event) {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  cancel();
}
async function save() {
  if (busy.value || !draft.value.trim()) return;
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
    if (revision === titleRevision || props.title === result.title) {
      editing.value = false;
      void nextTick(() => editButton.value?.focus());
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="session-title-editor">
    <form v-if="editing" class="session-title-form" @submit.prevent="save">
      <div class="session-title-label">
        <label :for="`session-title-${taskKey}`">会话标题</label>
        <span :id="`session-title-hint-${taskKey}`" class="session-title-limit">最多 200 个字符</span>
      </div>
      <textarea
        ref="input"
        :id="`session-title-${taskKey}`"
        v-model="draft"
        rows="2"
        maxlength="200"
        :aria-describedby="`session-title-hint-${taskKey}`"
        :disabled="busy"
        @keydown.enter="saveFromKeyboard"
        @keydown.esc="cancelFromKeyboard"
      />
      <div class="session-title-actions">
        <button type="button" :disabled="busy" @click="cancel">取消</button>
        <button type="submit" class="primary compact" :disabled="busy || !draft.trim()">
          {{ busy ? "保存中…" : "保存" }}
        </button>
      </div>
      <FeedbackMessage :message="error" type="error" />
    </form>
    <div v-else class="session-title-display">
      <h1 class="session-heading">{{ title }}</h1>
      <button ref="editButton" type="button" class="icon-button" aria-label="修改会话标题" title="修改会话标题" @click="start">
        <EditOutlined aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
