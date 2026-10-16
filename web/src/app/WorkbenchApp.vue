<script setup>
/* global document */
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CodeOutlined, FolderOutlined, SettingOutlined, ArrowLeftOutlined, MenuOutlined, SearchOutlined } from "@antdv-next/icons";
import { useWorkspaceSelection } from "./use-workspace-selection.js";
import { useDesktopNotifications } from "../features/accounts/use-desktop-notifications.js";
import { useAttentionNotifications } from "../features/accounts/use-attention-notifications.js";
import AttentionNotifications from "../features/accounts/AttentionNotifications.vue";
import { accountSession, logoutAccount } from "../shared/api/account-session.js";
import { appApi } from "../shared/api/api.js";
import { useResource } from "../shared/api/use-resource.js";
import NavigationLinks from "./NavigationLinks.vue";
import WorkspaceConsole from "./WorkspaceConsole.vue";
import SystemSettings from "./SystemSettings.vue";
import RepositoryGitPanel from "../features/settings/RepositoryGitPanel.vue";
import PersonalSettings from "../features/accounts/PersonalSettings.vue";
import ProjectDirectory from "../features/projects/ProjectDirectory.vue";
import ProjectOverview from "../features/projects/ProjectOverview.vue";
import WorkbenchHome from "../features/projects/WorkbenchHome.vue";
import WorkActionQueue from "../features/projects/WorkActionQueue.vue";
import WorkQueue from "../features/projects/WorkQueue.vue";
import GlobalSearch from "../features/projects/GlobalSearch.vue";
import ProjectPickerDialog from "../features/projects/ProjectPickerDialog.vue";
import { issueCreateLocation } from "../features/projects/work-navigation.js";
import FeedbackMessage from "../shared/components/FeedbackMessage.vue";
import ModalDialog from "../shared/components/ModalDialog.vue";
import AccountMenu from "../features/accounts/AccountMenu.vue";
import ToolbarSelect from "../shared/components/ToolbarSelect.vue";
import "../shared/styles/projects.css";
import "../shared/styles/workbench.css";
import "../shared/styles/workbench-pages.css";
const route = useRoute(), router = useRouter();
const { current, ready, error, standalone, navigate, reload: reloadWorkspace } = useWorkspaceSelection();
const directory = useResource(() => standalone.value ? Promise.resolve({ projects: [] }) : appApi("/projects"), { immediate: false, interval: 30000 });
watch(ready, value => { if (value && !standalone.value) void directory.reload(); });
const projects = computed(() => directory.data.value?.projects || []);
const desktopNotifications = useDesktopNotifications();
const attention = useAttentionNotifications(desktopNotifications.notifyAttention);
const admin = computed(() => accountSession.user?.role === "admin");
const logoutBusy = ref(false);
const logoutError = ref(""), menuOpen = ref(false), searchOpen = ref(false), createOpen = ref(false), createTarget = ref("issues");
const createBusy = ref(false), createError = ref(""), createSelected = ref("");
let createAttempt = 0;
const createTitles = { issues: "选择事项所属项目", bugs: "选择事项所属项目", development: "选择开发项目", manual: "选择独立开发项目", history: "选择要查看已归档会话的项目" };
const createPurposes = { issues: "新建需求", bugs: "新建 Bug", development: "开发", manual: "独立开发", history: "查看已归档会话" };
const inWorkspace = computed(() => route.name === "workspace" && Boolean(route.query.workspace || standalone.value));
const active = computed(() => inWorkspace.value || (route.name === "project" && route.query.tab === "tasks") ? "development" : route.name === "project" ? "projects" : route.name === "work" ? "workspace" : route.name);
const contextId = computed(() => String(route.params.projectId || route.query.projectId || (inWorkspace.value ? current.value?.projectId || "" : "")));
const breadcrumb = computed(() => route.name === "project" && route.query.create === "1" && ['issues', 'bugs'].includes(route.query.tab) ? "新建事项" : route.name === "project" && route.query.tab === "tasks" ? route.query.taskStart ? "确认并开始开发" : route.query.task ? "开发任务详情" : "开发任务" : ({ workspace: "工作台", projects: "项目", project: "项目概览", issues: "事项", development: "开发", deliveries: "交付", personal: "个人设置", system: "管理中心", accounts: "管理中心", departments: "管理中心" })[route.name] || "工作台");
const selectedProject = computed(() => projects.value.find(project => project.id === contextId.value));
const personalReturn = computed(() => typeof route.query.returnTo === "string" && router.resolve(route.query.returnTo).name === "project" ? route.query.returnTo : "");
const createProjects = computed(() => projects.value.filter(project => {
  const permission = { issues: "issue.create", bugs: "issue.create", development: "code.view", manual: "session.start", history: "session.continue" }[createTarget.value];
  return project.permissions.includes(permission) && (createTarget.value === "history" || project.status === "active");
}));
function selectTask(task) { if (route.query.task !== task) void router[route.query.task ? "push" : "replace"]({ query: { ...route.query, task, view: undefined } }); }
function page(name) { menuOpen.value = false; void router.push({ name, query: ["issues", "development", "deliveries"].includes(name) && contextId.value ? { projectId: contextId.value } : {} }); }
function project(id, tab = "overview", task) { void router.push({ name: "project", params: { projectId: id }, query: { tab, ...(task ? { task } : {}) } }); }
function openProject(value) { if (value?.delivery) { void router.push({ name: "deliveries", query: { projectId: current.value.projectId, delivery: value.delivery } }); return; } project(current.value.projectId, typeof value === "object" ? value.tab : value || "issues", value?.task); }
function tab(value) { void router.push({ query: { tab: value } }); }
function contextChange(value) { if (route.name === "project" || inWorkspace.value) { value ? project(value) : page("projects"); return; } void router.push({ query: { ...route.query, projectId: value || undefined, delivery: undefined, offset: undefined } }); }
function returnToProject() { const target = typeof route.query.returnTo === "string" ? router.resolve(route.query.returnTo) : null; if (target?.name === "project" && target.params.projectId === current.value?.projectId) void router.push(target.fullPath); else project(current.value.projectId); }
function closeCreate() { createAttempt++; createOpen.value = false; createBusy.value = false; createSelected.value = ""; }
function create(target = "issues") { closeCreate(); createError.value = ""; createTarget.value = target; createOpen.value = true; }
async function chooseCreate(id) {
  if (createBusy.value || !createProjects.value.some(project => project.id === id)) return;
  const target = createTarget.value, location = route.fullPath, attempt = ++createAttempt;
  if (["manual", "history"].includes(target)) {
    createBusy.value = true; createError.value = ""; createSelected.value = id;
    try {
      const result = await appApi(`/projects/${id}`);
      if (attempt !== createAttempt || !createOpen.value || createTarget.value !== target || route.fullPath !== location) return;
      if (result.space?.status === "ready") {
        const returnTo = router.resolve({ name: "project", params: { projectId: id }, query: { tab: "tasks" } }).fullPath;
        await navigate(result.space.workspaceId, undefined, { view: target, returnTo, isCurrent: () => attempt === createAttempt && createOpen.value });
        if (attempt === createAttempt) createOpen.value = false;
      } else {
        createOpen.value = false;
        await router.push({ name: "project", params: { projectId: id }, query: { tab: "development", openIntent: target } });
      }
    } catch (failure) { if (attempt === createAttempt && createOpen.value && route.fullPath === location) createError.value = failure.message; }
    finally { if (attempt === createAttempt) { createBusy.value = false; createSelected.value = ""; } }
    return;
  }
  createOpen.value = false;
  void router.push(["issues", "bugs"].includes(target) ? issueCreateLocation(id, target, location) : { name: "project", params: { projectId: id }, query: { tab: target } });
}
async function logout() { if (logoutBusy.value) return; logoutBusy.value = true; logoutError.value = ""; try { await logoutAccount(); } catch (failure) { logoutError.value = failure.message; } finally { logoutBusy.value = false; } }
function shortcut(event) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchOpen.value = !searchOpen.value; } }
onMounted(() => document.addEventListener("keydown", shortcut)); onUnmounted(() => { createAttempt++; document.removeEventListener("keydown", shortcut); });
watch(() => route.fullPath, () => { menuOpen.value = false; if (createOpen.value) closeCreate(); });
</script>
<template>
  <div class="authenticated-app neutral-app" :class="{ 'workspace-app': inWorkspace, 'personal-settings-app': route.name === 'personal' }">
    <a class="ui-skip" href="#workbench-content">{{ $t("跳到主要内容") }}</a>
    <aside class="ui-sidebar"><RouterLink class="ui-brand" to="/"><CodeOutlined aria-hidden="true" /><strong>DevLoom</strong></RouterLink><nav class="ui-primary-nav" :aria-label="$t('主导航')"><NavigationLinks :active="active" @navigate="page" /></nav><nav v-if="admin" class="ui-account-nav" :aria-label="$t('账号导航')"><button :class="{ active: ['system', 'accounts', 'departments'].includes(route.name) }" :title="$t('管理中心')" @click="page('accounts')"><SettingOutlined aria-hidden="true" /><span>{{ $t('管理中心') }}</span></button></nav></aside>
    <div class="ui-shell-body"><header class="ui-topbar"><button class="ui-mobile-menu" :aria-label="$t('打开导航')" :aria-expanded="menuOpen" @click="menuOpen = true"><MenuOutlined aria-hidden="true" /></button><div class="ui-context"><FolderOutlined aria-hidden="true" /><ToolbarSelect class="ui-project-select" :label="$t('当前项目')" :model-value="contextId" :options="[{ value: '', label: $t('全部项目') }, ...projects.map(project => ({ value: project.id, label: project.name }))]" @update:model-value="contextChange" /><span class="ui-context-divider">/</span><span class="ui-breadcrumb">{{ $t(breadcrumb) }}</span></div><div class="ui-topbar-actions"><button class="ui-global-search" :aria-label="$t('全局搜索')" @click="searchOpen = true"><SearchOutlined aria-hidden="true" /><span>{{ $t("搜索项目、事项或页面") }}</span><kbd>Ctrl K</kbd></button><AttentionNotifications :attention="attention" compact /><AccountMenu :user="accountSession.user" :busy="logoutBusy" :context-key="route.fullPath" @personal="page('personal')" @logout="logout" /></div></header>
      <FeedbackMessage :message="logoutError || directory.error.value || error" type="error" />
      <button v-if="error && !ready" @click="reloadWorkspace">{{ $t('重新加载') }}</button>
      <div id="workbench-content" class="ui-content" tabindex="-1">
        <p v-if="!ready" role="status">{{ $t('正在加载…') }}</p><main v-else-if="['personal', 'system', 'accounts', 'departments'].includes(route.name)" class="page-layout account-page-view"><button v-if="route.name === 'personal' && personalReturn" class="project-return-button" @click="router.push(personalReturn)">{{ $t("返回开发环境") }}</button><PersonalSettings v-if="route.name === 'personal'" :notifications="desktopNotifications" /><SystemSettings v-else-if="admin" /></main>
        <ProjectOverview v-else-if="route.name === 'project'" :key="route.params.projectId" :project-id="route.params.projectId" :tab="String(route.query.tab || 'overview')" @tab="tab" @open-workspace="navigate" />
        <template v-else-if="inWorkspace"><WorkspaceConsole v-if="ready && (current || standalone) && (!current?.projectId || current?.permissions?.includes('session.view'))" :key="current?.id || 'standalone'" :initial-task="String(route.query.task || '')" :initial-view="String(route.query.view || '')" :workspace-name="current?.name || ''" :project-id="current?.projectId || ''" :permissions="current?.permissions" :notify-unread-result="desktopNotifications.notifyResult" :can-manage-system="admin" @task-change="selectTask" @system-settings="page('system')" @return-project="returnToProject" @open-project="openProject" /><div v-else-if="ready && current?.permissions?.includes('code.view')" :key="current.id" class="workspace project-workspace"><aside class="sidebar"><div class="workspace-heading"><h2>{{ current.name }}</h2><button type="button" class="workspace-project-return" @click="returnToProject"><ArrowLeftOutlined aria-hidden="true" />{{ $t("返回项目协作") }}</button></div></aside><main><RepositoryGitPanel :can-operate="current.permissions.includes('code.operate')" /></main></div><FeedbackMessage v-else-if="error" :message="error" type="error" /><p v-else role="status">{{ $t("正在读取开发空间…") }}</p></template>
        <ProjectDirectory v-else-if="route.name === 'projects'" @open="project" />
        <WorkActionQueue v-else-if="route.name === 'work'" :key="contextId" :project-id="contextId" />
        <WorkQueue v-else-if="['issues', 'development', 'deliveries'].includes(route.name)" :key="route.name + '/' + contextId" :kind="route.name === 'development' ? 'tasks' : route.name" :project-id="contextId" :can-publish="selectedProject?.permissions.includes('deliverable.create') && selectedProject.status === 'active'" @create="create" @open-workspace="navigate" />
        <WorkbenchHome v-else-if="directory.data.value" :key="contextId" :project-id="contextId" :projects="selectedProject ? [selectedProject] : projects" @create="create" />
      </div>
    </div>
    <nav class="ui-bottom-nav" :aria-label="$t('移动端导航')"><NavigationLinks compact :active="active" @navigate="page" /></nav>
    <ModalDialog :open="menuOpen" :title="$t('导航')" @close="menuOpen = false"><nav class="ui-drawer-nav" :aria-label="$t('移动主导航')"><button class="ui-drawer-search" @click="menuOpen = false; searchOpen = true"><SearchOutlined aria-hidden="true" />{{ $t('全局搜索') }}</button><NavigationLinks :active="active" @navigate="page" /><button v-if="admin" @click="page('accounts')">{{ $t("管理中心") }}</button></nav></ModalDialog>
    <GlobalSearch v-if="searchOpen" :projects="projects" @close="searchOpen = false" />
    <ProjectPickerDialog v-if="createOpen" :title="createTitles[createTarget] || '选择开发项目'" :purpose="createPurposes[createTarget] || '开发'" :projects="createProjects" :busy="createBusy" :selected-id="createSelected" :error="createError" @choose="chooseCreate" @close="closeCreate" />
  </div>
</template>
