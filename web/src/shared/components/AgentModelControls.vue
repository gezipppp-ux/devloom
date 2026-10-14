<script setup>
import { computed } from "vue";
import { FormItem } from "antdv-next";
import AppSelect from "./AppSelect.vue";
import { translate } from "../i18n/index.js";
const props = defineProps({
  agentLabel: { type: String, default: "Agent" },
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
function effortLabel(value) {
  return labels[value] ? translate(labels[value]) + " (" + value + ")" : value;
}
const modelOptions = computed(() => [
  {
    value: "",
    label: props.compact
      ? translate("默认模型")
      : translate("使用") +
        " " +
        props.agentLabel +
        " " +
        translate("默认配置"),
  },
  ...(props.models.length
    ? [
        {
          label: translate("推荐模型集"),
          options: props.models.map((entry) => ({
            value: entry.model,
            label: translate(entry.label),
          })),
        },
      ]
    : []),
  ...(props.model && !selected.value
    ? [
        {
          value: props.model,
          label:
            translate("当前选择 ·") +
            " " +
            props.model +
            translate("（未在当前列表中）"),
        },
      ]
    : []),
]);
const effortOptions = computed(() => [
  { value: "", label: translate("使用默认思考强度") },
  ...efforts.value.map((value) => ({ value, label: effortLabel(value) })),
  ...(props.reasoningEffort && !efforts.value.includes(props.reasoningEffort)
    ? [
        {
          value: props.reasoningEffort,
          label:
            translate("当前选择 ·") +
            " " +
            effortLabel(props.reasoningEffort) +
            translate("（未在当前列表中）"),
        },
      ]
    : []),
]);
function changeModel(model) {
  emit("change", {
    model,
    reasoningEffort: props.models
      .find((entry) => entry.model === model)
      ?.reasoningEfforts.includes(props.reasoningEffort)
      ? props.reasoningEffort
      : "",
  });
}
function changeEffort(reasoningEffort) {
  emit("change", { model: props.model, reasoningEffort });
}
</script>
<template>
  <div
    :class="compact ? 'model-controls-compact' : 'model-controls form-columns'"
  >
    <component
      :is="compact ? 'div' : FormItem"
      :label="compact ? undefined : $t('{p0} 模型（可选）', { p0: agentLabel })"
      class="model-control"
      layout="vertical"
    >
      <AppSelect
        :aria-label="$t('{p0} 模型', { p0: agentLabel })"
        :value="model"
        :options="modelOptions"
        :disabled="disabled || loading"
        :toolbar="compact"
        @change="changeModel"
      />
    </component>
    <component
      :is="compact ? 'div' : FormItem"
      :label="compact ? undefined : $t('思考强度（可选）')"
      class="effort-control"
      layout="vertical"
    >
      <AppSelect
        :aria-label="$t('思考强度')"
        :value="reasoningEffort"
        :options="effortOptions"
        :disabled="disabled || loading || !selected || !efforts.length"
        :toolbar="compact"
        @change="changeEffort"
      />
    </component>
  </div>
</template>
