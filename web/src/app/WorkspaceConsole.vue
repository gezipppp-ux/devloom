<script setup>
import { defineAsyncComponent, nextTick, reactive, ref } from "vue";
import { statusLabel } from "../shared/api/api.js";
import { useWorkspaceConsole } from "./use-workspace-console.js";
import StartTask from "../features/tasks/StartTask.vue";
import SettingsPanel from "../features/settings/SettingsPanel.vue";
import SessionItem from "../features/session/SessionItem.vue";
import SessionRequest from "../features/session/SessionRequest.vue";
import SessionComposer from "../features/session/SessionComposer.vue";
import { useSessionImages } from "../features/session/use-session-images.js";
import TaskList from "../features/tasks/TaskList.vue";
import TaskMetadataControls from "../features/tasks/TaskMetadataControls.vue";
import {
  SettingOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
} from "@antdv-next/icons";
const RequirementDetails = defineAsyncComponent(
  () => import("../features/session/RequirementDetails.vue"),
);

const props = defineProps({ workspaceName: { type: String, default: "" } });
const emit = defineEmits(["rename-workspace"]);
const settingsOpen = ref(false),
  creating = ref(false);
const composer = reactive({ text: "" });
const timeline = ref();
const {
  channels,
  workspace,
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
  open,
  action,
  older,
  reloadChannels,
  metadataSaved,
  executionSettings,
  canEditSettings,
  settingsBusy,
  settingsError,
  updateExecutionSettings,
} = useWorkspaceConsole({
  canRefresh: () => !creating.value,
  onOpen: () => {
    settingsOpen.value = false;
    creating.value = false;
    composer.text = "";
    imageDraft.reset();
  },
  onOpened: () => scroll(),
  onItem: () => {
    void scroll(false);
  },
  onEmpty: () => {
    if (props.workspaceName) settingsOpen.value = true;
  },
});
const imageDraft = useSessionImages({ active, canSend });

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
          class="workspace-menu"
          aria-label="编辑工作区"
          title="修改工作区名称和图标"
          @click="emit('rename-workspace')"
        >
          <span aria-hidden="true">···</span>
        </button>
      </div>
      <button
        class="settings-link"
        :class="{ active: settingsOpen }"
        @click="settingsOpen = true"
      >
        <SettingOutlined aria-hidden="true" />
        {{ props.workspaceName ? "工作区设置" : "执行设置" }}
      </button>
      <button
        class="new-task"
        @click="
          creating = true;
          settingsOpen = false;
        "
      >
        ＋ 从需求启动
      </button>
      <TaskList
        :runs="runs"
        :active="!creating && !settingsOpen ? active : null"
        @open="open"
      />
      <div class="sidebar-footer">
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
            : creating
              ? "新需求"
              : session
                ? "需求会话"
                : "工作台"
        }}</strong>
      </div>
      <SettingsPanel
        v-if="settingsOpen"
        :workspace-name="props.workspaceName"
        @cancel="settingsOpen = false"
        @saved="reloadChannels"
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
      <template v-else-if="session">
        <header class="session-header">
          <div>
            <div class="eyebrow">
              CONVERSATION
              <span
                class="status"
                :data-status="
                  session.requests?.length ? 'waiting' : session.status
                "
                >Codex ·
                {{
                  session.requests?.length
                    ? "等待你的输入"
                    : statusLabel(session.status)
                }}</span
              >
            </div>
            <h1>{{ session.title }}</h1>
          </div>
          <button :disabled="loading" @click="open(active)">
            <ReloadOutlined aria-hidden="true" /> 刷新
          </button>
        </header>
        <TaskMetadataControls
          :key="session.key"
          :task-key="session.key"
          :metadata="session.metadata"
          @saved="metadataSaved"
        />
        <details class="session-context">
          <summary>
            会话信息与需求资料
            <span>模型 · 分支 · 需求快照</span>
          </summary>
          <dl>
            <dt>Session</dt>
            <dd>{{ session.sessionId || "创建中" }}</dd>
            <dt>创建时模型</dt>
            <dd>
              {{ session.codex?.model || "Codex 默认配置" }}
            </dd>
            <dt>创建时思考强度</dt>
            <dd>
              {{ session.codex?.reasoningEffort || "默认思考强度" }}
            </dd>
            <dt>分支</dt>
            <dd>{{ session.worktree?.branch || "准备中" }}</dd>
            <dt>Worktree</dt>
            <dd>{{ session.worktree?.path || "准备中" }}</dd>
            <dt>渠道同步</dt>
            <dd>
              {{
                session.transition?.status === "skipped"
                  ? "无需同步"
                  : session.transition?.status
              }}
              {{ session.transition?.error }}
            </dd>
          </dl>
          <RequirementDetails :requirement="session.requirement" />
        </details>
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
      </template>
      <section v-else class="empty-state">
        <div class="empty-mark"><FolderOpenOutlined aria-hidden="true" /></div>
        <div class="eyebrow">需求 × CODEX</div>
        <h1>
          {{ loading ? "正在加载会话…" : "让需求与开发，在这里连起来。" }}
        </h1>
        <p>查看执行过程、与 Codex 对话，随时调整下一步。</p>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <button
          v-if="!loading"
          class="primary"
          @click="
            creating = true;
            settingsOpen = false;
          "
        >
          从需求启动 →
        </button>
      </section>
    </main>
  </div>
</template>
