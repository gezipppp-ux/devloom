<script setup>
/* global document, window */
import { CheckOutlined, DownOutlined, ReloadOutlined } from "@antdv-next/icons";
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useId,
  watch,
} from "vue";

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
const selectedModelLabel = computed(
  () => selected.value?.label || props.model || "默认模型",
);
const selectedEffortLabel = computed(() =>
  props.reasoningEffort ? compactLabel(props.reasoningEffort) : "默认",
);
const expanded = ref(false);
const menuMode = ref("models");
const root = ref();
const modelTrigger = ref();
const effortTrigger = ref();
const menu = ref();
const menuPosition = ref({});
const menuId = `model-options-${useId()}`;

function label(value) {
  return labels[value] ? `${labels[value]}（${value}）` : value;
}
function compactLabel(value) {
  return labels[value] || value;
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
function close(restoreFocus = false) {
  expanded.value = false;
  if (restoreFocus)
    (menuMode.value === "models" ? modelTrigger.value : effortTrigger.value)?.focus({
      preventScroll: true,
    });
}
function positionMenu() {
  const trigger =
    menuMode.value === "models" ? modelTrigger.value : effortTrigger.value;
  if (!menu.value || !trigger) return;
  const anchor = trigger.getBoundingClientRect();
  if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
    close();
    return;
  }
  const bounds = menu.value.getBoundingClientRect();
  const above = anchor.top - bounds.height - 8;
  const below = anchor.bottom + 8;
  const top =
    above >= 16
      ? above
      : below + bounds.height <= window.innerHeight - 16
        ? below
        : Math.max(16, above);
  menuPosition.value = {
    left: `${Math.max(16, Math.min(anchor.left, window.innerWidth - bounds.width - 16))}px`,
    top: `${top}px`,
  };
}
async function open(mode) {
  if (
    props.disabled ||
    props.loading ||
    (mode === "efforts" && (!selected.value || !efforts.value.length))
  )
    return;
  menuMode.value = mode;
  menuPosition.value = { left: "16px", top: "16px", visibility: "hidden" };
  expanded.value = true;
  await nextTick();
  positionMenu();
  await nextTick();
  const options = [
    ...(menu.value?.querySelectorAll('[role="option"]:not(:disabled)') || []),
  ];
  (
    options.find((option) =>
      mode === "models"
        ? option.dataset.model === props.model
        : option.dataset.effort === props.reasoningEffort,
    ) || options[0]
  )?.focus({ preventScroll: true });
}
function chooseModel(model) {
  const entry = props.models.find((item) => item.model === model);
  const reasoningEffort = entry?.reasoningEfforts.includes(props.reasoningEffort)
    ? props.reasoningEffort
    : "";
  emit("change", { model, reasoningEffort });
  close(true);
}
function chooseEffort(reasoningEffort) {
  emit("change", { model: props.model, reasoningEffort });
  close(true);
}
function navigate(event) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const options = [
    ...(menu.value?.querySelectorAll('[role="option"]:not(:disabled)') || []),
  ];
  if (!options.length) return;
  const current = options.indexOf(document.activeElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
          options.length;
  options[next].focus();
}
function outside(event) {
  if (!root.value?.contains(event.target)) close();
}
function moved(event) {
  if (
    expanded.value &&
    (event.target === window || !menu.value?.contains(event.target))
  )
    positionMenu();
}
function blur(event) {
  if (!root.value?.contains(event.relatedTarget)) close();
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close();
  },
);
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("scroll", moved, true);
  window.addEventListener("resize", moved);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("scroll", moved, true);
  window.removeEventListener("resize", moved);
});
</script>

