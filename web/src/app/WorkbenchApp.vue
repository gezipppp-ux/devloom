<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { UserOutlined, LogoutOutlined, TeamOutlined, SettingOutlined } from "@antdv-next/icons";
import { useWorkspaceSelection } from "./use-workspace-selection.js";
import { useDesktopNotifications } from "../features/accounts/use-desktop-notifications.js";
import { accountSession, logoutAccount } from "../shared/api/account-session.js";
import WorkspaceConsole from "./WorkspaceConsole.vue";
import SystemSettings from "./SystemSettings.vue";
import PersonalSettings from "../features/accounts/PersonalSettings.vue";
import AccountManagement from "../features/accounts/AccountManagement.vue";
import WorkspacePicker from "../features/workspaces/WorkspacePicker.vue";
import WorkspaceCloneProgress from "../features/workspaces/WorkspaceCloneProgress.vue";
import { useWorkspaceClones } from "../features/workspaces/use-workspace-clones.js";

const picker = ref();
const route = useRoute();
const router = useRouter();
const { workspaces, current, ready, error, standalone, navigate, workspaceSaved } = useWorkspaceSelection();
const unreadWorkspaceIds = ref([]);
const desktopNotifications = useDesktopNotifications();
const admin = computed(() => accountSession.user?.role === "admin");
const accountPage = computed(() => ["personal", "system", "accounts"].includes(route.name));
const logoutError = ref("");
const cloneProgress = ref();
const { clones, error: cloneError, start: createWorkspace, dismiss: dismissClone } = useWorkspaceClones({
  enabled: computed(() => ready.value && !standalone.value),
  onCompleted(clone) {
    if (!workspaces.value.some(workspace => workspace.id === clone.workspace.id))
      workspaceSaved(clone.workspace, false);
  },
});
function cloneStarted() { cloneProgress.value?.open(); }
function page(name) { void router.push({ name, query: route.query }); }
function updateWorkspaceUnread(hasUnread) {
  const id = current.value?.id;
  if (!id) return;
  unreadWorkspaceIds.value = hasUnread
    ? [...new Set([...unreadWorkspaceIds.value, id])]
    : unreadWorkspaceIds.value.filter((entry) => entry !== id);
}
async function logout() {
  try { await logoutAccount(); }
  catch (error) { logoutError.value = error.message; }
}
</script>

<template>
  <div class="authenticated-app">
    <header class="account-bar">
      <span class="account-identity" :title="accountSession.user?.username"><UserOutlined aria-hidden="true" />{{ accountSession.user?.username }}</span>
      <nav aria-label="账号导航">
        <WorkspaceCloneProgress v-if="!standalone" ref="cloneProgress" :clones="clones" :error="cloneError" :dismiss="dismissClone" @open-workspace="navigate" />
        <button :class="{ active: route.name === 'personal' }" @click="page('personal')"><UserOutlined aria-hidden="true" /><span>个人设置</span></button>
        <button v-if="admin" :class="{ active: route.name === 'system' }" @click="page('system')"><SettingOutlined aria-hidden="true" /><span>系统设置</span></button>
        <button v-if="admin" :class="{ active: route.name === 'accounts' }" @click="page('accounts')"><TeamOutlined aria-hidden="true" /><span>账号管理</span></button>
        <button @click="logout"><LogoutOutlined aria-hidden="true" /><span>退出登录</span></button>
      </nav>
    </header>
    <p v-if="logoutError" class="error" role="alert">{{ logoutError }}</p>
    <div v-if="accountPage" class="system-settings-view account-page-view">
      <WorkspacePicker v-if="ready && !standalone" ref="picker" rail :workspaces="workspaces" :current="current" :unread-workspace-ids="unreadWorkspaceIds" :system-settings-open="true" :show-system-settings="false" :create-workspace="createWorkspace" @clone-started="cloneStarted" @select="navigate" @saved="workspaceSaved" />
      <main class="system-settings-main">
        <div class="page-breadcrumb"><button class="text-button" @click="page('workspace')">工作台</button><span aria-hidden="true">/</span><strong>{{ route.name === 'personal' ? '个人设置' : route.name === 'system' ? '系统设置' : '账号管理' }}</strong></div>
        <PersonalSettings v-if="route.name === 'personal'" :notifications="desktopNotifications" />
        <SystemSettings v-else-if="route.name === 'system' && admin" />
        <AccountManagement v-else-if="route.name === 'accounts' && admin" />
      </main>
    </div>
    <WorkspaceConsole v-else-if="ready && (current || standalone)" :key="current?.id || 'standalone'" :workspace-name="current?.name || ''" :notify-unread-result="desktopNotifications.notifyResult" :can-manage-system="admin" @rename-workspace="picker?.edit(true)" @unread-results-change="updateWorkspaceUnread" @system-settings="page('system')">
      <template v-if="!standalone" #workspace-rail>
        <WorkspacePicker ref="picker" rail :workspaces="workspaces" :current="current" :unread-workspace-ids="unreadWorkspaceIds" :show-system-settings="false" :create-workspace="createWorkspace" @clone-started="cloneStarted" @select="navigate" @saved="workspaceSaved" />
      </template>
    </WorkspaceConsole>
    <section v-else class="workspace-welcome">
      <div class="welcome-mark" aria-hidden="true">t_</div><div class="eyebrow">需求 × CODEX</div>
      <h1>{{ ready ? "创建或选择工作区" : "正在连接工作台…" }}</h1>
      <p class="welcome-description">一个项目，一套配置。工作区与需求仅属于你的账号。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <WorkspacePicker v-if="ready" :workspaces="workspaces" :create-workspace="createWorkspace" @clone-started="cloneStarted" @select="navigate" @saved="workspaceSaved" />
    </section>
  </div>
</template>
