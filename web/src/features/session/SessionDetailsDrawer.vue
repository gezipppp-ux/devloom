<script setup>
/* global document */
import {
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useId,
} from "vue";
import {
  InfoCircleOutlined,
  BranchesOutlined,
  FileTextOutlined,
  RightOutlined,
} from "@antdv-next/icons";
import SessionGitPanel from "./SessionGitPanel.vue";
import SessionLifecycleControls from "./SessionLifecycleControls.vue";
import { statusLabel } from "../../shared/api/api.js";

const RequirementDetails = defineAsyncComponent(
  () => import("./RequirementDetails.vue"),
);
defineProps({
  session: { type: Object, required: true },
  active: Boolean,
  requirementsDisabled: Boolean,
  canManage: { type: Boolean, default: true },
  canOperate: { type: Boolean, default: true },
});
const emit = defineEmits(["archived", "deleted", "worktree-deleted", "open-file", "opened", "continue-requirements"]);
const panels = [
  { key: "info", label: "信息", title: "会话信息", icon: InfoCircleOutlined },
  { key: "git", label: "Git", title: "Worktree Git", icon: BranchesOutlined },
  {
    key: "requirement",
    label: "需求",
    title: "需求资料",
    icon: FileTextOutlined,
  },
];
const panel = ref("");
const inline = ref(false);
const root = ref();
const closeButton = ref();
const id = useId();
let trigger;
let resizeObserver;

async function toggle(key, event) {
  if (panel.value === key) return close();
  if (!root.value?.contains(event.currentTarget)) trigger = event.currentTarget;
  panel.value = key;
  emit("opened");
  await nextTick();
  closeButton.value?.focus({ preventScroll: true });
}
function close(restoreFocus = true) {
  panel.value = "";
  if (restoreFocus && trigger?.isConnected)
    trigger.focus({ preventScroll: true });
}
defineExpose({ close, toggle, focusTrigger: () => trigger?.focus({ preventScroll: true }) });
function openFile(request) { close(false); emit("open-file", request); }
function outside(event) {
  if (
    panel.value && !inline.value &&
    !root.value?.contains(event.target) && !trigger?.contains(event.target) &&
    !document.querySelector("dialog:modal")
  )
    close(false);
}
function escape(event) {
  // Native confirmation dialogs own Escape while they are open.
  if (
    panel.value &&
    event.key === "Escape" &&
    !event.defaultPrevented &&
    !document.querySelector("dialog:modal")
  ) {
    event.preventDefault();
    close();
  }
}
onMounted(() => {
  // Use the available workspace width, including the task list and global shell,
  // so a large viewport never forces a narrow conversation beside the context.
  const resize = () => {
    const wide = root.value?.parentElement?.clientWidth >= 1000;
    if (wide === inline.value) return;
    inline.value = wide;
  };
  resize();
  resizeObserver = new globalThis.ResizeObserver(resize);
  if (root.value?.parentElement) resizeObserver.observe(root.value.parentElement);
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape);
});
onUnmounted(() => {
  resizeObserver?.disconnect();
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("keydown", escape);
});
</script>

