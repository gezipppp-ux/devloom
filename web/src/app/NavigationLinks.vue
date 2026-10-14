<script setup>
import { HomeOutlined, FolderOutlined, FileTextOutlined, CodeOutlined, CheckCircleOutlined } from "@antdv-next/icons";
defineProps({ active: { type: String, default: "workspace" }, compact: Boolean });
const emit = defineEmits(["navigate"]);
const entries = [{ id: "workspace", name: "工作台", icon: HomeOutlined }, { id: "projects", name: "项目", icon: FolderOutlined }, { id: "issues", name: "事项", icon: FileTextOutlined }, { id: "development", name: "开发", icon: CodeOutlined }, { id: "deliveries", name: "交付", icon: CheckCircleOutlined }];
</script>
<template><button v-for="entry in entries" :key="entry.id" :class="{ active: active === entry.id }" :aria-current="active === entry.id ? 'page' : undefined" :title="$t(entry.name)" :aria-label="$t(entry.name)" @click="emit('navigate', entry.id)"><component :is="entry.icon" aria-hidden="true" /><span>{{ compact && entry.id === "development" && $i18n.locale === "en" ? "Dev" : $t(entry.name) }}</span></button></template>
