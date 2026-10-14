<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { onUnmounted, ref, watch } from "vue";
import { api } from "../../shared/api/api.js";
import { taskTypes, taskProgresses } from "./task-metadata.js";
const props = defineProps({
  taskKey: { type: String, required: true },
  metadata: { type: Object, required: true },
});
const emit = defineEmits(["saved"]);
const busy = ref(false),
  error = ref("");
let metadataRevision = 0;
watch(
  () => [props.taskKey, props.metadata.type, props.metadata.progress],
  () => {
    metadataRevision++;
  },
  { flush: "sync" },
);
onUnmounted(() => {
  metadataRevision++;
});
async function update(field, event) {
  const value = event.target.value;
  event.target.value = props.metadata[field];
  busy.value = true;
  error.value = "";
  const revision = metadataRevision;
  const key = props.taskKey;
  try {
    const result = await api(`/runs/${key}/metadata`, {
      [field]: value,
    });
    // A newer peer update delivered by SSE wins over a delayed save response.
    if (revision === metadataRevision) emit("saved", key, result.metadata);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="task-metadata-controls">
    <div class="task-metadata-fields">
      <label
        >{{ $t("任务类型") }}<select
          :aria-label="$t(&quot;任务类型&quot;)"
          :value="metadata.type"
          :disabled="busy"
          @change="update('type', $event)"
        >
          <option
            v-for="entry in taskTypes"
            :key="entry.value"
            :value="entry.value"
          >
            {{ $t(entry.label) }}
          </option>
        </select></label
      >
      <label
        >{{ $t("任务进度") }}<select
          :aria-label="$t(&quot;任务进度&quot;)"
          :value="metadata.progress"
          :disabled="busy"
          @change="update('progress', $event)"
        >
          <option
            v-for="entry in taskProgresses"
            :key="entry.value"
            :value="entry.value"
          >
            {{ $t(entry.label) }}
          </option>
        </select></label
      >
      <span class="metadata-note">{{
        busy ? $t("正在保存…") : $t("进度由你维护")
      }}</span>
    </div>
    <FeedbackMessage :message="error" type="error" />
  </div>
</template>
