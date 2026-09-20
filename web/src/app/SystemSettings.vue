<script setup>
import { SettingOutlined } from "@antdv-next/icons";
import MemberStorageSettings from "../features/settings/MemberStorageSettings.vue";
</script>
<template>
  <section class="system-settings-panel">
    <header class="page-heading"><div class="eyebrow">SYSTEM</div><h1><SettingOutlined aria-hidden="true" /> 系统设置</h1><p>管理成员项目与任务目录的基础路径，并检测服务器 Git 环境。变更只影响后续新项目和任务。</p></header>
    <MemberStorageSettings />
  </section>
</template>
