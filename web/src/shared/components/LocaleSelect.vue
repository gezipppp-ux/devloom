<script setup>
import { i18n, setLocale } from "../i18n/index.js";
</script>
<template><select class="ui-locale" :aria-label="$t('界面语言')" :value="i18n.global.locale.value" @change="setLocale($event.target.value)"><option value="zh-CN">简体中文</option><option value="en">English</option></select></template>
