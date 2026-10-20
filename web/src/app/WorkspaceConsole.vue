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
import { usePageTitle } from "../shared/components/page-title.js";
import { translate } from "../shared/i18n/index.js";
import FeedbackMessage from "../shared/components/FeedbackMessage.vue";
import { useWorkspaceConsole } from "./use-workspace-console.js";
import ModalDialog from "../shared/components/ModalDialog.vue";
import PublishDelivery from "../features/projects/PublishDelivery.vue";
import StartTask from "../features/tasks/StartTask.vue";
import ManualDevelopmentStart from "../features/tasks/ManualDevelopmentStart.vue";
import RemoteBranchSelect from "../features/projects/RemoteBranchSelect.vue";
import SettingsPanel from "../features/settings/SettingsPanel.vue";
import RepositoryGitPanel from "../features/settings/RepositoryGitPanel.vue";
import SessionDetailsDrawer from "../features/session/SessionDetailsDrawer.vue";
import SessionTimeline from "../features/session/SessionTimeline.vue";
import SessionRequest from "../features/session/SessionRequest.vue";
import SessionComposer from "../features/session/SessionComposer.vue";
import SessionTitleEditor from "../features/session/SessionTitleEditor.vue";
import SessionLifecycleDialog from "../features/session/SessionLifecycleDialog.vue";
import { useSessionImages } from "../features/session/use-session-images.js";
import TaskList from "../features/tasks/TaskList.vue";
import ArchivedSessions from "../features/tasks/ArchivedSessions.vue";
import {
  ReloadOutlined,
  FolderOpenOutlined,
  BranchesOutlined,
  ArrowLeftOutlined,
} from "@antdv-next/icons";
import "../features/session/session-files.css";

const SessionFilePanel = defineAsyncComponent(() => import("../features/session/SessionFilePanel.vue"));

const props = defineProps({
  projectId: { type: String, default: "" },
  initialTask: { type: String, default: "" },
  initialView: { type: String, default: "" },
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
  "return-project",
  "task-change",
]);
const allowed = permission => !props.projectId || props.permissions?.includes(permission);
const sessionPicker = ref(false), publishing = ref(false);
const settingsOpen = ref(false),
  creating = ref(false),
  repositoryOpen = ref(false);
