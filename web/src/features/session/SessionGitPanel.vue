<script setup>
import { computed, onUnmounted, ref, watch } from "vue";
import {
  BranchesOutlined,
  ReloadOutlined,
  DeleteOutlined,
} from "@antdv-next/icons";
import { api } from "../../shared/api/api.js";
import DeleteWorktreeDialog from "./DeleteWorktreeDialog.vue";

const props = defineProps({
  taskKey: { type: String, required: true },
  worktree: { type: Object, default: () => ({}) },
  deletion: { type: Object, default: null },
  active: Boolean,
  status: { type: String, default: "" },
});
const emit = defineEmits(["deleted"]);
const git = ref(null);
const loading = ref(false);
const error = ref("");
const deleteDialog = ref();
let revision = 0;
const deleted = computed(
  () => git.value?.deleted || props.deletion?.branchDeleted,
);
const partial = computed(
  () =>
    git.value?.deletion?.status === "partial" ||
    props.deletion?.status === "partial",
);
const uncommitted = computed(() =>
  Number.isInteger(git.value?.changedFiles) &&
  Number.isInteger(git.value?.untrackedFiles)
    ? git.value.changedFiles + git.value.untrackedFiles
    : "未知",
);
const currentBranch = computed(() => {
  if (git.value && Object.hasOwn(git.value, "currentBranch"))
    return git.value.currentBranch || "HEAD（分离）";
  return props.worktree?.branch || "准备中";
});

async function refresh() {
  const current = ++revision;
  loading.value = true;
  error.value = "";
  try {
    const result = await api(`/runs/${props.taskKey}/git`);
    if (current === revision) git.value = result;
  } catch (e) {
    if (current === revision) error.value = e.message;
  } finally {
    if (current === revision) loading.value = false;
  }
}
function removed(result) {
  revision++;
  loading.value = false;
  error.value = "";
  git.value = { ...git.value, ...result, deleted: true, canDelete: false };
  emit("deleted");
}
watch(() => [props.active, props.status, props.deletion?.status], refresh, {
  immediate: true,
});
onUnmounted(() => {
  revision++;
});
</script>

<template>
  <section class="session-git" :aria-busy="loading" aria-label="Worktree Git 状态">
    <div class="session-git-summary">
      <span class="git-summary-title"
        ><BranchesOutlined aria-hidden="true" /> Worktree</span
      >
      <span v-if="deleted" class="git-state-chip">已删除 · 历史只读</span>
      <span v-else-if="partial" class="git-stale"
        >目录已删除 · 本地分支待清理</span
      >
      <template v-else-if="git">
        <span class="git-state-chip">未提交 {{ uncommitted }}</span>
        <span v-if="git.unpublished" class="git-state-chip">分支尚未发布</span>
        <template v-else>
          <span class="git-state-chip">待推送 {{ git.ahead ?? "未知" }}</span>
          <span v-if="git.behind !== 0" class="git-state-chip"
            >落后远端 {{ git.behind ?? "未知" }}</span
          >
        </template>
        <span v-if="error" class="git-stale">状态已过期</span>
      </template>
      <span v-else class="muted">{{
        loading ? "正在读取 Git 状态…" : "Git 状态暂不可用"
      }}</span>
    </div>
    <div class="session-git-body">
      <dl class="git-facts">
        <dt>当前分支</dt>
        <dd>
          <code>{{ currentBranch }}</code>
        </dd>
        <dt>Worktree 目录</dt>
        <dd>
          <code>{{ git?.path || worktree?.path || "准备中" }}</code>
        </dd>
        <dt v-if="!deleted">上游分支</dt>
        <dd v-if="!deleted">
          {{
            git?.upstream || (git?.unpublished ? "尚未设置上游分支" : "未知")
          }}
        </dd>
      </dl>
      <p v-if="!deleted" class="git-hint">
        待推送与落后数量相对当前分支的上游计算，以最近获取的远端记录为准。可在「代码仓库」获取远端更新。提交、推送、合并与冲突处理请在会话中交给
        Codex。
      </p>
      <p v-if="deleted" class="notice" role="status">
        Worktree 文件与本地分支已删除。会话记录仍可查看。
      </p>
      <p v-else-if="partial" class="git-feedback warning">
        目录已删除，本地分支尚未删除。可重新打开删除确认，继续清理本地分支。
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p
        v-if="git?.warning && !deleted"
        class="git-feedback warning"
        role="status"
      >
        {{ git.warning }}
      </p>
      <div class="git-panel-actions">
        <button type="button" :disabled="loading" @click="refresh">
          <ReloadOutlined aria-hidden="true" /> 刷新 Git 状态
        </button>
        <button
          v-if="!deleted"
          type="button"
          class="git-delete-button"
          :disabled="loading || active || !git?.canDelete || Boolean(error)"
          @click="deleteDialog.open()"
        >
          <DeleteOutlined aria-hidden="true" /> 删除 Worktree…
        </button>
      </div>
      <p v-if="!deleted && (active || git?.deleteReason)" class="git-hint">
        {{
          active
            ? "任务执行期间不能删除 Worktree，请先停止当前任务。"
            : git.deleteReason
        }}
      </p>
    </div>
    <DeleteWorktreeDialog
      ref="deleteDialog"
      :task-key="taskKey"
      :active="active"
      @changed="git = $event"
      @refresh="refresh"
      @deleted="removed"
    />
  </section>
</template>
