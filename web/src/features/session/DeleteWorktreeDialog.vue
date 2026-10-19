<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, nextTick, onUnmounted, ref } from "vue";
import { api } from "../../shared/api/api.js";

const props = defineProps({
  taskKey: { type: String, required: true },
  active: Boolean,
});
const emit = defineEmits(["deleted", "changed", "refresh"]);
const dialog = ref();
const confirmInput = ref();
const snapshot = ref(null);
const confirmation = ref("");
const discardChanges = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
let revision = 0;
const hasRisk = computed(() =>
  Boolean(
    snapshot.value &&
    (snapshot.value.changedFiles > 0 ||
      snapshot.value.untrackedFiles > 0 ||
      snapshot.value.ignoredFiles > 0 ||
      (snapshot.value.retainedBranch
        ? Boolean(snapshot.value.taskBranchHead)
        : snapshot.value.unpublished || snapshot.value.ahead > 0 || !Number.isInteger(snapshot.value.ahead))),
  ),
);
const canDelete = computed(() =>
  Boolean(
    snapshot.value?.canDelete &&
    !loading.value &&
    !busy.value &&
    !props.active &&
    confirmation.value === snapshot.value.branch &&
    (!hasRisk.value || discardChanges.value),
  ),
);

async function refresh() {
  const current = ++revision;
  loading.value = true;
  snapshot.value = null;
  error.value = "";
  confirmation.value = "";
  discardChanges.value = false;
  try {
    const result = await api(`/runs/${props.taskKey}/git`);
    if (current !== revision) return;
    snapshot.value = result;
    emit("changed", result);
  } catch (e) {
    if (current === revision) error.value = e.message;
  } finally {
    if (current === revision) loading.value = false;
  }
}
async function open() {
  dialog.value.showModal();
  await refresh();
  await nextTick();
  if (dialog.value?.open) confirmInput.value?.focus();
}
function close() {
  if (busy.value) return;
  revision++;
  loading.value = false;
  dialog.value.close();
}
async function remove() {
  if (!canDelete.value) return;
  const current = ++revision;
  busy.value = true;
  error.value = "";
  try {
    const result = await api(`/runs/${props.taskKey}/worktree/delete`, {
      expectedHead: snapshot.value.head,
      statusToken: snapshot.value.statusToken,
      confirmBranch: confirmation.value,
      discardChanges: discardChanges.value,
    });
    if (current !== revision) return;
    dialog.value.close();
    emit("deleted", result);
  } catch (e) {
    if (current === revision) {
      error.value = e.message;
      snapshot.value = null;
      emit("refresh");
    }
  } finally {
    if (current === revision) busy.value = false;
  }
}
onUnmounted(() => {
  revision++;
});
defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="workspace-dialog delete-worktree-dialog"
      :aria-label="$t('删除 Worktree')"
      @cancel.prevent="close"
    >
      <div class="workspace-dialog-heading">
        <h2>{{ $t("删除 Worktree") }}</h2>
        <button
          type="button"
          class="workspace-menu"
          :aria-label="$t('关闭删除确认')"
          :disabled="busy"
          @click="close"
        >
          ×
        </button>
      </div>
      <p class="muted">
        {{ $t("永久删除此任务的 Worktree 目录及其中所有文件，并删除原任务本地分支。会话历史保留为只读，远程分支保留。") }}
      </p>
      <p v-if="loading" class="muted" role="status">
        {{ $t("正在检查文件、提交和分支状态…") }}
      </p>
      <template v-if="snapshot">
        <p v-if="snapshot.warning" class="git-feedback warning" role="status">
          {{ snapshot.warning }}
        </p>
        <p
          v-if="snapshot.deletion?.status === 'partial'"
          class="git-feedback warning"
        >
          {{ $t("目录已删除，本地分支尚未删除。本次操作将继续清理本地分支。") }}
        </p>
        <dl class="git-facts">
          <dt>{{ $t("删除目录") }}</dt>
          <dd>
            <code>{{ snapshot.path }}</code>
          </dd>
          <dt>{{ $t("删除本地分支") }}</dt>
          <dd>
            <code>{{ snapshot.branch }}</code>
          </dd>
          <template v-if="snapshot.retainedBranch">
            <dt>{{ $t("保留本地分支") }}</dt>
            <dd><code>{{ snapshot.retainedBranch }}</code></dd>
          </template>
        </dl>
        <div class="git-feedback warning">
          <p>
            {{ $t("此操作包含未跟踪文件、被 Git 忽略的文件（如 .env、依赖和构建产物），不能通过工作台撤销。") }}
          </p>
          <p>
            {{ $t("已跟踪文件的修改：") }}{{
              snapshot.changedFiles ?? $t("未知")
            }}{{ $t("；未跟踪文件：") }}{{
              snapshot.untrackedFiles ?? $t("未知")
            }}{{ $t("；忽略条目：") }}{{ snapshot.ignoredFiles ?? $t("未知") }}。
          </p>
          <p v-if="snapshot.retainedBranch">
            {{ snapshot.taskBranchHead
              ? $t("切换分支后仍将删除原任务分支，请确认其需要的提交已保留。当前分支及其提交会保留，目录内未提交的文件修改会被删除。")
              : $t("原任务分支已不存在，本次仅删除工作目录。当前分支及其提交会保留。") }}
          </p>
          <p v-else-if="snapshot.unpublished">
            {{ $t("此分支尚未发布，删除本地分支可能丢失尚未保存在远端的提交。") }}
          </p>
          <p v-else>
            {{ $t("待推送提交：") }}{{
              snapshot.ahead ?? $t("未知")
            }}{{ $t("。数量按最近获取的远端记录计算；删除前请确认需要的提交已保留。") }}
          </p>
        </div>
        <p v-if="!snapshot.canDelete || active" class="error">
          {{
            active
              ? $t("任务正在执行，请先停止任务再删除。")
              : snapshot.deleteReason
          }}
        </p>
        <form @submit.prevent="remove">
          <label for="delete-worktree-confirm"
            >{{ $t("输入以下完整本地分支名以确认删除") }}</label
          >
          <p id="delete-worktree-confirm-hint" class="field-hint">
            {{ $t("请准确输入：") }}<code>{{ snapshot.branch }}</code>
          </p>
          <input
            id="delete-worktree-confirm"
            ref="confirmInput"
            v-model="confirmation"
            :aria-label="$t('确认删除的本地分支')"
            aria-describedby="delete-worktree-confirm-hint"
            :disabled="busy"
            :placeholder="snapshot.branch"
            autocomplete="off"
            spellcheck="false"
          />
          <label v-if="hasRisk" class="git-risk-confirm">
            <input v-model="discardChanges" type="checkbox" :disabled="busy" />
            <span>{{ $t("我确认放弃此目录中的文件，以及尚未推送或发布的提交。") }}</span>
          </label>
          <div class="actions">
            <button type="button" :disabled="busy" @click="close">{{ $t("取消") }}</button>
            <button type="submit" class="danger-button" :disabled="!canDelete">
              {{ busy ? $t("正在删除…") : $t("删除文件与本地分支") }}
            </button>
          </div>
        </form>
      </template>
      <FeedbackMessage :message="error" type="error" />
      <div v-if="!snapshot && !loading" class="actions">
        <button type="button" @click="close">{{ $t("取消") }}</button>
        <button type="button" :disabled="busy" @click="refresh">
          {{ $t("重新检查删除条件") }}
        </button>
      </div>
    </dialog>
  </Teleport>
</template>
