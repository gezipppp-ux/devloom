<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";
import { useResource } from "../../shared/api/use-resource.js";
import ProjectIssues from "./ProjectIssues.vue";
import ProjectAssets from "./ProjectAssets.vue";
import ProjectMembers from "./ProjectMembers.vue";
import ProjectPromptSettings from "./ProjectPromptSettings.vue";
import ProjectSettings from "./ProjectSettings.vue";
import ProjectDevelopment from "./ProjectDevelopment.vue";
import ProjectReleases from "./ProjectReleases.vue";
import ProjectTasks from "./ProjectTasks.vue";

const props = defineProps({ projectId: { type: String, required: true }, tab: { type: String, default: "overview" } });
const emit = defineEmits(["tab", "open-workspace"]);
const route = useRoute(), router = useRouter();
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(`/projects/${props.projectId}`), { interval: 15000 });
const can = permission => data.value?.permissions.includes(permission);
const archived = computed(() => data.value?.project.status === "archived");
const contentPermissions = computed(() => archived.value ? data.value.permissions.filter(p => p.endsWith(".view")) : data.value?.permissions || []);
const tabs = computed(() => [
  { id: "overview", label: "概览", show: true },
  { id: "issues", label: "需求", show: can("issue.view") },
  { id: "bugs", label: "Bug", show: can("issue.view") },
  { id: "tasks", label: "开发任务", show: can("issue.view") },
  { id: "releases", label: "版本", show: can("issue.view") },
  { id: "development", label: "代码与环境", show: can("code.view") },
  { id: "assets", label: "资产", show: can("asset.view") },
  { id: "members", label: "成员", show: true },
  { id: "prompts", label: "提示词", show: true },
  { id: "settings", label: "设置", show: can("project.configure") && !archived.value },
].filter(item => item.show));
const currentTab = computed(() => tabs.value.some(item => item.id === props.tab) ? props.tab : "overview");
const capabilityLabels = [
  ["issue.view", "需求与 Bug"], ["collaboration.view", "评论与交付"],
  ["code.view", "代码"], ["session.view", "Agent 会话"], ["asset.view", "项目资产"],
  ["project.members.manage", "成员授权"], ["project.configure", "项目配置"],
];
const available = permissions => capabilityLabels.filter(([id]) => permissions?.includes(id)).map(([, label]) => label).join("、") || "仅查看项目信息";
const managementOnly = computed(() => can("project.members.manage") && !["issue.view", "code.view", "asset.view"].some(can));
const developmentReason = computed(() => {
  if (can("session.start")) return "已获开发权限；准备好个人 Git 和仓库后，可在开发任务中开始开发。";
  if (data.value?.permissionContext?.administratorAccess) return "管理员需要开发时，也须加入项目，并由所属部门和项目分工共同授予代码与 Agent 权限。";
  if (data.value?.permissionContext?.ceiling.includes("session.start")) return "你的部门允许 Agent 开发，但本项目尚未为你授予启动权限。需要时由项目负责人调整分工。";
  return "你的部门未开放 Agent 开发。项目负责人只能在部门允许的范围内分配工作。";
});
function archive() { return save(`/projects/${props.projectId}/${archived.value ? "restore" : "archive"}`, { revision: data.value.project.revision }, () => { void reload(); }); }
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
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <p v-if="loading && !data" role="status">正在读取项目…</p>
    <template v-if="data">
      <header class="page-heading project-heading">
        <div><h1>{{ data.project.name }}</h1><p v-if="archived" class="warning">项目已归档，内容只读。</p></div>
        <button :disabled="loading" @click="reload">刷新项目</button>
      </header>
      <nav class="page-tabs project-navigation" aria-label="项目功能"><button v-for="item in tabs" :key="item.id" :class="{ active: currentTab === item.id }" :aria-current="currentTab === item.id ? 'page' : undefined" @click="emit('tab', item.id)">{{ item.label }}</button></nav>
      <p v-if="currentTab !== tab" class="warning" role="status">当前项目状态或你的分工未开放所选功能，可在下方查看当前权限。</p>
      <template v-if="currentTab === 'overview'">
        <section v-if="managementOnly && !archived" class="project-setup-callout" aria-label="完成项目配置">
          <h2>下一步：分配项目工作</h2><p>你是项目负责人，已具备配置和成员管理权限。请为自己及参与者选择工作内容，需求、资产和开发入口会按授权显示。</p>
          <button class="primary" @click="emit('tab', 'members')">配置本人及成员分工</button>
        </section>
        <div class="project-detail">
          <h2>项目概览</h2><p class="project-text">{{ data.project.description || '尚未填写项目说明。' }}</p>
          <dl class="project-facts"><dt>代码仓库</dt><dd>{{ data.project.remoteUrl }}</dd><dt>项目状态</dt><dd>{{ archived ? '已归档' : '进行中' }}</dd></dl>
          <section class="project-section" aria-label="我的项目权限">
            <h3>我在此项目可以做什么</h3><p>{{ available(data.permissions) }}</p>
            <p v-if="data.permissionContext?.administratorAccess" class="field-hint">你以系统管理员身份管理此项目，可维护成员、配置、需求/Bug、评论、交付及普通资产。代码、Agent 会话和敏感字段仍按本人部门及项目授权开放。</p>
            <p v-else-if="data.permissionContext" class="field-hint">我的部门：{{ data.permissionContext.departmentName }}。部门允许：{{ available(data.permissionContext.ceiling) }}。项目分工决定上述功能中哪些授予你。</p>
            <p v-if="!archived && (can('code.view') || can('project.members.manage'))" class="field-hint">{{ developmentReason }}</p>
            <div v-if="!archived" class="actions">
              <button v-if="can('project.members.manage')" @click="emit('tab', 'members')">调整项目分工</button>
              <button v-if="can('code.operate') && data.space?.status !== 'ready'" @click="emit('tab', 'development')">准备我的开发环境</button>
              <RouterLink v-if="accountSession.user?.role === 'admin'" to="/departments">管理部门可用功能</RouterLink>
            </div>
          </section>
          <details v-if="can('project.archive')"><summary>项目归档管理</summary><p>归档保留历史并禁止新开发任务。现有工作目录会保留。</p><button :disabled="saving" @click="archive">{{ archived ? '恢复项目' : '确认归档项目' }}</button></details>
        </div>
      </template>
      <ProjectIssues v-else-if="currentTab === 'issues' || currentTab === 'bugs'" :key="currentTab" :project-id="projectId" :type="currentTab === 'bugs' ? 'bug' : 'requirement'" :permissions="contentPermissions" @open-task="task => task.runKey ? emit('open-workspace', task.workspaceId, task.runKey) : router.push({ query: { tab: 'tasks', task: task.id } })" />
      <ProjectTasks v-else-if="currentTab === 'tasks'" :project-id="projectId" :space-ready="data.space?.status === 'ready'" :can-assign="contentPermissions.includes('issue.assign')" :can-continue="contentPermissions.includes('session.continue')" :read-only-reason="archived ? '项目已归档，开发任务只读。' : ''" @prepare-development="prepareDevelopment" @open-workspace="(id, key) => emit('open-workspace', id, key)" />
      <ProjectReleases v-else-if="currentTab === 'releases'" :project-id="projectId" :can-manage="contentPermissions.includes('release.manage')" />
      <ProjectAssets v-else-if="currentTab === 'assets'" :project-id="projectId" :permissions="contentPermissions" />
      <ProjectMembers v-else-if="currentTab === 'members'" :project-id="projectId" :can-manage="can('project.members.manage') && !archived" @saved="reload" />
      <ProjectPromptSettings v-else-if="currentTab === 'prompts'" :key="projectId" :project-id="projectId" @saved="reload" />
      <ProjectSettings v-else-if="currentTab === 'settings'" :project="data.project" @saved="reload" />
      <ProjectDevelopment v-else-if="currentTab === 'development'" :project-id="projectId" :remote-url="data.project.remoteUrl" :space="data.space" :can-view-session="can('session.view')" :can-start="can('code.operate') && !archived" @refresh="reload" @return-to-issue="returnToIssue" @open-workspace="(id, key) => emit('open-workspace', id, key)" />
    </template>
  </section>
</template>
