<script setup>
import { SettingOutlined } from "@antdv-next/icons";
import WorktreeStorageSettings from "../features/settings/WorktreeStorageSettings.vue";
</script>
<template>
  <section class="system-settings-panel">
    <header class="page-heading"><div class="eyebrow">SYSTEM</div><h1><SettingOutlined aria-hidden="true" /> 系统设置</h1><p>管理服务器的全局 Worktree 基础目录。变更只影响后续新任务。</p></header>
    <WorktreeStorageSettings />
  </section>
</template>
