<script setup>
import { ref } from "vue";
import { useWorkspaceSelection } from "./use-workspace-selection.js";
import { useDesktopNotifications } from "./use-desktop-notifications.js";
import WorkspaceConsole from "./WorkspaceConsole.vue";
import SystemSettings from "./SystemSettings.vue";
import WorkspacePicker from "../features/workspaces/WorkspacePicker.vue";

const picker = ref();
const {
  workspaces,
  current,
  ready,
  error,
  standalone,
  navigate,
  workspaceSaved,
} = useWorkspaceSelection();
const unreadWorkspaceIds = ref([]);
const systemSettingsOpen = ref(false);
const desktopNotifications = useDesktopNotifications();

function updateWorkspaceUnread(hasUnread) {
  const id = current.value?.id;
  if (!id) return;
  unreadWorkspaceIds.value = hasUnread
    ? [...new Set([...unreadWorkspaceIds.value, id])]
    : unreadWorkspaceIds.value.filter((entry) => entry !== id);
}

function selectWorkspace(id) {
  systemSettingsOpen.value = false;
  navigate(id);
}
</script>

<template>
  <SystemSettings
    v-if="ready && systemSettingsOpen && !standalone"
    :notification-available="desktopNotifications.available"
    :notification-permission="desktopNotifications.permission"
    :notifications-enabled="desktopNotifications.enabled"
    @notifications-toggle="desktopNotifications.toggle"
  >
    <template #workspace-rail>
      <WorkspacePicker
        ref="picker"
        rail
        :workspaces="workspaces"
        :current="current"
        :unread-workspace-ids="unreadWorkspaceIds"
        system-settings-open
        @select="selectWorkspace"
        @saved="workspaceSaved"
        @system-settings="systemSettingsOpen = true"
      />
    </template>
  </SystemSettings>
  <WorkspaceConsole
    v-else-if="ready && (current || standalone)"
    :key="current?.id || 'standalone'"
    :workspace-name="current?.name || ''"
    :notify-unread-result="desktopNotifications.notifyResult"
    @rename-workspace="picker?.edit(true)"
    @unread-results-change="updateWorkspaceUnread"
    @system-settings="systemSettingsOpen = true"
  >
    <template v-if="!standalone" #workspace-rail>
      <WorkspacePicker
        ref="picker"
        rail
        :workspaces="workspaces"
        :current="current"
        :unread-workspace-ids="unreadWorkspaceIds"
        @select="selectWorkspace"
        @saved="workspaceSaved"
        @system-settings="systemSettingsOpen = true"
      />
    </template>
  </WorkspaceConsole>
  <section v-else class="workspace-welcome">
    <div class="welcome-mark" aria-hidden="true">t_</div>
    <div class="eyebrow">需求 × CODEX</div>
    <h1>{{ ready ? "创建或选择工作区" : "正在连接工作台…" }}</h1>
    <p class="welcome-description">
      一个项目，一套配置。独立管理需求与开发会话。
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <WorkspacePicker
      v-if="ready"
      :workspaces="workspaces"
      @select="navigate"
      @saved="workspaceSaved"
    />
    <button
      v-if="ready && !standalone"
      type="button"
      class="welcome-system-settings"
      @click="systemSettingsOpen = true"
    >
      系统设置
    </button>
  </section>
</template>
