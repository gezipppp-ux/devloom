<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SettingOutlined } from "@antdv-next/icons";
import MemberStorageSettings from "../features/settings/MemberStorageSettings.vue";
import SystemWorkflows from "../features/settings/SystemWorkflows.vue";
import EnvironmentPage from "../features/settings/EnvironmentPage.vue";

const route = useRoute();
const router = useRouter();
const currentTab = computed(() => ["environment", "workflows"].includes(route.query.tab) ? route.query.tab : "storage");
function select(tab) {
  const query = { ...route.query };
  if (tab !== "storage") query.tab = tab;
  else delete query.tab;
  void router.push({ name: "system", query, hash: route.hash });
}
</script>
<template>
  <section class="system-settings-panel">
    <header class="page-heading"><div class="eyebrow">SYSTEM</div><h1><SettingOutlined aria-hidden="true" /> 系统设置</h1><p>管理服务器目录、运行环境与系统统一的事项流程。</p></header>
    <nav class="page-tabs" aria-label="系统设置分类">
      <button :aria-pressed="currentTab === 'storage'" :class="{ active: currentTab === 'storage' }" @click="select('storage')">目录设置</button>
      <button :aria-pressed="currentTab === 'environment'" :class="{ active: currentTab === 'environment' }" @click="select('environment')">环境检测</button>
      <button :aria-pressed="currentTab === 'workflows'" :class="{ active: currentTab === 'workflows' }" @click="select('workflows')">流程编排</button>
    </nav>
    <EnvironmentPage v-if="currentTab === 'environment'" />
    <SystemWorkflows v-else-if="currentTab === 'workflows'" />
    <MemberStorageSettings v-else />
  </section>
</template>
