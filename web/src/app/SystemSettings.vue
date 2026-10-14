<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SettingOutlined } from "@antdv-next/icons";
import MemberStorageSettings from "../features/settings/MemberStorageSettings.vue";
import SystemWorkflows from "../features/settings/SystemWorkflows.vue";
import EnvironmentPage from "../features/settings/EnvironmentPage.vue";
import AgentSuppliers from "../features/settings/AgentSuppliers.vue";
import SetupRecord from "../features/setup/SetupRecord.vue";

const route = useRoute();
const router = useRouter();
const currentTab = computed(() => ["environment", "workflows", "agent-suppliers", "initialization"].includes(route.query.tab) ? route.query.tab : "storage");
function select(tab) {
  const query = { ...route.query };
  if (tab !== "storage") query.tab = tab;
  else delete query.tab;
  void router.push({ name: "system", query, hash: route.hash });
}
</script>
<template>
  <section class="system-settings-panel">
    <header class="page-heading"><div class="eyebrow">SYSTEM</div><h1><SettingOutlined aria-hidden="true" /> {{ $t("系统设置") }}</h1><p>{{ $t("管理 Agent 供应商、服务器目录、运行环境与系统事项流程。") }}</p></header>
    <nav class="page-tabs" :aria-label="$t(&quot;系统设置分类&quot;)">
      <button :aria-pressed="currentTab === 'agent-suppliers'" :class="{ active: currentTab === 'agent-suppliers' }" @click="select('agent-suppliers')">{{ $t("Agent 供应商") }}</button>
      <button :aria-pressed="currentTab === 'storage'" :class="{ active: currentTab === 'storage' }" @click="select('storage')">{{ $t("目录设置") }}</button>
      <button :aria-pressed="currentTab === 'environment'" :class="{ active: currentTab === 'environment' }" @click="select('environment')">{{ $t("环境检测") }}</button>
      <button :aria-pressed="currentTab === 'workflows'" :class="{ active: currentTab === 'workflows' }" @click="select('workflows')">{{ $t("流程编排") }}</button>
      <button :aria-pressed="currentTab === 'initialization'" :class="{ active: currentTab === 'initialization' }" @click="select('initialization')">{{ $t("初始化记录") }}</button>
    </nav>
    <AgentSuppliers v-if="currentTab === 'agent-suppliers'" />
    <EnvironmentPage v-else-if="currentTab === 'environment'" />
    <SystemWorkflows v-else-if="currentTab === 'workflows'" />
    <SetupRecord v-else-if="currentTab === 'initialization'" @continue="router.push({ name: 'setup' })" />
    <MemberStorageSettings v-else />
  </section>
</template>
