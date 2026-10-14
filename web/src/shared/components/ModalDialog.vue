<script setup>
/* global document */
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
const props = defineProps({ open: Boolean, title: { type: String, required: true }, wide: Boolean });
const emit = defineEmits(["close"]);
const element = ref();
let trigger;
async function sync() { await nextTick(); if (!element.value) return; if (props.open && !element.value.open) { trigger = document.activeElement; element.value.showModal(); } else if (!props.open && element.value.open) { element.value.close(); trigger?.focus?.(); } }
watch(() => props.open, sync); onMounted(sync); onUnmounted(() => { if (element.value?.open) element.value.close(); });
</script>
<template><dialog ref="element" class="ui-dialog" :class="{ 'ui-dialog-wide': wide }" :aria-label="title" @cancel.prevent="emit('close')" @click="event => { if (event.target === element) emit('close'); }"><header><h2>{{ title }}</h2><button type="button" :aria-label="$t('关闭弹窗')" @click="emit('close')">×</button></header><div class="ui-dialog-body"><slot /></div><footer v-if="$slots.footer"><slot name="footer" /></footer></dialog></template>