<template>
  <div v-show="panel" ref="root" class="session-details" :class="{ 'context-inline': inline && panel }">
    <nav class="session-details-nav" :aria-label="$t('会话资料')">
      <button
        v-for="entry in panels"
        :key="entry.key"
        type="button"
        :aria-label="$t(entry.title)"
        :title="$t(entry.title)"
        :aria-expanded="panel === entry.key"
        :aria-controls="`${id}-${entry.key}`"
        @click="toggle(entry.key, $event)"
      >
        <component :is="entry.icon" aria-hidden="true" />
        <span>{{ $t(entry.label) }}</span>
      </button>
    </nav>
    <aside
      v-show="panel"
      class="session-drawer"
      :aria-label="$t(panels.find((entry) => entry.key === panel)?.title || '')"
    >
      <header class="session-drawer-heading">
        <h2>{{ $t(panels.find((entry) => entry.key === panel)?.title || '') }}</h2>
        <button
          ref="closeButton"
          type="button"
          :aria-label="$t('收起会话资料')"
          @click="close()"
        >
          <RightOutlined aria-hidden="true" /> {{ $t("收起") }}
        </button>
      </header>
      <div class="session-drawer-content">
        <section
          v-show="panel === 'info'"
          :id="`${id}-info`"
          class="session-context"
          :aria-label="$t('会话信息内容')"
        >
          <section class="session-info-section">
            <h3>{{ $t("执行上下文") }}</h3>
            <dl class="execution-context-facts">
              <dt>{{ $t("运行状态") }}</dt><dd>{{ $t(statusLabel(session.status)) }}</dd>
              <dt>{{ $t("起始分支") }}</dt><dd><code>{{ session.worktree?.baseline?.branch ? `${session.worktree.baseline.remote || 'origin'}/${session.worktree.baseline.branch}` : $t("未知") }}</code></dd>
              <dt>{{ $t("当前分支") }}</dt><dd><code>{{ session.worktree?.branch || $t("准备中") }}</code></dd>
              <dt>{{ $t("运行引擎") }}</dt><dd>{{ session.agent?.label || 'Agent' }}</dd>
            </dl>
            <p class="context-privacy">{{ $t("此会话仅你可见。需要协作验收时，发布项目可见的交付。") }}</p>
            <slot name="context-actions" />
          </section>
          <details class="session-info-section"><summary>{{ $t("执行信息") }}</summary>
            <dl>
              <dt>Session</dt>
              <dd>{{ session.sessionId || $t("创建中") }}</dd>
              <dt>{{ $t("创建时模型") }}</dt>
              <dd>{{ session.agent?.model || $t('{agent} 默认配置', { agent: session.agent?.label || 'Agent' }) }}</dd>
              <dt>{{ $t("创建时思考强度") }}</dt>
              <dd>{{ session.agent?.reasoningEffort || $t("默认思考强度") }}</dd>
            </dl>
          </details>
          <SessionLifecycleControls
            v-if="canManage"
            :can-delete="canOperate"
            :task-key="session.key"
            :title="session.title"
            :worktree="session.worktree"
            :deletion="session.worktreeDeletion"
            :active="active"
            @archived="emit('archived', $event)"
            @deleted="emit('deleted', $event)"
          />
        </section>
        <section
          v-show="panel === 'git'"
          :id="`${id}-git`"
          :aria-label="$t('Worktree Git 内容')"
        >
          <SessionGitPanel
            v-if="panel === 'git' && session.worktree?.path"
            :task-key="session.key"
            :can-operate="canOperate"
            :worktree="session.worktree"
            :deletion="session.worktreeDeletion"
            :status="session.status"
            :active="active"
            @deleted="emit('worktree-deleted')"
            @open-file="openFile"
          />
          <p v-else-if="!session.worktree?.path" class="empty-inline">{{ $t("Worktree 尚未准备完成。") }}</p>
        </section>
        <section v-show="panel === 'requirement'" :id="`${id}-requirement`">
          <RequirementDetails :requirement="session.requirement" :disabled="requirementsDisabled || active" @continue="emit('continue-requirements', $event)" />
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.session-details { position: absolute; inset: 0 0 0 auto; width: min(380px, 100%); display: flex; flex-direction: column; z-index: 5; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); box-shadow: var(--shadow-sm); min-width: 0; min-height: 0; }
.session-details-nav { display: flex; position: static; padding: 8px; gap: 4px; border-bottom: 1px solid var(--line); }
.session-details-nav button { flex: 1; flex-direction: row; min-height: 44px; gap: 6px; }
.session-details-nav button[aria-expanded="true"] { color: var(--highlight); background: var(--selected); }
.session-drawer { position: static; width: 100%; flex: 1; min-height: 0; border: 0; box-shadow: none; }
.session-drawer-heading { padding: 16px 20px; }
.session-drawer-heading h2 { font-size: 16px; font-weight: 600; }
.session-drawer-content { padding: 22px; }
.session-info-section h3, .session-info-section summary { font-size: 14px; margin-bottom: 18px; }
.execution-context-facts { display: grid; grid-template-columns: minmax(75px, auto) minmax(0, 1fr); gap: 14px 16px; margin: 0; font-size: 13px; }
.execution-context-facts dt { color: var(--muted); }
.execution-context-facts dd { margin: 0; overflow-wrap: anywhere; }
.context-privacy { margin: 20px 0 16px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; line-height: 1.8; }
.context-inline { position: relative; inset: auto; flex: 0 0 320px; width: 320px; box-shadow: none; }
</style>
