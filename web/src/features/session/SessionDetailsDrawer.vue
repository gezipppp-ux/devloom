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
});
const emit = defineEmits(["archived", "deleted", "worktree-deleted"]);
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
  await nextTick();
  closeButton.value?.focus({ preventScroll: true });
}
function close(restoreFocus = true) {
  panel.value = "";
  if (restoreFocus && trigger?.isConnected)
    trigger.focus({ preventScroll: true });
}
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
    <nav class="session-details-nav" aria-label="会话资料">
      <button
        v-for="entry in panels"
        :key="entry.key"
        type="button"
        :aria-label="entry.title"
        :title="entry.title"
        :aria-expanded="panel === entry.key"
        :aria-controls="`${id}-${entry.key}`"
        @click="toggle(entry.key, $event)"
      >
        <component :is="entry.icon" aria-hidden="true" />
        <span>{{ entry.label }}</span>
      </button>
    </nav>
    <aside
      v-show="panel"
      class="session-drawer"
      :aria-label="panels.find((entry) => entry.key === panel)?.title"
    >
      <header class="session-drawer-heading">
        <h2>{{ panels.find((entry) => entry.key === panel)?.title }}</h2>
        <button
          ref="closeButton"
          type="button"
          aria-label="收起会话资料"
          @click="close()"
        >
          <RightOutlined aria-hidden="true" /> 收起
        </button>
      </header>
      <div class="session-drawer-content">
        <section
          v-show="panel === 'info'"
          :id="`${id}-info`"
          class="session-context"
          aria-label="会话信息内容"
        >
          <section class="session-info-section">
            <h3>任务管理</h3>
            <slot name="metadata" />
          </section>
          <section class="session-info-section">
            <h3>执行信息</h3>
            <dl>
              <dt>Session</dt>
              <dd>{{ session.sessionId || "创建中" }}</dd>
              <dt>创建时模型</dt>
              <dd>{{ session.codex?.model || "Codex 默认配置" }}</dd>
              <dt>创建时思考强度</dt>
              <dd>{{ session.codex?.reasoningEffort || "默认思考强度" }}</dd>
              <dt>渠道同步</dt>
              <dd>
                {{
                  session.transition?.status === "skipped"
                    ? "无需同步"
                    : session.transition?.status || "暂无记录"
                }}
                {{ session.transition?.error }}
              </dd>
            </dl>
          </section>
          <SessionLifecycleControls
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
          aria-label="Worktree Git 内容"
        >
          <SessionGitPanel
            v-if="session.worktree?.path"
            :task-key="session.key"
            :worktree="session.worktree"
            :deletion="session.worktreeDeletion"
            :status="session.status"
            :active="active"
            @deleted="emit('worktree-deleted')"
          />
          <p v-else class="empty-inline">Worktree 尚未准备完成。</p>
        </section>
        <section v-show="panel === 'requirement'" :id="`${id}-requirement`">
          <RequirementDetails :requirement="session.requirement" />
        </section>
      </div>
    </aside>
  </div>
</template>