const composer = reactive({ text: "" });
const timeline = ref();
const fileRequest = ref(null), detailsDrawer = ref();
let fileTrigger;
function openFile(request) {
  fileTrigger = document.activeElement;
  detailsDrawer.value?.close(false);
  fileRequest.value = { ...request };
}
async function closeFile(restoreFocus = true) {
  fileRequest.value = null;
  await nextTick();
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
    sessionPicker.value = false; publishing.value = false;
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
usePageTitle(() => {
  if (creating.value) return [translate("独立开发")];
  if (settingsOpen.value && !props.projectId) return [translate(props.workspaceName ? "工作区设置" : "执行设置")];
  if (repositoryOpen.value) return [translate("代码仓库")];
  const title = session.value?.key === active.value && !error.value ? session.value?.title : "";
  return [title, translate("开发")];
});
const imageDraft = useSessionImages({ active, canSend });
const archivedSessions = ref();
watch([() => props.initialView, workspaceLoading], async ([view, loadingWorkspace]) => {
  if (loadingWorkspace) return;
  if (view === "manual" && allowed("session.start")) {
    creating.value = true; settingsOpen.value = false; repositoryOpen.value = false;
  } else if (view === "history" && allowed("session.continue")) {
    await nextTick();
    if (props.initialView === view && !workspaceLoading.value) archivedSessions.value?.open();
  }
}, { immediate: true });
watch(active, () => { closeFile(false); });
watch(active, key => { if (key && key !== props.initialTask && (!props.initialView || !workspaceLoading.value)) emit("task-change", key); });

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
    :class="{ 'with-workspace-rail': $slots['workspace-rail'], 'project-workspace': props.projectId }"
  >
    <slot name="workspace-rail" />
    <nav class="development-navigation" :aria-label="$t('开发导航')">
      <button v-if="projectId" class="ui-back" @click="emit('return-project')"><ArrowLeftOutlined aria-hidden="true" />{{ $t('返回项目协作') }}</button>
      <button type="button" @click="sessionPicker = true">{{ $t('切换会话') }} <span class="muted">{{ runs.length }}</span></button>
      <button v-if="allowed('session.start')" type="button" :disabled="workspaceLoading" @click="creating = true; settingsOpen = false; repositoryOpen = false">{{ $t('独立开发') }}</button>
      <button v-if="allowed('code.view')" type="button" :aria-pressed="repositoryOpen" @click="repositoryOpen = !repositoryOpen; creating = false; settingsOpen = false"><BranchesOutlined aria-hidden="true" />{{ $t('代码仓库') }}</button>
      <button v-if="!projectId" type="button" @click="settingsOpen = true; creating = false; repositoryOpen = false">{{ $t(workspaceName ? '工作区设置' : '执行设置') }}</button>
      <span class="development-connection"><i :class="['connection', { online }]" />{{ online ? $t('服务已连接') : $t('正在重连服务') }}</span>
    </nav>
    <ModalDialog :open="sessionPicker" :title="$t('会话列表')" @close="sessionPicker = false">
      <TaskList :runs="runs" :active="active" :unread-result-keys="unreadResultKeys" @open="open" />
    </ModalDialog>
    <div class="development-history">      <ArchivedSessions ref="archivedSessions" v-if="allowed('session.continue')" :revision="archiveRevision" :disabled="workspaceLoading" @restored="archiveRestored" @deleted="sessionDeleted">
        <template #delete-dialog="{ run, deleted, close }">
          <SessionLifecycleDialog :key="run.key" mode="delete" :task-key="run.key" :title="run.title"
            :worktree="run.worktree" :deletion="run.worktreeDeletion"
            :active="['preparing', 'initializing', 'starting', 'running'].includes(run.status || run.execution?.status)"
            @deleted="deleted" @closed="close" />
        </template>
      </ArchivedSessions></div>
    <FeedbackMessage :message="preferenceError" type="error" />
    <main>
      <PublishDelivery v-if="publishing && projectId && session" :key="session.key" :project-id="projectId" :run-key="session.key" :can-publish="allowed('deliverable.create')" @close="publishing = false" @finished="publishing = false; refreshCurrentSession()" @published="delivery => { publishing = false; emit('open-project', { tab: 'deliveries', delivery: delivery.id }); }" />
      <SettingsPanel
        v-if="settingsOpen && !props.projectId"
        :can-manage-system="canManageSystem"
        @system-settings="emit('system-settings')"
        :workspace-name="props.workspaceName"
        @saved="reloadChannels"
        @rename-workspace="emit('rename-workspace')"
      />
      <ManualDevelopmentStart v-else-if="creating && props.projectId" :project-id="props.projectId" @cancel="creating = false" @started="key => { refreshList(); open(key); }" @open-record="id => emit('open-project', { tab: 'tasks', task: id })">
        <template #branch-select="{ value, disabled, update }"><RemoteBranchSelect :project-id="props.projectId" :model-value="value" :disabled="disabled" @update:model-value="update" /></template>
      </ManualDevelopmentStart>
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
      <RepositoryGitPanel v-else-if="repositoryOpen" :can-operate="allowed('code.operate')" />
      <section v-else-if="session" v-show="!publishing" class="session-surface">
        <header class="session-header" :aria-label="$t('会话工具栏')">
          <div class="page-breadcrumb" :aria-label="$t('当前位置')">
            <span :title="props.workspaceName || $t('开发工作台')">{{ props.workspaceName || $t("开发工作台") }}</span>
            <span aria-hidden="true">/</span>
            <strong>{{ $t("个人会话") }}</strong>
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
                  ? $t("等待你的输入")
                  : $t(statusLabel(session.status))
              }}</span
            >
            <button v-if="allowed('code.view')" :aria-pressed="Boolean(fileRequest)" @click="fileRequest ? closeFile() : openFile({})"><BranchesOutlined aria-hidden="true" />{{ fileRequest ? $t('返回会话') : $t('代码变更') }}</button>
            <button :aria-label="$t('上下文')" @click="detailsDrawer?.toggle('info', $event)">{{ $t('上下文') }}</button>
            <button v-if="projectId" @click="publishing = true">{{ $t('整理成果') }}</button>
            <button :disabled="loading" :aria-label="$t('刷新')" @click="refreshCurrentSession"><ReloadOutlined /></button>
          </div>
        </header>
        <div class="session-body" :class="{ 'with-file-panel': fileRequest }">
          <div v-show="!fileRequest" class="session-conversation">
            <div v-if="!online" class="banner warning" role="status">
              {{ $t("实时连接已断开，正在重连。服务运行时，关闭网页不会停止任务。") }}
            </div>
            <div v-if="session.readOnlyReason" class="banner">
              {{ session.readOnlyReason }}
            </div>
            <div v-if="session.warning" class="banner warning">
              {{ $t("历史读取降级：") }}{{ session.warning }}
            </div>
            <div
              ref="timeline"
              class="timeline"
              :aria-label="$t('会话记录')"
              :aria-busy="loading"
            >
              <button
                v-if="session.nextCursor"
                class="load-older"
                :disabled="busy || session.agent?.capabilities?.history !== true"
                @click="older"
              >
                {{ $t("加载更早记录 ↑") }}
              </button>
              <p v-if="!session.items.length" class="empty-inline">
                {{
                  ["preparing", "initializing", "starting"].includes(session.status)
                    ? $t("正在抓取需求、下载图片并准备独立工作区…")
                    : $t("还没有消息，输入指令继续这个 session。")
                }}
              </p>
              <SessionTimeline
                :key="session.key"
                :items="session.items"
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
              <p v-if="running && (waitingForInput || !session.items.some(item => item.status === 'inProgress'))" class="working-line">
                <span class="connection online"></span>{{ session.agent?.label || 'Agent' }}
                {{ waitingForInput ? $t("等待你的回答或审批，可停止当前一轮。") : $t("正在执行，可以补充指令或停止当前一轮。") }}
              </p>
              <p v-if="initializing" class="working-line">
                <span class="connection online"></span>{{ $t("正在初始化 worktree，完成后自动启动 {agent}。", { agent: session.agent?.label || 'Agent' }) }}
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
              :active-supplier="session.activeSupplier"
              :next-supplier="session.nextSupplier"
              :supplier-pending="Boolean(session.supplierPending)"
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
          <SessionFilePanel v-if="fileRequest" :key="session.key" :task-key="session.key" :request="fileRequest" :status="session.status" @close="closeFile" />
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
            <template #context-actions>
              <button v-if="props.projectId" type="button" @click="publishing = true">{{ $t('整理成果') }}</button>
            </template>
          </SessionDetailsDrawer>
        </div>
      </section>
      <section
        v-else
        class="empty-state"
        :aria-busy="workspaceLoading || loading"
      >
        <div class="empty-mark"><FolderOpenOutlined aria-hidden="true" /></div>
        <div class="eyebrow">{{ $t("需求 × AGENT") }}</div>
        <h1>
          {{
            workspaceLoading
              ? $t("正在加载工作区…")
              : loading
                ? $t("正在加载会话…")
                : active ? $t("指定会话暂时无法打开") : props.projectId ? $t("尚无开发任务") : $t("让需求与开发，在这里连起来。")
          }}
        </h1>
        <p>{{ active ? $t("该会话可能尚未启动、已归档或不存在。请返回项目任务查看启动状态，或重试读取。") : $t("查看执行过程、与 Agent 对话，随时调整下一步。") }}</p>
        <FeedbackMessage :message="error" type="error" />
        <button v-if="active && !loading" @click="refreshCurrentSession">{{ $t("重试读取指定会话") }}</button>
        <button v-if="props.projectId && active" @click="emit('open-project', 'tasks')">{{ $t("返回项目任务") }}</button>
        <button
          v-if="!workspaceLoading && !loading && !props.projectId && allowed('session.start')"
          class="primary"
          @click="
            creating = true;
            settingsOpen = false;
            repositoryOpen = false;
          "
        >
          {{ $t("从需求启动 →") }}
        </button>
        <button v-if="props.projectId && allowed('session.start')" class="primary" @click="emit('open-project', 'issues')">{{ $t("前往项目选择事项") }}</button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.workspace { min-width: 0; display: flex; flex-direction: column; position: relative; }
