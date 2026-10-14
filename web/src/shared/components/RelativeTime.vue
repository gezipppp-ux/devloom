<script setup>
/* global setInterval, clearInterval */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { formatDate, translate } from "../i18n/index.js";
import { formatRelativeTime } from "../i18n/relative-time.js";

const props = defineProps({ value: { type: [String, Number, Date], default: null } });
const now = ref(Date.now());
const date = computed(() => props.value === null || props.value === "" ? null : new Date(props.value));
const valid = computed(() => date.value && !Number.isNaN(date.value.getTime()));
const text = computed(() => formatRelativeTime(props.value, now.value));
const fullTime = computed(() => valid.value ? formatDate(date.value, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : translate("时间未知"));
let timer;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 30000); });
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <time :datetime="valid ? date.toISOString() : undefined" :title="fullTime"><slot :text="text">{{ text }}</slot></time>
</template>
