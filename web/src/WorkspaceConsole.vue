<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
} from "vue";
import { api, bootstrap, statusLabel, apiPath } from "./api";
import StartTask from "./StartTask.vue";
import SettingsPanel from "./SettingsPanel.vue";
import SessionItem from "./SessionItem.vue";
import SessionRequest from "./SessionRequest.vue";
import TaskList from "./TaskList.vue";
import TaskMetadataControls from "./TaskMetadataControls.vue";
import {
  SettingOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
} from "@antdv-next/icons";
const RequirementDetails = defineAsyncComponent(
  () => import("./RequirementDetails.vue"),
);

const props = defineProps({ workspaceName: { type: String, default: "" } });
const emit = defineEmits(["rename-workspace"]);
const channels = ref([]),
  settingsOpen = ref(false);
const runs = ref([]),
  active = ref(null),
  session = ref(null),
  workspace = ref("");
const creating = ref(false),
  loading = ref(false),
  busy = ref(false),
  online = ref(false),
  error = ref(""),
  notice = ref("");
const composer = reactive({ text: "" });
const timeline = ref(),
  composerForm = ref();
let events,
  refreshTimer,
  selection = 0,
  expandedHistory = false;
const running = computed(() => Boolean(session.value?.turnId));
const initializing = computed(() => session.value?.status === "initializing");
const canSend = computed(
  () =>
    session.value &&
    !session.value.readOnlyReason &&
    !loading.value &&
    !busy.value &&
    online.value &&
    !session.value.requests?.length,
);
async function refreshList() {
  runs.value = (await api("/runs")).runs;
}
async function open(key) {
  const version = ++selection;
  expandedHistory = false;
  settingsOpen.value = false;
  active.value = key;
  creating.value = false;
  loading.value = true;
  error.value = "";
  notice.value = "";
  session.value = null;
  composer.text = "";
  try {
    const result = await api(`/runs/${key}`);
    if (version === selection) {
      session.value = result;
      await scroll();
    }
  } catch (e) {
    if (version === selection) error.value = e.message;
  } finally {
    if (version === selection) loading.value = false;
  }
}
async function refreshView() {
  if (!active.value || loading.value || creating.value) return;
  const key = active.value;
  const result = await api(`/runs/${key}`);
  if (key !== active.value) return;
  const previous = session.value?.items || [];
  const merged = new Map(previous.map((item) => [item.id, item]));
  for (const item of result.items) merged.set(item.id, item);
  session.value = {
    ...result,
    items: [...merged.values()],
    nextCursor: expandedHistory ? session.value.nextCursor : result.nextCursor,
  };
}
async function scroll(force = true) {
  await nextTick();
  const el = timeline.value;
  if (el && (force || el.scrollHeight - el.scrollTop - el.clientHeight < 180))
    el.scrollTop = el.scrollHeight;
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(
    () =>
      Promise.all([refreshList(), refreshView()]).catch((e) => {
        error.value = e.message;
      }),
    400,
  );
}
function eventReceived(event) {
  if (event.type === "metadata") {
    metadataSaved(event.key, event.metadata);
    return;
  }
  if (event.key === active.value && session.value) {
    Object.assign(session.value, {
      status: event.status,
      turnId: event.turnId,
      sessionId: event.sessionId,
      lastActivity: event.at,
    });
    if (event.type === "item") {
      const index = session.value.items.findIndex(
        (item) => item.id === event.item.id,
      );
      if (index < 0) session.value.items.push(event.item);
      else session.value.items[index] = event.item;
      void scroll(false);
    }
    if (event.requests) session.value.requests = event.requests;
    if (event.error) error.value = event.error;
    if (event.type === "notice") notice.value = event.text;
  }
  if (event.type !== "item") scheduleRefresh();
}
function metadataSaved(key, metadata) {
  const run = runs.value.find((entry) => entry.key === key);
  if (run) run.metadata = metadata;
  if (session.value?.key === key) session.value.metadata = metadata;
}
async function action(route, data, after) {
  const key = active.value;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await api(`/runs/${key}/${route}`, data);
    if (key === active.value) await after?.();
    scheduleRefresh();
  } catch (e) {
    if (key === active.value) error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function send() {
  if (canSend.value && composer.text.trim())
    await action("messages", { text: composer.text }, () => {
      composer.text = "";
    });
}
async function older() {
  expandedHistory = true;
  busy.value = true;
  const key = active.value;
  try {
    const result = await api(
      `/runs/${key}/history?${new URLSearchParams({ cursor: session.value.nextCursor })}`,
    );
    if (key === active.value) {
      const items = new Map(
        [...result.items, ...session.value.items].map((item) => [
          item.id,
          item,
        ]),
      );
      session.value.items = [...items.values()];
      session.value.nextCursor = result.nextCursor;
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function reloadChannels() {
  const initial = await bootstrap();
  workspace.value = initial.workspace;
  channels.value = initial.channels;
}
onMounted(async () => {
  try {
    const initial = await bootstrap();
    workspace.value = initial.workspace;
    channels.value = initial.channels;
    events = new EventSource(apiPath("/events"));
    events.onopen = () => {
      online.value = true;
      scheduleRefresh();
    };
    events.onerror = () => {
      online.value = false;
    };
    events.onmessage = (event) => eventReceived(JSON.parse(event.data));
    await refreshList();
    if (runs.value.length) await open(runs.value[0].key);
    else if (props.workspaceName) settingsOpen.value = true;
  } catch (e) {
    error.value = e.message;
  }
});
onUnmounted(() => {
  events?.close();
  clearTimeout(refreshTimer);
});
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
            <dt>Codex 模型</dt>
            <dd>
              {{
                session.codex
                  ? session.codex.model || "Codex 默认配置"
                  : "未记录"
              }}
            </dd>
            <dt>思考强度</dt>
            <dd>
              {{
                session.codex
                  ? session.codex.reasoningEffort || "默认思考强度"
                  : "未记录"
              }}
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
        <div class="composer-wrap">
          <p v-if="error || session.error" role="alert" class="error">
            {{ error || session.error }}
          </p>
          <p v-if="notice" role="status" class="notice">{{ notice }}</p>
          <a-form
            ref="composerForm"
            class="composer"
            :model="composer"
            :rules="{
              text: [
                { required: true, whitespace: true, message: '请输入指令' },
              ],
            }"
            @finish="send"
            ><a-form-item name="text">
              <textarea
                v-model="composer.text"
                aria-label="发送给 Codex 的指令"
                :disabled="!canSend"
                :placeholder="
                  session.readOnlyReason
                    ? '此会话为只读'
                    : running
                      ? '补充指令，调整当前执行方向…'
                      : '输入指令，继续这个 session…'
                "
                rows="3"
                maxlength="60000"
                @keydown.ctrl.enter.prevent="composerForm?.submit()"
              />
            </a-form-item>
            <div class="composer-footer">
              <span>Ctrl + Enter 发送 · 原 session 持续对话</span>
              <div class="actions">
                <button
                  v-if="running || initializing"
                  type="button"
                  class="stop"
                  :disabled="busy || !online"
                  @click="action('interrupt', {})"
                >
                  ■ 停止</button
                ><button
                  type="submit"
                  class="primary"
                  :disabled="!canSend || !composer.text.trim()"
                >
                  {{ running ? "补充指令 ↑" : "发送 ↑" }}
                </button>
              </div>
            </div></a-form
          >
          <div class="composer-note">
            “本轮结束”表示 Codex
            已回复；需求是否完成，请结合改动与验证结果判断。
          </div>
        </div>
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
