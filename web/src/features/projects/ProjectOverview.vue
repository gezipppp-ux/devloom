<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { usePageTitle } from "../../shared/components/page-title.js";
import { translate } from "../../shared/i18n/index.js";
import { computed, ref, watch, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import ProjectIssues from "./ProjectIssues.vue";
import IssueCreate from "./IssueCreate.vue";
import IssueCreateMenu from "./IssueCreateMenu.vue";
import { issueCreateLocation } from "./work-navigation.js";
import ProjectAssets from "./ProjectAssets.vue";
import ProjectMembers from "./ProjectMembers.vue";
import ProjectPromptSettings from "./ProjectPromptSettings.vue";
import ProjectSettings from "./ProjectSettings.vue";
import ProjectDevelopment from "./ProjectDevelopment.vue";
import ProjectReleases from "./ProjectReleases.vue";
import ProjectTasks from "./ProjectTasks.vue";
import WorkQueue from "./WorkQueue.vue";
import ProjectDashboard from "./ProjectDashboard.vue";
import PageHeader from "../../shared/components/PageHeader.vue";
import { PlusOutlined, ReloadOutlined } from "@antdv-next/icons";

const props = defineProps({ projectId: { type: String, required: true }, tab: { type: String, default: "overview" } });
const emit = defineEmits(["tab", "open-workspace"]);
const route = useRoute(), router = useRouter();
const { data, loading, error, notice, reload } = useResource(() => appApi(`/projects/${props.projectId}`), { interval: 15000 });
const visitError = ref("");
let visitRecorded = false, mounted = true;
onUnmounted(() => { mounted = false; });
watch(data, value => {
  if (!value || visitRecorded) return;
  visitRecorded = true;
  void appApi(`/projects/${props.projectId}/visit`, {}).catch(failure => { if (mounted) visitError.value = failure.message; });
});
const can = permission => data.value?.permissions.includes(permission);
const archived = computed(() => data.value?.project.status === "archived");
const contentPermissions = computed(() => archived.value ? data.value.permissions.filter(p => p.endsWith(".view")) : data.value?.permissions || []);
const tabs = computed(() => [
  { id: "overview", label: "概览", show: true },
  { id: "releases", label: "版本", show: can("issue.view") },
  { id: "assets", label: "资产", show: can("asset.view") },
  { id: "members", label: "成员", show: true },
  { id: "settings", label: "设置", show: can("project.configure") || can("project.archive") },
  { id: "prompts", label: "提示词", show: true },
  { id: "issues", label: "需求", show: can("issue.view") },
  { id: "bugs", label: "Bug", show: can("issue.view") },
  { id: "tasks", label: "开发任务", show: can("issue.view") },
  { id: "deliveries", label: "交付", show: can("collaboration.view") && can("issue.view") },
  { id: "development", label: "代码与环境", show: can("code.view") },
].filter(item => item.show));
const primaryTabs = computed(() => tabs.value.filter(item => ["overview", "releases", "assets", "members", "settings", "prompts"].includes(item.id)));
const secondaryTabs = computed(() => tabs.value.filter(item => !primaryTabs.value.includes(item)));
const currentTab = computed(() => tabs.value.some(item => item.id === props.tab) ? props.tab : "overview");
const actionPanel = ref(null);
const issueDetailOpen = computed(() => ['issues', 'bugs'].includes(currentTab.value) && typeof route.query.issue === 'string' && Boolean(route.query.issue));
const issueCreateOpen = computed(() => ['issues', 'bugs'].includes(currentTab.value) && route.query.create === '1' && !issueDetailOpen.value);
const releaseDetailOpen = computed(() => currentTab.value === 'releases' && typeof route.query.release === 'string' && Boolean(route.query.release));
const taskDetailOpen = computed(() => currentTab.value === 'tasks' && typeof route.query.task === 'string' && Boolean(route.query.task));
const standaloneDetail = computed(() => issueCreateOpen.value || issueDetailOpen.value || releaseDetailOpen.value || taskDetailOpen.value);
usePageTitle(() => {
  if (!data.value || error.value) return [translate("项目概览")];
  const name = data.value.project.name;
  if (issueCreateOpen.value) return [translate(currentTab.value === "bugs" ? "新建 Bug" : "新建需求"), name];
  return currentTab.value === "overview" ? [name] : [name, translate(tabs.value.find(tab => tab.id === currentTab.value)?.label)];
});
const pageCopy = computed(() => ({
  releases: { title: '版本', description: '用清晰的范围，推动每一次交付。' },
  assets: { title: '项目资产', description: '把重要的文档、链接和上下文放在一起。' },
  members: { title: '项目成员', description: '围绕工作授权，让每位参与者都能顺畅协作。' },
  settings: { title: '项目配置', description: '维护项目基础信息与执行前的准备。' },
  prompts: { title: '提示词', description: '管理项目默认与个人模板，让开发指令更清晰。' },
})[currentTab.value]);
const contextualAction = computed(() => ({
  releases: { label: '新建版本', permission: 'release.manage' },
  assets: { label: '新建资产', permission: 'asset.edit' },
  members: { label: '添加成员', permission: 'project.members.manage' },
})[currentTab.value]);
const managementOnly = computed(() => can("project.members.manage") && !["issue.view", "code.view", "asset.view"].some(can));
function prepareDevelopment(issue) {
  void router.push({ query: { ...route.query, tab: "development", issue: undefined, task: undefined, returnIssue: currentTab.value === "tasks" ? undefined : issue?.id, returnTask: currentTab.value === "tasks" ? issue?.id : undefined, returnTab: currentTab.value } });
}
function returnToIssue() {
  const { returnIssue, returnTask, returnTab, ...query } = route.query;
  void router.push({ query: { ...query, tab: returnTab === "tasks" ? "tasks" : returnTab === "bugs" ? "bugs" : "issues", ...(returnTask ? { task: returnTask } : {}), ...(returnIssue ? { issue: returnIssue } : {}) } });
}
</script>

<template>
  <section class="page-layout project-page">
    <FeedbackMessage :message="error || visitError" type="error" /><FeedbackMessage :message="notice" type="success" />
    <p v-if="loading && !data" role="status">{{ $t("正在读取项目…") }}</p>
    <template v-if="data">
      <PageHeader v-if="!standaloneDetail" :title="pageCopy ? $t(pageCopy.title) : data.project.name" :description="pageCopy ? $t(pageCopy.description) : data.project.description"><template #meta><p v-if="archived" class="warning">{{ $t('项目已归档，内容只读。') }}</p></template><button class="ui-icon-button" :aria-label="$t('刷新项目')" :title="$t('刷新项目')" :disabled="loading" @click="reload"><ReloadOutlined aria-hidden="true" /></button><template v-if="contextualAction"><button v-if="contentPermissions.includes(contextualAction.permission)" class="primary" :disabled="!actionPanel || actionPanel.creationDisabled" @click="actionPanel.create($event)"><PlusOutlined aria-hidden="true" />{{ $t(contextualAction.label) }}</button></template><IssueCreateMenu v-else-if="!pageCopy && !['issues', 'bugs'].includes(currentTab) && contentPermissions.includes('issue.create')" @create="target => router.push(issueCreateLocation(projectId, target, route.fullPath))" /></PageHeader>
      <div v-if="!standaloneDetail" class="project-tab-bar"><nav class="page-tabs project-navigation" :aria-label="$t('项目功能')"><button v-for="item in primaryTabs" :key="item.id" :class="{ active: currentTab === item.id }" :aria-current="currentTab === item.id ? 'page' : undefined" @click="emit('tab', item.id)">{{ $t(item.label) }}</button></nav><details v-if="secondaryTabs.length" class="project-more"><summary>{{ secondaryTabs.find(item => item.id === currentTab) ? $t(secondaryTabs.find(item => item.id === currentTab).label) : $t('协作入口') }}</summary><nav :aria-label="$t('项目协作')"><button v-for="item in secondaryTabs" :key="item.id" :aria-current="currentTab === item.id ? 'page' : undefined" @click="emit('tab', item.id); $event.target.closest('details').open = false">{{ $t(item.label) }}</button></nav></details></div>
      <p v-if="currentTab !== tab" class="warning" role="status">{{ $t("当前项目状态或你的分工未开放所选功能，可在下方查看当前权限。") }}</p>
      <IssueCreate v-if="issueCreateOpen" :project-id="projectId" :project-name="data.project.name" :type="currentTab === 'bugs' ? 'bug' : 'requirement'" :permissions="contentPermissions" />
      <template v-else-if="currentTab === 'overview'">
        <section v-if="managementOnly && !archived" class="project-setup-callout" :aria-label="$t('完成项目配置')">
          <h2>{{ $t("下一步：分配项目工作") }}</h2><p>{{ $t("你是项目负责人，已具备配置和成员管理权限。请为自己及参与者选择工作内容，需求、资产和开发入口会按授权显示。") }}</p>
          <button class="primary" @click="emit('tab', 'members')">{{ $t("配置本人及成员分工") }}</button>
        </section>
        <ProjectDashboard :key="data.project.id + '/' + data.permissions.join(',')" :project="data.project" :permissions="data.permissions" @tab="emit('tab', $event)" />
      </template>
      <ProjectIssues v-else-if="currentTab === 'issues' || currentTab === 'bugs'" :key="currentTab" :project-id="projectId" :project-name="data.project.name" :type="currentTab === 'bugs' ? 'bug' : 'requirement'" :permissions="contentPermissions" @open-task="task => task.runKey ? emit('open-workspace', task.workspaceId, task.runKey) : router.push({ query: { tab: 'tasks', task: task.id } })" />
      <ProjectTasks v-else-if="currentTab === 'tasks'" :project-id="projectId" :project-name="data.project.name" :workspace-id="data.space?.workspaceId || ''" :space-ready="data.space?.status === 'ready'" :can-assign="contentPermissions.includes('issue.assign')" :can-continue="contentPermissions.includes('session.continue')" :read-only-reason="archived ? '项目已归档，开发任务只读。' : ''" @prepare-development="prepareDevelopment" @open-workspace="(id, key, options) => emit('open-workspace', id, key, options)" />
      <ProjectReleases v-else-if="currentTab === 'releases'" ref="actionPanel" :project-id="projectId" :project-name="data.project.name" :can-manage="contentPermissions.includes('release.manage')" header-action />
      <WorkQueue v-else-if="currentTab === 'deliveries'" kind="deliveries" :project-id="projectId" :can-publish="contentPermissions.includes('deliverable.create')" />
      <ProjectAssets v-else-if="currentTab === 'assets'" ref="actionPanel" :project-id="projectId" :project-name="data.project.name" :permissions="contentPermissions" header-action />
      <ProjectMembers v-else-if="currentTab === 'members'" ref="actionPanel" :project-id="projectId" :can-manage="can('project.members.manage') && !archived" header-action @saved="reload" />
      <ProjectPromptSettings v-else-if="currentTab === 'prompts'" :key="projectId" :project-id="projectId" @saved="reload" />
      <ProjectSettings v-else-if="currentTab === 'settings'" :project="data.project" :can-configure="can('project.configure') && !archived" :can-archive="can('project.archive')" :can-manage-members="can('project.members.manage') && !archived" @members="emit('tab', 'members')" @saved="reload" />
      <ProjectDevelopment v-else-if="currentTab === 'development'" :project-id="projectId" :remote-url="data.project.remoteUrl" :space="data.space" :can-view-session="can('session.view')" :can-start="can('code.operate') && !archived" @refresh="reload" @browse="router.push({ query: { ...route.query, tab: 'overview' } })" @return-to-issue="returnToIssue" @open-workspace="(id, key, options) => emit('open-workspace', id, key, options)" />
    </template>
  </section>
</template>
