<script setup>
import { ref } from "vue";
import { api } from "./api";
import { taskTypes, taskProgresses } from "./task_metadata";
const props = defineProps({
  taskKey: { type: String, required: true },
  metadata: { type: Object, required: true },
});
const emit = defineEmits(["saved"]);
const busy = ref(false),
  error = ref("");
async function update(field, event) {
  const value = event.target.value;
  event.target.value = props.metadata[field];
  busy.value = true;
  error.value = "";
  try {
    const result = await api(`/runs/${props.taskKey}/metadata`, {
      [field]: value,
    });
    emit("saved", props.taskKey, result.metadata);
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
        >任务类型<select
          aria-label="任务类型"
          :value="metadata.type"
          :disabled="busy"
          @change="update('type', $event)"
        >
          <option
            v-for="entry in taskTypes"
            :key="entry.value"
            :value="entry.value"
          >
            {{ entry.label }}
          </option>
        </select></label
      >
      <label
        >任务进度<select
          aria-label="任务进度"
          :value="metadata.progress"
          :disabled="busy"
          @change="update('progress', $event)"
        >
          <option
            v-for="entry in taskProgresses"
            :key="entry.value"
            :value="entry.value"
          >
            {{ entry.label }}
          </option>
        </select></label
      >
      <span class="metadata-note">{{
        busy ? "正在保存…" : "进度由你维护"
      }}</span>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>
