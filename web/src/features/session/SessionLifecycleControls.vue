<script setup>
import { computed, nextTick, onUnmounted, ref } from "vue";
import { InboxOutlined, DeleteOutlined } from "@antdv-next/icons";
import { api } from "../../shared/api/api.js";

const props = defineProps({
  taskKey: { type: String, required: true },
  worktree: { type: Object, default: null },
  deletion: { type: Object, default: null },
  active: Boolean,
});
const emit = defineEmits(["archived", "deleted"]);
const dialog = ref(), confirmation = ref(), busy = ref(false), error = ref("");
const mode = ref("archive");
const force = ref(false), confirmBranch = ref("");
const codeRemoved = computed(() =>
  !props.worktree?.path || props.deletion?.status === "deleted",
);
const canDelete = computed(() => codeRemoved.value ||
  (force.value && Boolean(props.worktree?.branch) && confirmBranch.value === props.worktree.branch));
let revision = 0;
function open(nextMode) {
  mode.value = nextMode;
  confirmation.value = false;
  force.value = false;
  confirmBranch.value = "";
  error.value = "";
  dialog.value.showModal();
  void nextTick(() => dialog.value?.querySelector("input")?.focus());
}
function close() {
  if (!busy.value) dialog.value.close();
}
async function submit() {
  if (busy.value || props.active || !confirmation.value || (mode.value === "delete" && !canDelete.value)) return;
  const current = ++revision;
  const key = props.taskKey;
  const deleting = mode.value === "delete";
  busy.value = true;
  error.value = "";
  try {
    const route = deleting ? "delete" : "archive";
    await api(`/runs/${key}/${route}`, deleting ? {
      confirm: true,
      ...(force.value && !codeRemoved.value ? { force: true, confirmBranch: confirmBranch.value } : {}),
    } : {});
    if (current !== revision) return;
    dialog.value.close();
    emit(deleting ? "deleted" : "archived", key);
  } catch (e) {
    if (current === revision) error.value = e.message;
  } finally {
    if (current === revision) busy.value = false;
  }
}
onUnmounted(() => { revision++; });
</script>

<template>
  <div class="session-lifecycle-controls">
    <button type="button" aria-label="归档会话" title="归档会话" @click="open('archive')">
      <InboxOutlined aria-hidden="true" /> 归档
    </button>
    <button type="button" class="danger-button" aria-label="永久删除会话" title="永久删除会话" @click="open('delete')">
      <DeleteOutlined aria-hidden="true" /> 删除
    </button>
    <Teleport to="body">
      <dialog ref="dialog" class="workspace-dialog session-delete-dialog" :aria-label="mode === 'archive' ? '归档会话' : '永久删除会话'" @cancel.prevent="close">
        <div class="workspace-dialog-heading">
          <h2>{{ mode === "archive" ? "归档会话" : "永久删除会话" }}</h2>
          <button type="button" class="workspace-menu" aria-label="关闭确认窗口" :disabled="busy" @click="close">×</button>
        </div>
        <p v-if="mode === 'archive'" class="muted">归档后会话不再显示在左侧列表中，可从「已归档会话」恢复。历史、需求资料和 Worktree 保留。</p>
        <template v-else>
          <p class="git-feedback warning">永久删除会话会移除全部会话记录、需求资料和附件，无法恢复。</p>
          <p v-if="!codeRemoved" class="muted">此会话仍有关联代码。可先在 Git 面板清理，或在下方选择强制删除。</p>
        </template>
        <p v-if="active" class="error">任务正在执行或等待处理，请先停止并等待本轮结束。</p>
        <form @submit.prevent="submit">
          <template v-if="mode === 'delete' && !codeRemoved">
            <dl class="git-facts">
              <dt>删除目录</dt><dd><code>{{ worktree.path }}</code></dd>
              <dt>删除本地分支</dt><dd><code>{{ worktree.branch }}</code></dd>
            </dl>
            <label class="git-risk-confirm">
              <input v-model="force" type="checkbox" :disabled="busy || active" />
              <span>同时强制删除 Worktree、本地目录和本地分支</span>
            </label>
            <template v-if="force">
              <p class="git-feedback warning">将放弃未提交、未跟踪和忽略的文件（包括依赖与构建产物），以及尚未推送的本地提交。会话资料一并永久删除，无法恢复。远程分支保留。</p>
              <label :for="`force-delete-branch-${taskKey}`">输入完整本地分支名以确认强制删除</label>
              <p class="field-hint">请准确输入：<code>{{ worktree.branch }}</code></p>
              <input :id="`force-delete-branch-${taskKey}`" v-model="confirmBranch" aria-label="确认强制删除的本地分支" :disabled="busy || active" :placeholder="worktree.branch" autocomplete="off" spellcheck="false" />
            </template>
          </template>
          <label class="git-risk-confirm">
            <input v-model="confirmation" type="checkbox" :disabled="busy || active || (mode === 'delete' && !canDelete)" />
            <span>{{ mode === "archive" ? "我确认归档此会话。" : "我确认永久删除且无法恢复此会话。" }}</span>
          </label>
          <div class="actions">
            <button type="button" :disabled="busy" @click="close">取消</button>
            <button type="submit" :class="mode === 'delete' ? 'danger-button' : 'primary'" :disabled="busy || active || !confirmation || (mode === 'delete' && !canDelete)">
              {{ busy ? "正在处理…" : mode === "archive" ? "归档会话" : force ? "强制删除会话与代码" : "永久删除" }}
            </button>
          </div>
        </form>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </dialog>
    </Teleport>
  </div>
</template>
