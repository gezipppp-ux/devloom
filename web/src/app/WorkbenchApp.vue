<script setup>
/* global document */
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { UserOutlined, LogoutOutlined, TeamOutlined, SettingOutlined, ArrowLeftOutlined, MenuOutlined, SearchOutlined } from "@antdv-next/icons";
import { useWorkspaceSelection } from "./use-workspace-selection.js";
import { useDesktopNotifications } from "../features/accounts/use-desktop-notifications.js";
import { accountSession, logoutAccount } from "../shared/api/account-session.js";
import { appApi } from "../shared/api/api.js";
import { useResource } from "../shared/api/use-resource.js";
import NavigationLinks from "./NavigationLinks.vue";
import WorkspaceConsole from "./WorkspaceConsole.vue";
import SystemSettings from "./SystemSettings.vue";
import RepositoryGitPanel from "../features/settings/RepositoryGitPanel.vue";
import PersonalSettings from "../features/accounts/PersonalSettings.vue";
import AccountManagement from "../features/accounts/AccountManagement.vue";
import ProjectDirectory from "../features/projects/ProjectDirectory.vue";
import ProjectOverview from "../features/projects/ProjectOverview.vue";
import DepartmentAdministration from "../features/projects/DepartmentAdministration.vue";
import WorkbenchHome from "../features/projects/WorkbenchHome.vue";
import WorkQueue from "../features/projects/WorkQueue.vue";
import GlobalSearch from "../features/projects/GlobalSearch.vue";
import FeedbackMessage from "../shared/components/FeedbackMessage.vue";
import ModalDialog from "../shared/components/ModalDialog.vue";
import LocaleSelect from "../shared/components/LocaleSelect.vue";
import "../shared/styles/projects.css";
import "../shared/styles/workbench.css";
const route = useRoute(), router = useRouter();
const { current, ready, error, standalone, navigate, reload: reloadWorkspace } = useWorkspaceSelection();
const directory = useResource(() => standalone.value ? Promise.resolve({ projects: [] }) : appApi("/projects"), { immediate: false, interval: 30000 });
watch(ready, value => { if (value && !standalone.value) void directory.reload(); });
const projects = computed(() => directory.data.value?.projects || []);
const desktopNotifications = useDesktopNotifications();
const admin = computed(() => accountSession.user?.role === "admin");
const logoutError = ref(""), menuOpen = ref(false), searchOpen = ref(false), createOpen = ref(false), createTarget = ref("issues");
const inWorkspace = computed(() => route.name === "workspace" && Boolean(route.query.workspace || standalone.value));
const active = computed(() => inWorkspace.value ? "development" : route.name === "project" ? "projects" : route.name);
const contextId = computed(() => String(route.params.projectId || route.query.projectId || (inWorkspace.value ? current.value?.projectId || "" : "")));
const selectedProject = computed(() => projects.value.find(project => project.id === contextId.value));
const personalReturn = computed(() => typeof route.query.returnTo === "string" && router.resolve(route.query.returnTo).name === "project" ? route.query.returnTo : "");
const createProjects = computed(() => projects.value.filter(project => project.status === "active" && project.permissions.includes(createTarget.value === "development" ? "code.view" : "issue.create")));
function selectTask(task) { if (route.query.task !== task) void router[route.query.task ? "push" : "replace"]({ query: { ...route.query, task } }); }
function page(name) { menuOpen.value = false; void router.push({ name, query: ["issues", "development", "deliveries"].includes(name) && contextId.value ? { projectId: contextId.value } : {} }); }
function project(id, tab = "overview", task) { void router.push({ name: "project", params: { projectId: id }, query: { tab, ...(task ? { task } : {}) } }); }
function openProject(value) { project(current.value.projectId, typeof value === "object" ? value.tab : value || "issues", value?.task); }
function tab(value) { void router.push({ query: { tab: value } }); }
function contextChange(value) { if (route.name === "project" || inWorkspace.value) { value ? project(value) : page("projects"); return; } void router.push({ query: { ...route.query, projectId: value || undefined, delivery: undefined, offset: undefined } }); }
function returnToProject() { const target = typeof route.query.returnTo === "string" ? router.resolve(route.query.returnTo) : null; if (target?.name === "project" && target.params.projectId === current.value?.projectId) void router.push(target.fullPath); else project(current.value.projectId); }
function create(target = "issues") { createTarget.value = target; createOpen.value = true; }
function chooseCreate(id) { createOpen.value = false; void router.push({ name: "project", params: { projectId: id }, query: { tab: createTarget.value, ...(createTarget.value === "issues" ? { create: "1" } : {}) } }); }
async function logout() { try { await logoutAccount(); } catch (failure) { logoutError.value = failure.message; } }
function shortcut(event) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchOpen.value = !searchOpen.value; } }
onMounted(() => document.addEventListener("keydown", shortcut)); onUnmounted(() => document.removeEventListener("keydown", shortcut));
watch(() => route.fullPath, () => { menuOpen.value = false; });
</script>
<template>
  <div class="authenticated-app neutral-app" :class="{ 'workspace-app': inWorkspace }">
    <a class="ui-skip" href="#workbench-content">{{ $t("跳到主要内容") }}</a>
    <aside class="ui-sidebar"><RouterLink class="ui-brand" to="/"><span aria-hidden="true">W</span><strong>WEB CODING</strong></RouterLink><nav class="ui-primary-nav" :aria-label="$t(&quot;主导航&quot;)"><NavigationLinks :active="active" @navigate="page" /></nav><nav class="ui-account-nav" :aria-label="$t(&quot;账号导航&quot;)"><button :class="{ active: route.name === 'personal' }" :title="$t(&quot;个人设置&quot;)" @click="page('personal')"><UserOutlined aria-hidden="true" /><span>{{ $t("个人设置") }}</span></button><template v-if="admin"><button :title="$t(&quot;部门可用功能&quot;)" @click="page('departments')"><TeamOutlined aria-hidden="true" /><span>{{ $t("部门可用功能") }}</span></button><button :title="$t(&quot;账号管理&quot;)" @click="page('accounts')"><TeamOutlined aria-hidden="true" /><span>{{ $t("账号管理") }}</span></button><button :title="$t(&quot;系统设置&quot;)" @click="page('system')"><SettingOutlined aria-hidden="true" /><span>{{ $t("系统设置") }}</span></button></template><button :title="$t(&quot;退出登录&quot;)" @click="logout"><LogoutOutlined aria-hidden="true" /><span>{{ $t("退出登录") }}</span></button></nav></aside>
    <div class="ui-shell-body"><header class="ui-topbar"><button class="ui-mobile-menu" :aria-label="$t(&quot;打开导航&quot;)" :aria-expanded="menuOpen" @click="menuOpen = true"><MenuOutlined aria-hidden="true" /></button><div class="ui-context"><span class="muted">{{ $t("当前项目") }}</span><select :aria-label="$t(&quot;当前项目&quot;)" :value="contextId" @change="contextChange($event.target.value)"><option value="">{{ $t("全部项目") }}</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option></select></div><div class="ui-topbar-actions"><button class="ui-global-search" :aria-label="$t(&quot;全局搜索&quot;)" @click="searchOpen = true"><SearchOutlined aria-hidden="true" /><span>{{ $t("搜索项目、事项或页面") }}</span><kbd>Ctrl K</kbd></button><LocaleSelect /><button class="ui-avatar" :title="accountSession.user?.displayName" :aria-label="$t(&quot;账号与个人设置&quot;)" @click="page('personal')">{{ accountSession.user?.displayName?.slice(0, 1) }}</button></div></header>
      <FeedbackMessage :message="logoutError || directory.error.value || error" type="error" />
      <button v-if="error && !ready" @click="reloadWorkspace">{{ $t('重新加载') }}</button>
      <div id="workbench-content" class="ui-content" tabindex="-1">
        <p v-if="!ready" role="status">{{ $t('正在加载…') }}</p><main v-else-if="['personal', 'system', 'accounts'].includes(route.name)" class="page-layout account-page-view"><button v-if="route.name === 'personal' && personalReturn" class="project-return-button" @click="router.push(personalReturn)">{{ $t("返回开发环境") }}</button><PersonalSettings v-if="route.name === 'personal'" :notifications="desktopNotifications" /><SystemSettings v-else-if="route.name === 'system' && admin" /><AccountManagement v-else-if="route.name === 'accounts' && admin" /></main>
        <DepartmentAdministration v-else-if="route.name === 'departments' && admin" />
        <ProjectOverview v-else-if="route.name === 'project'" :key="route.params.projectId" :project-id="route.params.projectId" :tab="String(route.query.tab || 'overview')" @tab="tab" @open-workspace="navigate" />
        <template v-else-if="inWorkspace"><WorkspaceConsole v-if="ready && (current || standalone) && (!current?.projectId || current?.permissions?.includes('session.view'))" :key="current?.id || 'standalone'" :initial-task="String(route.query.task || '')" :workspace-name="current?.name || ''" :project-id="current?.projectId || ''" :permissions="current?.permissions" :notify-unread-result="desktopNotifications.notifyResult" :can-manage-system="admin" @task-change="selectTask" @system-settings="page('system')" @return-project="returnToProject" @open-project="openProject" /><div v-else-if="ready && current?.permissions?.includes('code.view')" :key="current.id" class="workspace project-workspace"><aside class="sidebar"><div class="workspace-heading"><h2>{{ current.name }}</h2><button type="button" class="workspace-project-return" @click="returnToProject"><ArrowLeftOutlined aria-hidden="true" />{{ $t("返回项目协作") }}</button></div></aside><main><RepositoryGitPanel :can-operate="current.permissions.includes('code.operate')" /></main></div><FeedbackMessage v-else-if="error" :message="error" type="error" /><p v-else role="status">{{ $t("正在读取开发空间…") }}</p></template>
        <ProjectDirectory v-else-if="route.name === 'projects'" @open="project" />
        <WorkQueue v-else-if="['issues', 'development', 'deliveries'].includes(route.name)" :key="route.name + '/' + contextId" :kind="route.name === 'development' ? 'tasks' : route.name" :project-id="contextId" :can-publish="selectedProject?.permissions.includes('deliverable.create') && selectedProject.status === 'active'" @create="create" />
        <WorkbenchHome v-else-if="directory.data.value" :key="contextId" :project-id="contextId" :projects="selectedProject ? [selectedProject] : projects" @create="create" />
      </div>
    </div>
    <nav class="ui-bottom-nav" :aria-label="$t(&quot;移动端导航&quot;)"><NavigationLinks :active="active" @navigate="page" /></nav>
    <ModalDialog :open="menuOpen" :title="$t(&quot;导航&quot;)" @close="menuOpen = false"><nav class="ui-drawer-nav" :aria-label="$t(&quot;移动主导航&quot;)"><NavigationLinks :active="active" @navigate="page" /><button @click="page('personal')">{{ $t("个人设置") }}</button><template v-if="admin"><button @click="page('departments')">{{ $t("部门可用功能") }}</button><button @click="page('accounts')">{{ $t("账号管理") }}</button><button @click="page('system')">{{ $t("系统设置") }}</button></template><button @click="logout">{{ $t("退出登录") }}</button></nav></ModalDialog>
    <GlobalSearch v-if="searchOpen" :projects="projects" @close="searchOpen = false" />
    <ModalDialog :open="createOpen" :title="createTarget === 'issues' ? $t(&quot;选择事项所属项目&quot;) : $t(&quot;选择开发项目&quot;)" @close="createOpen = false"><div class="ui-project-choices"><button v-for="p in createProjects" :key="p.id" @click="chooseCreate(p.id)"><strong>{{ p.name }}</strong><span class="muted">{{ p.description }}</span></button><p v-if="!createProjects.length" class="muted">{{ $t("暂无允许此操作的项目，请先创建项目或联系项目负责人授权。") }}</p></div></ModalDialog>
  </div>
</template>
