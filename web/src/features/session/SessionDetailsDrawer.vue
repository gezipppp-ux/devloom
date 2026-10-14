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
const root = ref();
const closeButton = ref();
const id = useId();
let trigger;

async function toggle(key, event) {
  if (panel.value === key) return close();
  trigger = event.currentTarget;
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
defineExpose({ close, focusTrigger: () => trigger?.focus({ preventScroll: true }) });
function openFile(request) { close(false); emit("open-file", request); }
function outside(event) {
  if (
    panel.value &&
    !root.value?.contains(event.target) &&
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
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("keydown", escape);
});
</script>

<template>
  <div ref="root" class="session-details">
    <nav class="session-details-nav" :aria-label="$t(&quot;会话资料&quot;)">
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
          :aria-label="$t(&quot;收起会话资料&quot;)"
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
          :aria-label="$t(&quot;会话信息内容&quot;)"
        >
          <section class="session-info-section">
            <h3>{{ $t("任务管理") }}</h3>
            <slot name="metadata" />
          </section>
          <section class="session-info-section">
            <h3>{{ $t("执行信息") }}</h3>
            <dl>
              <dt>Session</dt>
              <dd>{{ session.sessionId || $t("创建中") }}</dd>
              <dt>{{ $t("创建时模型") }}</dt>
              <dd>{{ session.agent?.model || $t('{agent} 默认配置', { agent: session.agent?.label || 'Agent' }) }}</dd>
              <dt>{{ $t("创建时思考强度") }}</dt>
              <dd>{{ session.agent?.reasoningEffort || $t("默认思考强度") }}</dd>
              <dt>{{ $t("渠道同步") }}</dt>
              <dd>
                {{
                  session.transition?.status === "skipped"
                    ? $t("无需同步")
                    : session.transition?.status || $t("暂无记录")
                }}
                {{ session.transition?.error }}
              </dd>
            </dl>
          </section>
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
          :aria-label="$t(&quot;Worktree Git 内容&quot;)"
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
