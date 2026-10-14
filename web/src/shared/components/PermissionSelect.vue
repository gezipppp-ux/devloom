<script setup>
/* global document, window */
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useId,
  watch,
} from "vue";
import {
  CheckOutlined,
  DownOutlined,
  ReloadOutlined,
  SafetyOutlined,
} from "@antdv-next/icons";

const props = defineProps({
  modelValue: { type: String, default: "ask" },
  options: { type: Array, default: () => [] },
  disabled: Boolean,
  compact: Boolean,
  refreshable: Boolean,
  refreshing: Boolean,
});
const emit = defineEmits(["update:modelValue", "refresh"]);
const expanded = ref(false),
  root = ref(),
  trigger = ref(),
  menu = ref();
const menuPosition = ref({});
const menuId = `permission-options-${useId()}`;
const selected = computed(() =>
  props.options.find((option) => option.id === props.modelValue),
);
function close(restoreFocus = false) {
  expanded.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function positionMenu() {
  if (!menu.value || !trigger.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
    close();
    return;
  }
  const bounds = menu.value.getBoundingClientRect();
  const above = anchor.top - bounds.height - 8;
  const below = anchor.bottom + 8;
  const top =
    props.compact && above >= 16
      ? above
      : below + bounds.height <= window.innerHeight - 16
        ? below
        : Math.max(16, above);
  menuPosition.value = {
    left: `${Math.max(16, Math.min(anchor.left, window.innerWidth - bounds.width - 16))}px`,
    top: `${top}px`,
  };
}
async function open() {
  if (props.disabled) return;
  menuPosition.value = { left: "16px", top: "16px", visibility: "hidden" };
  expanded.value = true;
  await nextTick();
  positionMenu();
  await nextTick();
  if (!menu.value || props.disabled) return;
  const options = [
    ...menu.value.querySelectorAll('[role="option"]:not(:disabled)'),
  ];
  (
    options.find((option) => option.dataset.value === props.modelValue) ||
    options[0]
  )?.focus({ preventScroll: true });
}
function choose(option) {
  if (props.disabled || !option.available) return;
  emit("update:modelValue", option.id);
  close(true);
}
function navigate(event) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const options = [
    ...menu.value.querySelectorAll('[role="option"]:not(:disabled)'),
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
  // Clicking an off-screen trigger may queue its ancestor's scroll event until
  // after the menu opens. Reposition instead of dismissing that fresh menu.
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
  <div
    ref="root"
    class="permission-selector"
    :class="{ 'permission-selector-compact': compact }"
    @keydown.esc.stop.prevent="close(true)"
    @focusout="blur"
  >
    <button
      ref="trigger"
      type="button"
      role="combobox"
      :aria-label="$t(&quot;权限模式&quot;)"
      aria-haspopup="listbox"
      :aria-controls="menuId"
      :aria-expanded="expanded"
      :disabled="disabled"
      class="permission-trigger"
      :data-permission="modelValue"
      :title="$t(selected?.description || '')"
      @click="expanded ? close() : open()"
      @keydown.down.prevent="open"
    >
      <SafetyOutlined aria-hidden="true" /><span>{{
        $t(selected?.label || modelValue)
      }}</span>
      <DownOutlined aria-hidden="true" />
    </button>
    <div
      v-if="expanded"
      ref="menu"
      class="permission-menu"
      :style="menuPosition"
    >
      <div
        :id="menuId"
        role="listbox"
        :aria-label="$t(&quot;执行权限选项&quot;)"
        @keydown="navigate"
      >
        <button
          v-for="option in options"
          :key="option.id"
          type="button"
          role="option"
          class="permission-option"
          :data-value="option.id"
          :aria-selected="modelValue === option.id"
          :disabled="disabled || !option.available"
          @click="choose(option)"
        >
          <span class="permission-option-content"
            ><strong>{{ $t(option.label) }}</strong>
            <span>{{ $t(option.description) }}</span
            ><small v-if="!option.available">{{
              option.reason || $t("当前服务不可用")
            }}</small>
          </span>
          <CheckOutlined v-if="modelValue === option.id" aria-hidden="true" />
        </button>
      </div>
      <button
        v-if="refreshable"
        type="button"
        class="text-button permission-refresh"
        :disabled="disabled || refreshing"
        @click="emit('refresh')"
      >
        <ReloadOutlined aria-hidden="true" />{{
          refreshing ? $t("正在刷新权限选项…") : $t("刷新权限选项")
        }}
      </button>
    </div>
  </div>
</template>
