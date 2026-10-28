<script setup>
import { computed } from "vue";
import { statusHue } from "./status-color.js";
const props = defineProps({ status: { type: String, required: true }, statuses: { type: Array, required: true } });
const hue = computed(() => statusHue(props.status, props.statuses));
</script>
<template><span class="ui-badge status-color" :style="{ '--status-color-hue': hue }"><slot /></span></template>
<style scoped>
.status-color { background: hsl(var(--status-color-hue) var(--status-color-bg-saturation) var(--status-color-bg-lightness)); color: hsl(var(--status-color-hue) var(--status-color-text-saturation) var(--status-color-text-lightness)); white-space: normal; overflow-wrap: anywhere; }
</style>
