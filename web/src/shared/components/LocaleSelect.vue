<script setup>
import { computed } from "vue";
import { localePreference, setLocale, translate } from "../i18n/index.js";
import ToolbarSelect from "./ToolbarSelect.vue";
const options = computed(() => [{ value: "auto", label: translate("自动") }, { value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }]);
</script>
<template><ToolbarSelect class="ui-locale" :label="$t('界面语言')" :model-value="localePreference" :options="options" align-end @update:model-value="setLocale" /></template>
