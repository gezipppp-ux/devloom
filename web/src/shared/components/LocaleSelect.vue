<script setup>
import { i18n, setLocale } from "../i18n/index.js";
import ToolbarSelect from "./ToolbarSelect.vue";
const options = [{ value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }];
</script>
<template><ToolbarSelect class="ui-locale" :label="$t('界面语言')" :model-value="i18n.global.locale.value" :options="options" align-end @update:model-value="setLocale" /></template>
