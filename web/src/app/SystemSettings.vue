<script setup>
import { computed } from "vue";
import { usePageTitle } from "../shared/components/page-title.js";
import { translate } from "../shared/i18n/index.js";
import { useRoute, useRouter } from "vue-router";
import { TeamOutlined, ApartmentOutlined, BranchesOutlined, ApiOutlined, DesktopOutlined, FolderOutlined, HistoryOutlined } from "@antdv-next/icons";
import SettingsLayout from "../shared/components/SettingsLayout.vue";
import AccountManagement from "../features/accounts/AccountManagement.vue";
import DepartmentAdministration from "../features/projects/DepartmentAdministration.vue";
import MemberStorageSettings from "../features/settings/MemberStorageSettings.vue";
import SystemWorkflows from "../features/settings/SystemWorkflows.vue";
import EnvironmentPage from "../features/settings/EnvironmentPage.vue";
import AgentSuppliers from "../features/settings/AgentSuppliers.vue";
import SetupRecord from "../features/setup/SetupRecord.vue";
const route = useRoute(), router = useRouter();
const items = [{ id: 'accounts', label: '账号管理', icon: TeamOutlined }, { id: 'departments', label: '部门可用功能', icon: ApartmentOutlined }, { id: 'workflows', label: '流程编排', icon: BranchesOutlined }, { id: 'agent-suppliers', label: 'Agent 供应商', icon: ApiOutlined }, { id: 'environment', label: '环境检测', icon: DesktopOutlined }, { id: 'storage', label: '目录设置', icon: FolderOutlined }, { id: 'initialization', label: '初始化记录', icon: HistoryOutlined }];
const currentTab = computed(() => ['accounts', 'departments'].includes(route.name) ? route.name : items.some(item => item.id === route.query.tab) ? route.query.tab : 'storage');
usePageTitle(() => [translate(items.find(item => item.id === currentTab.value).label), translate("管理中心")]);
function select(tab) { void router.push({ name: ['accounts', 'departments'].includes(tab) ? tab : 'system', query: ['accounts', 'departments', 'storage'].includes(tab) ? {} : { tab } }); }
</script>
<template>
  <SettingsLayout :title="$t('管理中心')" :description="$t('组织、流程与运行平台，集中维护。')" :label="$t('组织与平台')" :items="items" :active="currentTab" @select="select">
    <AccountManagement v-if="currentTab === 'accounts'" embedded />
    <DepartmentAdministration v-else-if="currentTab === 'departments'" embedded />
    <AgentSuppliers v-else-if="currentTab === 'agent-suppliers'" />
    <EnvironmentPage v-else-if="currentTab === 'environment'" />
    <SystemWorkflows v-else-if="currentTab === 'workflows'" />
    <SetupRecord v-else-if="currentTab === 'initialization'" @continue="router.push({ name: 'setup' })" />
    <MemberStorageSettings v-else />
  </SettingsLayout>
</template>