.workspace > main { min-width: 0; min-height: 0; flex: 1; container-type: inline-size; }
.development-navigation { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 28px; padding-right: 140px; border-bottom: 1px solid var(--line); }
.development-navigation:lang(en) { padding-right: 180px; }
.development-navigation .ui-back { margin-bottom: 0; }
.development-navigation button { border: 0; background: transparent; font-size: 12px; }
.development-connection { margin-left: auto; color: var(--muted); font-size: 12px; }
.development-history { position: absolute; top: 10px; right: 24px; }
.development-history :deep(button) { margin: 0; width: auto; font-size: 12px; background: transparent; border: 0; }
.session-surface { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.session-header { min-height: 108px; padding: 24px 32px 16px; background: var(--canvas); border-bottom: 0; gap: 10px 20px; }
.session-header .page-breadcrumb { color: var(--muted); font-size: 12px; }
.session-header :deep(.session-heading) { font-size: clamp(24px, 2vw, 30px); font-weight: 600; letter-spacing: -.02em; line-height: 1.4; }
.session-toolbar { flex-wrap: wrap; }
.session-body { margin: 0 32px 24px; gap: 24px; min-width: 0; position: relative; }
.session-conversation { flex: 1; min-width: 0; background: var(--canvas); }
.timeline { padding: 28px max(16px, calc((100% - 900px) / 2)); scroll-padding-bottom: 24px; }
.session-conversation :deep(.composer-wrap) { padding: 16px max(16px, calc((100% - 940px) / 2)); background: var(--canvas); border: 0; }
.session-body.with-file-panel > :deep(.session-file-panel) { position: relative; inset: auto; width: 100%; flex: 1; box-shadow: none; }
.working-line { font-size: 12px; line-height: 1.8; }
.empty-state { background: var(--canvas); }
@media (max-width: 767px) {
  .workspace > main { overflow-y: auto; }
  .development-navigation { padding: 8px 12px; margin-right: 108px; gap: 4px; flex-wrap: nowrap; overflow-x: auto; flex-shrink: 0; }
  .development-navigation:lang(en) { padding-right: 12px; margin-right: 164px; }
  .development-navigation button { min-height: 44px; padding: 6px; flex-shrink: 0; white-space: nowrap; }
  .development-history { right: 8px; }
  .development-connection { display: none; }
  .session-header { min-height: 0; padding: 20px 16px 16px; gap: 10px; }
  .session-header :deep(.session-heading) { font-size: 24px; }
  .session-body { margin: 0 12px 12px; gap: 0; }
  .session-conversation > .timeline { min-height: 240px; padding: 20px 8px; }
  .session-conversation :deep(.composer-wrap) { padding: 12px 0; }
}
</style>
