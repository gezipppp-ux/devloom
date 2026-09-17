<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "./api";
import FormSection from "./FormSection.vue";
import { ReloadOutlined } from "@antdv-next/icons";
const props = defineProps({
  model: { type: String, default: "" },
  reasoningEffort: { type: String, default: "" },
  disabled: Boolean,
});
const emit = defineEmits(["update:model", "update:reasoningEffort"]);
const models = ref([]),
  loading = ref(false),
  error = ref("");
const labels = {
  none: "无",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最大",
  ultra: "极高",
};
const selected = computed(() =>
  models.value.find((entry) => entry.model === props.model),
);
const efforts = computed(() => selected.value?.reasoningEfforts || []);
function label(value) {
  return labels[value] ? `${labels[value]}（${value}）` : value;
}
async function refresh() {
  loading.value = true;
  error.value = "";
  try {
    models.value = (await api("/models")).models;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
function changeModel(value) {
  emit("update:model", value);
  if (
    !models.value
      .find((entry) => entry.model === value)
      ?.reasoningEfforts.includes(props.reasoningEffort)
  )
    emit("update:reasoningEffort", "");
}
onMounted(refresh);
</script>

<template>
  <FormSection title="执行偏好" number="02">
    <template #action>
      <button
        class="text-button"
        type="button"
        :disabled="disabled || loading"
        @click="refresh"
      >
        <ReloadOutlined aria-hidden="true" /> 刷新模型列表
      </button>
    </template>
    <div class="form-columns">
      <a-form-item label="Codex 模型（可选）">
        <select
          aria-label="Codex 模型"
          :value="model"
          :disabled="disabled || loading"
          @change="changeModel($event.target.value)"
        >
          <option value="">使用 Codex 默认配置</option>
          <option
            v-for="entry in models"
            :key="entry.model"
            :value="entry.model"
          >
            {{ entry.label }}
          </option>
          <option v-if="model && !selected" :value="model">
            当前选择 · {{ model }}（未在当前列表中）
          </option>
        </select>
      </a-form-item>
      <a-form-item label="思考强度（可选）">
        <select
          aria-label="思考强度"
          :value="reasoningEffort"
          :disabled="disabled || loading || !selected"
          @change="emit('update:reasoningEffort', $event.target.value)"
        >
          <option value="">使用默认思考强度</option>
          <option v-for="effort in efforts" :key="effort" :value="effort">
            {{ label(effort) }}
          </option>
          <option
            v-if="reasoningEffort && !efforts.includes(reasoningEffort)"
            :value="reasoningEffort"
          >
            当前选择 · {{ label(reasoningEffort) }}（未在当前列表中）
          </option>
        </select>
      </a-form-item>
    </div>
    <p class="field-hint">
      选择具体模型后可设置其支持的思考强度。更高的强度通常需要更长时间；选择仅用于本次需求，后续对话沿用此配置。
    </p>
    <p v-if="loading" role="status" class="field-hint">正在读取可用模型…</p>
    <p v-if="!loading && !error && !models.length" class="field-hint">
      Codex 未返回可选模型，可使用默认配置或稍后刷新。
    </p>
    <p v-if="error" role="alert" class="error">
      模型列表加载失败：{{ error }}。当前选择会保留。
    </p>
  </FormSection>
</template>
