<script setup>
/* global document */
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
const props = defineProps({ open: Boolean, title: { type: String, required: true }, wide: Boolean, returnFocus: { type: Object, default: null } });
const emit = defineEmits(["close"]);
const element = ref();
let trigger;
function closeOnBackdrop(event) {
  if (event.target !== element.value) return;
  // A dropdown opening between pointer down/up can retarget the click to the dialog.
  const { left, right, top, bottom } = element.value.getBoundingClientRect();
  if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) emit("close");
}
async function sync() { await nextTick(); if (!element.value) return; if (props.open && !element.value.open) { trigger = props.returnFocus || document.activeElement; element.value.showModal(); } else if (!props.open && element.value.open) { element.value.close(); if (trigger?.isConnected) trigger.focus?.(); } }
watch(() => props.open, sync); onMounted(sync); onBeforeUnmount(() => { if (element.value?.open) { element.value.close(); if (trigger?.isConnected) trigger.focus?.(); } });
</script>
<template><dialog ref="element" class="ui-dialog" :class="{ 'ui-dialog-wide': wide }" :aria-label="title" @cancel.prevent="emit('close')" @click="closeOnBackdrop"><header><slot name="header"><h2>{{ title }}</h2><button type="button" :aria-label="$t('关闭弹窗')" @click="emit('close')">×</button></slot></header><div class="ui-dialog-body"><slot /></div><footer v-if="$slots.footer"><slot name="footer" /></footer></dialog></template>