<template>
  <div v-if="compact" ref="root" class="model-controls-compact" @focusout="blur">
    <div class="model-compact-picker">
      <button
        ref="modelTrigger"
        type="button"
        role="combobox"
        :aria-label="`${agentLabel} 模型`"
        aria-haspopup="listbox"
        :aria-controls="menuId"
        :aria-expanded="expanded && menuMode === 'models'"
        :data-model="model"
        :disabled="disabled || loading"
        :title="selectedModelLabel"
        class="model-compact-trigger model-compact-model"
        @click="expanded && menuMode === 'models' ? close() : open('models')"
        @keydown.down.prevent="open('models')"
      >
        <span>{{ selectedModelLabel }}</span><DownOutlined aria-hidden="true" />
      </button>
      <button
        ref="effortTrigger"
        type="button"
        role="combobox"
        aria-label="思考强度"
        aria-haspopup="listbox"
        :aria-controls="menuId"
        :aria-expanded="expanded && menuMode === 'efforts'"
        :data-effort="reasoningEffort"
        :disabled="disabled || loading || !selected || !efforts.length"
        :title="reasoningEffort ? label(reasoningEffort) : '使用默认思考强度'"
        class="model-compact-trigger model-compact-effort"
        @click="expanded && menuMode === 'efforts' ? close() : open('efforts')"
        @keydown.down.prevent="open('efforts')"
      >
        <span>{{ selectedEffortLabel }}</span>
      </button>
    </div>
    <div
      v-if="expanded"
      ref="menu"
      class="model-menu"
      :class="`model-menu-${menuMode}`"
      :style="menuPosition"
      @keydown.esc.stop.prevent="close(true)"
    >
      <template v-if="menuMode === 'models'">
        <p class="model-menu-title">选择模型</p>
        <div :id="menuId" role="listbox" :aria-label="`${agentLabel} 模型选项`" @keydown="navigate">
          <button
            type="button"
            role="option"
            class="model-option"
            data-model=""
            :aria-selected="!model"
            @click="chooseModel('')"
          >
            <span>默认</span><CheckOutlined v-if="!model" aria-hidden="true" />
          </button>
          <p v-if="models.length" class="model-menu-group">推荐模型集</p>
          <button
            v-for="entry in models"
            :key="entry.model"
            type="button"
            role="option"
            class="model-option"
            :data-model="entry.model"
            :aria-selected="model === entry.model"
            @click="chooseModel(entry.model)"
          >
            <span>{{ entry.label }}</span>
            <CheckOutlined v-if="model === entry.model" aria-hidden="true" />
          </button>
          <button
            v-if="model && !selected"
            type="button"
            role="option"
            class="model-option"
            :data-model="model"
            aria-selected="true"
            @click="chooseModel(model)"
          >
            <span>当前选择 · {{ model }}（未在当前列表中）</span>
            <CheckOutlined aria-hidden="true" />
          </button>
        </div>
      </template>
      <template v-else>
        <div class="effort-menu-heading">
          <strong>{{ selectedEffortLabel }}</strong>
          <span>{{ selectedModelLabel }}</span>
          <button
            type="button"
            class="model-menu-reset"
            aria-label="使用默认思考强度"
            title="使用默认思考强度"
            @click="chooseEffort('')"
          >
            <ReloadOutlined aria-hidden="true" />
          </button>
        </div>
        <div :id="menuId" role="listbox" aria-label="思考强度选项" @keydown="navigate">
          <button
            v-for="effort in efforts"
            :key="effort"
            type="button"
            role="option"
            class="effort-option"
            :data-effort="effort"
            :aria-selected="reasoningEffort === effort"
            @click="chooseEffort(effort)"
          >
            <span>{{ label(effort) }}</span>
            <CheckOutlined v-if="reasoningEffort === effort" aria-hidden="true" />
          </button>
        </div>
      </template>
    </div>
  </div>
  <div v-else class="model-controls form-columns">
    <a-form-item :label="`${agentLabel} 模型（可选）`" class="model-control">
      <select
        :aria-label="`${agentLabel} 模型`"
        :value="model"
        :disabled="disabled || loading"
        @change="changeModel"
      >
        <option value="">使用 {{ agentLabel }} 默认配置</option>
        <option v-for="entry in models" :key="entry.model" :value="entry.model">
          {{ entry.label }}
        </option>
        <option v-if="model && !selected" :value="model">
          当前选择 · {{ model }}（未在当前列表中）
        </option>
      </select>
    </a-form-item>
    <a-form-item label="思考强度（可选）" class="effort-control">
      <select
        aria-label="思考强度"
        :value="reasoningEffort"
        :disabled="disabled || loading || !selected"
        @change="changeEffort"
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
</template>
