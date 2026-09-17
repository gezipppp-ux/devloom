<script setup>
import { computed } from "vue";

const props = defineProps({
  model: { type: String, default: "" },
  reasoningEffort: { type: String, default: "" },
  models: { type: Array, default: () => [] },
  loading: Boolean,
  disabled: Boolean,
  compact: Boolean,
});
const emit = defineEmits(["change"]);
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
  props.models.find((entry) => entry.model === props.model),
);
const efforts = computed(() => selected.value?.reasoningEfforts || []);
function label(value) {
  return labels[value] ? `${labels[value]}（${value}）` : value;
}
function changeModel(event) {
  const model = event.target.value;
  event.target.value = props.model;
  const reasoningEffort = props.models
    .find((entry) => entry.model === model)
    ?.reasoningEfforts.includes(props.reasoningEffort)
    ? props.reasoningEffort
    : "";
  emit("change", { model, reasoningEffort });
}
function changeEffort(event) {
  const reasoningEffort = event.target.value;
  event.target.value = props.reasoningEffort;
  emit("change", { model: props.model, reasoningEffort });
}
</script>

<template>
  <div
    class="model-controls"
    :class="compact ? 'model-controls-compact' : 'form-columns'"
  >
    <a-form-item
      :label="compact ? undefined : 'Codex 模型（可选）'"
      class="model-control"
    >
      <select
        aria-label="Codex 模型"
        :value="model"
        :disabled="disabled || loading"
        @change="changeModel"
      >
        <option value="">
          {{ compact ? "默认模型" : "使用 Codex 默认配置" }}
        </option>
        <option v-for="entry in models" :key="entry.model" :value="entry.model">
          {{ entry.label }}
        </option>
        <option v-if="model && !selected" :value="model">
          当前选择 · {{ model }}（未在当前列表中）
        </option>
      </select>
    </a-form-item>
    <a-form-item
      :label="compact ? undefined : '思考强度（可选）'"
      class="effort-control"
    >
      <select
        aria-label="思考强度"
        :value="reasoningEffort"
        :disabled="disabled || loading || !selected"
        @change="changeEffort"
      >
        <option value="">
          {{ compact ? "默认思考" : "使用默认思考强度" }}
        </option>
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
</template>
