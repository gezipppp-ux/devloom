<script setup>
/* global document */
import {
  nextTick,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import { statusLabel } from "../shared/api/api.js";
import FeedbackMessage from "../shared/components/FeedbackMessage.vue";
import { useWorkspaceConsole } from "./use-workspace-console.js";
import StartTask from "../features/tasks/StartTask.vue";
import AppendRequirements from "../features/tasks/AppendRequirements.vue";
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
import "../features/session/session-files.css";

const SessionFilePanel = defineAsyncComponent(() => import("../features/session/SessionFilePanel.vue"));

const props = defineProps({
  projectId: { type: String, default: "" },
  initialTask: { type: String, default: "" },
  permissions: { type: Array, default: null },
  workspaceName: { type: String, default: "" },
  notifyUnreadResult: { type: Function, default: () => {} },
  canManageSystem: Boolean,
});
const emit = defineEmits([
  "rename-workspace",
  "unread-results-change",
  "system-settings",
  "open-project",
  "task-change",
]);
const allowed = permission => !props.projectId || props.permissions?.includes(permission);
const settingsOpen = ref(false),
  creating = ref(false),
  repositoryOpen = ref(false);
const composer = reactive({ text: "" });
const timeline = ref();
const fileRequest = ref(null), fileWide = ref(false), detailsDrawer = ref();
let fileTrigger;
function openFile(request) {
  fileTrigger = document.activeElement;
  detailsDrawer.value?.close(false);
  fileRequest.value = { ...request };
}
function closeFile(restoreFocus = true) {
  fileRequest.value = null;
  if (restoreFocus) {
    if (fileTrigger?.isConnected) fileTrigger.focus({ preventScroll: true });
    else detailsDrawer.value?.focusTrigger();
  }
}
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
  waitingForInput,
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
  initialTask: () => props.initialTask,
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
    if (props.workspaceName && !props.projectId) settingsOpen.value = true;
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
watch(active, () => { closeFile(false); fileWide.value = false; });
watch(active, key => { if (key && key !== props.initialTask) emit("task-change", key); });

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
  const key = active.value;
  const previous = timeline.value;
  // SSE has updated Vue state, but the DOM still has the previous height.
  // Decide whether to follow before a long message grows the scroll range.
  const follow = force || (previous &&
    previous.scrollHeight - previous.scrollTop - previous.clientHeight < 180);
  await nextTick();
  const el = timeline.value;
  if (follow && el && active.value === key && (force || el === previous))
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
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
async function refreshCurrentSession() {
  error.value = "";
  try { await refreshSession(); }
  catch (failure) { error.value = failure.message; }
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
        <div>需求 <b>×</b> AGENT<small>开发工作台</small></div>
      </div>
      <div v-if="props.workspaceName" class="workspace-heading">
        <h2 :title="props.workspaceName">{{ props.workspaceName }}</h2>
        <button
          v-if="!props.projectId"
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
        v-if="!props.workspaceName && !props.projectId"
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
        v-if="allowed('code.view')"
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
        v-if="!props.projectId && allowed('session.start')"
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
      <button v-if="props.projectId && allowed('session.start')" class="new-task" @click="emit('open-project', 'issues')">从项目事项启动开发</button>
      <TaskList
        :runs="runs"
        :active="!creating && !settingsOpen && !repositoryOpen ? active : null"
        :unread-result-keys="unreadResultKeys"
        @open="open"
      />
      <ArchivedSessions v-if="allowed('session.continue')" :revision="archiveRevision" :disabled="workspaceLoading" @restored="archiveRestored" @deleted="sessionDeleted">
        <template #delete-dialog="{ run, deleted, close }">
          <SessionLifecycleDialog :key="run.key" mode="delete" :task-key="run.key" :title="run.title"
            :worktree="run.worktree" :deletion="run.worktreeDeletion"
            :active="['preparing', 'initializing', 'starting', 'running'].includes(run.status || run.execution?.status)"
            @deleted="deleted" @closed="close" />
        </template>
      </ArchivedSessions>
      <div class="sidebar-footer">
        <FeedbackMessage :message="preferenceError ? `未读状态同步失败：${preferenceError}` : ''" type="error" />
        <span :class="['connection', { online }]"></span
        >{{ online ? "服务已连接" : "正在重连服务" }}
      </div>
    </aside>
    <main>
      <SettingsPanel
        v-if="settingsOpen && !props.projectId"
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
        @open-task="open"
        @started="
          (key) => {
            refreshList();
            open(key);
          }
        "
      />
      <RepositoryGitPanel v-else-if="repositoryOpen" :can-operate="allowed('code.operate')" />
      <template v-else-if="session">
        <header class="session-header" aria-label="会话工具栏">
          <div class="page-breadcrumb" aria-label="当前位置">
            <span :title="props.workspaceName || '开发工作台'">{{ props.workspaceName || "开发工作台" }}</span>
            <span aria-hidden="true">/</span>
            <strong>需求会话</strong>
          </div>
          <SessionTitleEditor
            v-if="allowed('session.continue')"
            :key="session.key"
            :task-key="session.key"
            :title="session.title"
            @saved="titleSaved"
          />
          <h2 v-else>{{ session.title }}</h2>
          <div class="session-toolbar">
            <span
              class="status"
              :data-status="waitingForInput ? 'waiting' : session.status"
              >{{ session.agent?.label || 'Agent' }} ·
              {{
                waitingForInput
                  ? "等待你的输入"
                  : statusLabel(session.status)
              }}</span
            >
            <button :disabled="loading" @click="refreshCurrentSession">
              <ReloadOutlined aria-hidden="true" /> 刷新
            </button>
          </div>
        </header>
        <div class="session-body" :class="{ 'with-file-panel': fileRequest, 'file-panel-wide': fileRequest && fileWide }">
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
                :disabled="busy || session.agent?.capabilities?.history !== true"
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
                :agent-label="session.agent?.label || 'Agent'"
                @open-file="openFile"
              /><SessionRequest
                v-for="request in session.requests"
                :key="`${session.key}:${request.id}`"
                :request="request"
                :agent-label="session.agent?.label || 'Agent'"
                :disabled="busy || !online || !allowed('session.approve') || session.agent?.capabilities?.[request.kind === 'user-input' ? 'userInput' : 'approvals'] !== true"
                :error="error"
                :auto-open="request.id === session.requests.find((entry) => entry.kind === 'user-input' && entry.blocking !== false)?.id"
                @respond="(data) => action('responses', data)"
              />
              <p v-if="running" class="working-line">
                <span class="connection online"></span>{{ session.agent?.label || 'Agent' }}
                {{ waitingForInput ? '等待你的回答或审批，可停止当前一轮。' : '正在执行，可以补充指令或停止当前一轮。' }}
              </p>
              <p v-if="initializing" class="working-line">
                <span class="connection online"></span>正在初始化
                worktree，完成后自动启动 {{ session.agent?.label || 'Agent' }}。
              </p>
            </div>
            <SessionComposer
              v-model="composer.text"
              :agent="session.agent"
              :images="imageDraft.images.value"
              :images-uploading="imageDraft.uploading.value"
              :images-blocked="imageDraft.blocked.value"
              :images-error="imageDraft.error.value"
              :can-send="Boolean(canSend) && allowed('session.continue')"
              :can-stop="allowed('session.stop')"
              :running="running"
              :initializing="initializing"
              :busy="busy"
              :online="online"
              :read-only-reason="session.readOnlyReason || (!allowed('session.continue') ? '未获授继续会话权限' : '')"
              :error="error || session.error || ''"
              :notice="notice"
              :execution-settings="executionSettings"
              :settings-pending="Boolean(session.settingsPending)"
              :settings-busy="settingsBusy"
              :settings-error="settingsError"
              :can-edit-settings="canEditSettings && allowed('session.continue')"
              @send="send"
              @images-add="imageDraft.add"
              @images-remove="imageDraft.remove"
              @images-retry="imageDraft.retry"
              @stop="action('interrupt', {})"
              @settings-change="updateExecutionSettings"
            />
          </div>
          <SessionFilePanel v-if="fileRequest" :key="session.key" :task-key="session.key" :request="fileRequest" :wide="fileWide" :status="session.status" @close="closeFile" @resize="fileWide = !fileWide" />
          <SessionDetailsDrawer
            ref="detailsDrawer"
            :key="session.key"
            :session="session"
            :can-manage="allowed('session.continue')"
            :can-operate="allowed('code.operate')"
            :requirements-disabled="!canSend || busy || Boolean(session.archivedAt) || !allowed('session.continue')"
            @continue-requirements="action('requirements/continue', { id: $event })"
            :active="running || initializing || ['preparing', 'starting'].includes(session.status) || Boolean(session.requests?.length)"
            @archived="archiveSaved"
            @deleted="sessionDeleted"
            @worktree-deleted="worktreeDeleted"
            @open-file="openFile"
            @opened="closeFile(false)"
          >
            <template #metadata>
              <TaskMetadataControls v-if="allowed('session.continue')" :task-key="session.key" :metadata="session.metadata" @saved="metadataSaved" />
            </template>
            <template #append-requirements>
              <AppendRequirements v-if="session.source?.channel === 'tapd'" :key="session.key" :task-key="session.key" :workspace="workspace" :disabled="!canSend || running || busy || ['preparing', 'initializing', 'starting'].includes(session.status) || Boolean(session.archivedAt)" @saved="refreshSession(); refreshList()" @open-task="open" />
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
        <div class="eyebrow">需求 × AGENT</div>
        <h1>
          {{
            workspaceLoading
              ? "正在加载工作区…"
              : loading
                ? "正在加载会话…"
                : active ? "指定会话暂时无法打开" : props.projectId ? "尚无开发任务" : "让需求与开发，在这里连起来。"
          }}
        </h1>
        <p>{{ active ? '该会话可能尚未启动、已归档或不存在。请返回项目任务查看启动状态，或重试读取。' : '查看执行过程、与 Agent 对话，随时调整下一步。' }}</p>
        <FeedbackMessage :message="error" type="error" />
        <button v-if="active && !loading" @click="refreshCurrentSession">重试读取指定会话</button>
        <button v-if="props.projectId && active" @click="emit('open-project', 'tasks')">返回项目任务</button>
        <button
          v-if="!workspaceLoading && !loading && !props.projectId && allowed('session.start')"
          class="primary"
          @click="
            creating = true;
            settingsOpen = false;
            repositoryOpen = false;
          "
        >
          从需求启动 →
        </button>
        <button v-if="props.projectId && allowed('session.start')" class="primary" @click="emit('open-project', 'issues')">前往项目选择事项</button>
      </section>
    </main>
  </div>
</template>
