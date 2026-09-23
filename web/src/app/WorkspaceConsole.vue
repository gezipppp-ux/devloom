<script setup>
/* global document */
import {
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import { statusLabel } from "../shared/api/api.js";
import { useWorkspaceConsole } from "./use-workspace-console.js";
import StartTask from "../features/tasks/StartTask.vue";
import SettingsPanel from "../features/settings/SettingsPanel.vue";
import RepositoryGitPanel from "../features/settings/RepositoryGitPanel.vue";
import SessionDetailsDrawer from "../features/session/SessionDetailsDrawer.vue";
import SessionItem from "../features/session/SessionItem.vue";
import SessionRequest from "../features/session/SessionRequest.vue";
import SessionComposer from "../features/session/SessionComposer.vue";
import SessionTitleEditor from "../features/session/SessionTitleEditor.vue";
import SessionLifecycleDialog from "../features/session/SessionLifecycleDialog.vue";
import { useSessionImages } from "../features/session/use-session-images.js";
import TaskList from "../features/tasks/TaskList.vue";
import ArchivedSessions from "../features/tasks/ArchivedSessions.vue";
import TaskMetadataControls from "../features/tasks/TaskMetadataControls.vue";
import {
  SettingOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  BranchesOutlined,
} from "@antdv-next/icons";

const props = defineProps({
  workspaceName: { type: String, default: "" },
  notifyUnreadResult: { type: Function, default: () => {} },
  canManageSystem: Boolean,
});
const emit = defineEmits([
  "rename-workspace",
  "unread-results-change",
  "system-settings",
]);
const settingsOpen = ref(false),
  creating = ref(false),
  repositoryOpen = ref(false);
const composer = reactive({ text: "" });
const timeline = ref();
const {
  channels,
  workspace,
  workspaceLoading,
  runs,
  active,
  session,
  loading,
  busy,
  online,
  error,
  notice,
  running,
  initializing,
  canSend,
  refreshList,
  refreshSession,
  open,
  action,
  older,
  reloadChannels,
  metadataSaved,
  titleSaved,
  archiveSaved,
  archiveRevision,
  archiveRestored,
  sessionDeleted,
  executionSettings,
  canEditSettings,
  settingsBusy,
  settingsError,
  updateExecutionSettings,
  unreadResultKeys,
  preferenceError,
  markResultRead,
} = useWorkspaceConsole({
  canRefresh: () => !creating.value,
  onOpen: () => {
    settingsOpen.value = false;
    creating.value = false;
    repositoryOpen.value = false;
    composer.text = "";
    imageDraft.reset();
  },
  onOpened: () => {
    markResultRead(active.value);
    return scroll();
  },
  onItem: () => {
    void scroll(false);
  },
  onEmpty: () => {
    if (props.workspaceName) settingsOpen.value = true;
  },
  onResultRead: ({ key }) =>
    active.value === key &&
    !settingsOpen.value &&
    !creating.value &&
    !repositoryOpen.value &&
    document.visibilityState === "visible",
  onUnreadResult: (result) => props.notifyUnreadResult(result),
});
const imageDraft = useSessionImages({ active, canSend });

function readVisibleSession() {
  if (
    document.visibilityState === "visible" &&
    !settingsOpen.value &&
    !creating.value &&
    !repositoryOpen.value &&
    active.value
  )
    markResultRead(active.value);
}

watch([settingsOpen, creating, repositoryOpen], readVisibleSession);
watch(
  unreadResultKeys,
  (keys) => emit("unread-results-change", keys.length > 0),
  { immediate: true },
);
onMounted(() =>
  document.addEventListener("visibilitychange", readVisibleSession),
);
onUnmounted(() =>
  document.removeEventListener("visibilitychange", readVisibleSession),
);

async function scroll(force = true) {
  await nextTick();
  const el = timeline.value;
  if (el && (force || el.scrollHeight - el.scrollTop - el.clientHeight < 180))
    el.scrollTop = el.scrollHeight;
}
async function send() {
  if (
    canSend.value &&
    !imageDraft.blocked.value &&
    (composer.text.trim() || imageDraft.images.value.length)
  ) {
    const data = { text: composer.text };
    if (imageDraft.images.value.length)
      data.images = imageDraft.images.value.map((image) => image.id);
    await action("messages", data, () => {
      composer.text = "";
      imageDraft.reset();
    });
  }
}
async function worktreeDeleted() {
  if (session.value)
    session.value.readOnlyReason =
      "Worktree 文件与本地分支已删除，会话历史只读。";
  await Promise.all([refreshSession(), refreshList()]).catch((e) => {
    error.value = e.message;
  });
}
</script>

<template>
  <div
    class="workspace"
    :class="{ 'with-workspace-rail': $slots['workspace-rail'] }"
  >
    <slot name="workspace-rail" />
    <aside class="sidebar">
      <div class="brand">
        <span v-if="!$slots['workspace-rail']" class="brand-mark">t_</span>
        <div>需求 <b>×</b> CODEX<small>开发工作台</small></div>
      </div>
      <div v-if="props.workspaceName" class="workspace-heading">
        <h2 :title="props.workspaceName">{{ props.workspaceName }}</h2>
        <button
          type="button"
          class="workspace-menu workspace-settings-button"
          :class="{ active: settingsOpen }"
          :disabled="workspaceLoading"
          :aria-pressed="settingsOpen"
          aria-label="工作区设置"
          title="工作区设置"
          @click="
            settingsOpen = true;
            repositoryOpen = false;
          "
        >
          <SettingOutlined aria-hidden="true" />
        </button>
      </div>
      <button
        v-if="!props.workspaceName"
        class="settings-link"
        :class="{ active: settingsOpen }"
        :disabled="workspaceLoading"
        @click="
          settingsOpen = true;
          repositoryOpen = false;
        "
      >
        <SettingOutlined aria-hidden="true" />
        执行设置
      </button>
      <button
        type="button"
        class="settings-link repository-link"
        :class="{ active: repositoryOpen }"
        :disabled="workspaceLoading"
        :aria-pressed="repositoryOpen"
        @click="
          repositoryOpen = true;
          settingsOpen = false;
          creating = false;
        "
      >
        <BranchesOutlined aria-hidden="true" />代码仓库
      </button>
      <button
        class="new-task"
        :disabled="workspaceLoading"
        @click="
          creating = true;
          settingsOpen = false;
          repositoryOpen = false;
        "
      >
        ＋ 从需求启动
      </button>
      <TaskList
        :runs="runs"
        :active="!creating && !settingsOpen && !repositoryOpen ? active : null"
        :unread-result-keys="unreadResultKeys"
        @open="open"
      />
      <ArchivedSessions :revision="archiveRevision" :disabled="workspaceLoading" @restored="archiveRestored" @deleted="sessionDeleted">
        <template #delete-dialog="{ run, deleted, close }">
          <SessionLifecycleDialog :key="run.key" mode="delete" :task-key="run.key" :title="run.title"
            :worktree="run.worktree" :deletion="run.worktreeDeletion"
            :active="['preparing', 'initializing', 'starting', 'running'].includes(run.status || run.execution?.status)"
            @deleted="deleted" @closed="close" />
        </template>
      </ArchivedSessions>
      <div class="sidebar-footer">
        <p v-if="preferenceError" class="error" role="alert">未读状态同步失败：{{ preferenceError }}</p>
        <span :class="['connection', { online }]"></span
        >{{ online ? "服务已连接" : "正在重连服务" }}
      </div>
    </aside>
    <main>
      <div class="page-breadcrumb" aria-label="当前位置">
        <span :title="props.workspaceName || '开发工作台'">{{
          props.workspaceName || "开发工作台"
        }}</span>
        <span aria-hidden="true">/</span>
        <strong>{{
          settingsOpen
            ? "工作区设置"
            : repositoryOpen
              ? "代码仓库"
              : creating
                ? "新需求"
                : session
                  ? "需求会话"
                  : "工作台"
        }}</strong>
      </div>
      <SettingsPanel
        v-if="settingsOpen"
        :can-manage-system="canManageSystem"
        @system-settings="emit('system-settings')"
        :workspace-name="props.workspaceName"
        @saved="reloadChannels"
        @rename-workspace="emit('rename-workspace')"
      />
      <StartTask
        v-else-if="creating"
        :channels="channels"
        :workspace="workspace"
        @cancel="creating = false"
        @started="
          (key) => {
            refreshList();
            open(key);
          }
        "
      />
      <RepositoryGitPanel v-else-if="repositoryOpen" />
      <template v-else-if="session">
        <header class="session-header" aria-label="会话工具栏">
          <SessionTitleEditor
            :key="session.key"
            :task-key="session.key"
            :title="session.title"
            @saved="titleSaved"
          />
          <div class="session-toolbar">
            <span
              class="status"
              :data-status="session.requests?.length ? 'waiting' : session.status"
              >Codex ·
              {{
                session.requests?.length
                  ? "等待你的输入"
                  : statusLabel(session.status)
              }}</span
            >
            <button :disabled="loading" @click="open(active)">
              <ReloadOutlined aria-hidden="true" /> 刷新
            </button>
          </div>
        </header>
        <div class="session-body">
          <div class="session-conversation">
            <div v-if="!online" class="banner warning" role="status">
              实时连接已断开，正在重连。服务运行时，关闭网页不会停止任务。
            </div>
            <div v-if="session.readOnlyReason" class="banner">
              {{ session.readOnlyReason }}
            </div>
            <div v-if="session.warning" class="banner warning">
              历史读取降级：{{ session.warning }}
            </div>
            <div
              ref="timeline"
              class="timeline"
              aria-label="会话记录"
              :aria-busy="loading"
            >
              <button
                v-if="session.nextCursor"
                class="load-older"
                :disabled="busy"
                @click="older"
              >
                加载更早记录 ↑
              </button>
              <p v-if="!session.items.length" class="empty-inline">
                {{
                  ["preparing", "initializing", "starting"].includes(session.status)
                    ? "正在抓取需求、下载图片并准备独立工作区…"
                    : "还没有消息，输入指令继续这个 session。"
                }}
              </p>
              <SessionItem
                v-for="item in session.items"
                :key="item.id"
                :item="item"
              /><SessionRequest
                v-for="request in session.requests"
                :key="request.id"
                :request="request"
                :disabled="busy || !online"
                @respond="(data) => action('responses', data)"
              />
              <p v-if="running" class="working-line">
                <span class="connection online"></span>Codex
                正在执行，可以补充指令或停止当前一轮。
              </p>
              <p v-if="initializing" class="working-line">
                <span class="connection online"></span>正在初始化
                worktree，完成后自动启动 Codex。
              </p>
            </div>
            <SessionComposer
              v-model="composer.text"
              :images="imageDraft.images.value"
              :images-uploading="imageDraft.uploading.value"
              :images-blocked="imageDraft.blocked.value"
              :images-error="imageDraft.error.value"
              :can-send="Boolean(canSend)"
              :running="running"
              :initializing="initializing"
              :busy="busy"
              :online="online"
              :read-only-reason="session.readOnlyReason || ''"
              :error="error || session.error || ''"
              :notice="notice"
              :execution-settings="executionSettings"
              :settings-pending="Boolean(session.settingsPending)"
              :settings-busy="settingsBusy"
              :settings-error="settingsError"
              :can-edit-settings="canEditSettings"
              @send="send"
              @images-add="imageDraft.add"
              @images-remove="imageDraft.remove"
              @images-retry="imageDraft.retry"
              @stop="action('interrupt', {})"
              @settings-change="updateExecutionSettings"
            />
          </div>
          <SessionDetailsDrawer
            :key="session.key"
            :session="session"
            :active="running || initializing || ['preparing', 'starting'].includes(session.status) || Boolean(session.requests?.length)"
            @archived="archiveSaved"
            @deleted="sessionDeleted"
            @worktree-deleted="worktreeDeleted"
          >
            <template #metadata>
              <TaskMetadataControls :task-key="session.key" :metadata="session.metadata" @saved="metadataSaved" />
            </template>
          </SessionDetailsDrawer>
        </div>
      </template>
      <section
        v-else
        class="empty-state"
        :aria-busy="workspaceLoading || loading"
      >
        <div class="empty-mark"><FolderOpenOutlined aria-hidden="true" /></div>
        <div class="eyebrow">需求 × CODEX</div>
        <h1>
          {{
            workspaceLoading
              ? "正在加载工作区…"
              : loading
                ? "正在加载会话…"
                : "让需求与开发，在这里连起来。"
          }}
        </h1>
        <p>查看执行过程、与 Codex 对话，随时调整下一步。</p>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <button
          v-if="!workspaceLoading && !loading"
          class="primary"
          @click="
            creating = true;
            settingsOpen = false;
            repositoryOpen = false;
          "
        >
          从需求启动 →
        </button>
      </section>
    </main>
  </div>
</template>
