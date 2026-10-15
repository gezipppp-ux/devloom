<script setup>
/* global document */
import { nextTick, onMounted, onUnmounted, ref, useId } from "vue";
import { BugOutlined, DownOutlined, FileTextOutlined, PlusOutlined } from "@antdv-next/icons";

defineProps({ disabled: Boolean });
const emit = defineEmits(["create"]);
const root = ref(null), trigger = ref(null), open = ref(false), id = useId();
const options = [
  { target: "issues", label: "新建需求", description: "描述功能与验收标准", icon: FileTextOutlined },
  { target: "bugs", label: "新建 Bug", description: "记录问题与复现过程", icon: BugOutlined },
];
function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
async function toggle(last = false) {
  if (open.value) { close(); return; }
  open.value = true;
  await nextTick();
  const items = root.value?.querySelectorAll('[role="menuitem"]');
  items?.[last ? items.length - 1 : 0]?.focus();
}
function choose(target) { close(); emit("create", target); }
function keydown(event) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
  else if (event.key === "Tab") close(true);
  else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const items = [...root.value.querySelectorAll('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }
}
function outside(event) { if (!root.value?.contains(event.target)) close(); }
onMounted(() => document.addEventListener("pointerdown", outside));
onUnmounted(() => document.removeEventListener("pointerdown", outside));
</script>
<template>
  <div ref="root" class="issue-create-menu">
    <button ref="trigger" type="button" class="primary" :disabled="disabled" :aria-expanded="open" aria-haspopup="menu" :aria-controls="id" @click="toggle()" @keydown.down.prevent="!open && toggle()" @keydown.up.prevent="!open && toggle(true)"><PlusOutlined aria-hidden="true" />{{ $t('新建事项') }}<DownOutlined aria-hidden="true" /></button>
    <div v-if="open" :id="id" class="issue-create-options" role="menu" :aria-label="$t('选择事项类型')" @keydown="keydown">
      <button v-for="option in options" :key="option.target" type="button" role="menuitem" tabindex="-1" :aria-label="$t(option.label)" @click="choose(option.target)"><component :is="option.icon" aria-hidden="true" /><span>{{ $t(option.label) }}<small>{{ $t(option.description) }}</small></span></button>
    </div>
  </div>
</template>
<style scoped>
.issue-create-menu { position: relative; flex-shrink: 0; }
.issue-create-menu > button { display: inline-flex; align-items: center; gap: 8px; }
.issue-create-options { position: absolute; z-index: 50; inset: calc(100% + 8px) 0 auto auto; width: 264px; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow-sm); padding: 6px; }
.issue-create-options > button { display: flex; align-items: flex-start; justify-content: flex-start; gap: 12px; width: 100%; padding: 12px; border: 0; background: transparent; text-align: left; white-space: normal; }
.issue-create-options > button:hover, .issue-create-options > button:focus-visible { background: var(--selected); }
.issue-create-options > button > .anticon { margin-top: 4px; }
.issue-create-options small { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }
@media (max-width: 767px) { .issue-create-menu > button, .issue-create-options > button { min-height: 44px; } }
</style>
