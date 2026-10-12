<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { UserOutlined, LogoutOutlined, TeamOutlined, SettingOutlined, FolderOpenOutlined } from "@antdv-next/icons";
import { useWorkspaceSelection } from "./use-workspace-selection.js";
import { useDesktopNotifications } from "../features/accounts/use-desktop-notifications.js";
import { accountSession, logoutAccount } from "../shared/api/account-session.js";
import WorkspaceConsole from "./WorkspaceConsole.vue";
import SystemSettings from "./SystemSettings.vue";
import RepositoryGitPanel from "../features/settings/RepositoryGitPanel.vue";
import PersonalSettings from "../features/accounts/PersonalSettings.vue";
import AccountManagement from "../features/accounts/AccountManagement.vue";
import ProjectDirectory from "../features/projects/ProjectDirectory.vue";
import ProjectOverview from "../features/projects/ProjectOverview.vue";
import DepartmentAdministration from "../features/projects/DepartmentAdministration.vue";
import FeedbackMessage from "../shared/components/FeedbackMessage.vue";
import "../shared/styles/projects.css";
const route = useRoute(), router = useRouter();
const { current, ready, error, standalone, navigate } = useWorkspaceSelection();
const desktopNotifications = useDesktopNotifications();
const admin = computed(() => accountSession.user?.role === "admin");
const logoutError = ref("");
const personalReturn = computed(() => {
  const target = typeof route.query.returnTo === "string" ? router.resolve(route.query.returnTo) : null;
  return target?.name === "project" ? target.fullPath : "";
});
function selectTask(task) { if (route.query.task !== task) void router[route.query.task ? "push" : "replace"]({ query: { ...route.query, task } }); }
function page(name) { void router.push({ name }); }
function project(id, tab = "overview") { void router.push({ name: "project", params: { projectId: id }, query: { tab } }); }
function tab(value) { void router.push({ query: { tab: value } }); }
function returnToProject() {
  const target = typeof route.query.returnTo === "string" ? router.resolve(route.query.returnTo) : null;
  if (target?.name === "project" && target.params.projectId === current.value?.projectId) void router.push(target.fullPath);
  else project(current.value.projectId);
}
async function logout() { try { await logoutAccount(); } catch (failure) { logoutError.value = failure.message; } }
</script>
<template>
  <div class="authenticated-app">
    <header class="account-bar"><span class="account-identity" :title="accountSession.user?.username"><UserOutlined aria-hidden="true" />{{ accountSession.user?.displayName }}</span><nav aria-label="账号导航">
      <button :class="{ active: route.name === 'workspace' && !route.query.workspace }" @click="page('workspace')"><FolderOpenOutlined aria-hidden="true" /><span>{{ admin ? "全部项目" : "我的项目" }}</span></button>
      <button :class="{ active: route.name === 'personal' }" @click="page('personal')"><UserOutlined aria-hidden="true" /><span>个人设置</span></button>
      <button v-if="admin" :class="{ active: route.name === 'departments' }" @click="page('departments')"><TeamOutlined aria-hidden="true" /><span>部门可用功能</span></button>
      <button v-if="admin" :class="{ active: route.name === 'accounts' }" @click="page('accounts')"><TeamOutlined aria-hidden="true" /><span>账号管理</span></button>
      <button v-if="admin" :class="{ active: route.name === 'system' }" @click="page('system')"><SettingOutlined aria-hidden="true" /><span>系统设置</span></button>
      <button @click="logout"><LogoutOutlined aria-hidden="true" /><span>退出登录</span></button>
    </nav></header>
    <FeedbackMessage :message="logoutError" type="error" />
    <main v-if="['personal', 'system', 'accounts'].includes(route.name)" class="system-settings-main account-page-view"><div class="page-breadcrumb"><button class="text-button" @click="page('workspace')">{{ admin ? "全部项目" : "我的项目" }}</button><span>/</span><strong>{{ { personal: '个人设置', system: '系统设置', accounts: '账号管理' }[route.name] }}</strong></div><button v-if="route.name === 'personal' && personalReturn" class="project-return-button" @click="router.push(personalReturn)">返回开发环境</button><PersonalSettings v-if="route.name === 'personal'" :notifications="desktopNotifications" /><SystemSettings v-else-if="route.name === 'system' && admin" /><AccountManagement v-else-if="route.name === 'accounts' && admin" /></main>
    <DepartmentAdministration v-else-if="route.name === 'departments' && admin" />
    <ProjectOverview v-else-if="route.name === 'project'" :key="route.params.projectId" :project-id="route.params.projectId" :tab="String(route.query.tab || 'overview')" @tab="tab" @back="page('workspace')" @open-workspace="navigate" />
    <template v-else-if="route.name === 'workspace' && (route.query.workspace || standalone)"><div v-if="current?.projectId" class="project-back"><button @click="returnToProject">返回项目协作</button></div><WorkspaceConsole v-if="ready && (current || standalone) && (!current?.projectId || current?.permissions?.includes('session.view'))" :key="current?.id || 'standalone'" :initial-task="String(route.query.task || '')" :workspace-name="current?.name || ''" :project-id="current?.projectId || ''" :permissions="current?.permissions" :notify-unread-result="desktopNotifications.notifyResult" :can-manage-system="admin" @task-change="selectTask" @system-settings="page('system')" @open-project="value => project(current.projectId, value || 'issues')" /><RepositoryGitPanel v-else-if="ready && current?.permissions?.includes('code.view')" :key="current.id" :can-operate="current.permissions.includes('code.operate')" /><FeedbackMessage v-else-if="error" :message="error" type="error" /><p v-else role="status">正在读取开发空间…</p></template>
    <ProjectDirectory v-else @open="project" />
  </div>
</template>
