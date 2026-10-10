<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SettingOutlined } from "@antdv-next/icons";
import MemberStorageSettings from "../features/settings/MemberStorageSettings.vue";
import EnvironmentPage from "../features/settings/EnvironmentPage.vue";

const route = useRoute();
const router = useRouter();
const environment = computed(() => route.query.tab === "environment");
function select(tab) {
  const query = { ...route.query };
  if (tab === "environment") query.tab = tab;
  else delete query.tab;
  void router.push({ name: "system", query, hash: route.hash });
}
</script>
<template>
  <section class="system-settings-panel">
    <header class="page-heading"><div class="eyebrow">SYSTEM</div><h1><SettingOutlined aria-hidden="true" /> 系统设置</h1><p>管理服务器目录、运行环境与工具版本更新。</p></header>
    <nav class="system-sections" aria-label="系统设置分类">
      <button :aria-pressed="!environment" :class="{ active: !environment }" @click="select('storage')">目录设置</button>
      <button :aria-pressed="environment" :class="{ active: environment }" @click="select('environment')">环境检测</button>
    </nav>
    <EnvironmentPage v-if="environment" />
    <MemberStorageSettings v-else />
  </section>
</template>

<style scoped>
.system-sections { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
.system-sections .active { color: var(--accent); background: var(--selected); border-color: var(--field-border); }
</style>
