<script setup>
import { formatDate } from "../../shared/i18n/index.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { showMessage } from "../../shared/components/operation-messages.js";
import { computed, nextTick, ref, watch } from "vue";
import { InboxOutlined, UndoOutlined, ReloadOutlined, DeleteOutlined } from "@antdv-next/icons";
import { useArchivedSessions } from "./use-archived-sessions.js";

const props = defineProps({ revision: { type: Number, default: 0 }, disabled: Boolean });
const emit = defineEmits(["restored", "deleted"]);
const { runs, loading, error, restoring, restoreError, refresh, restore, remove } = useArchivedSessions();
const dialog = ref(), trigger = ref(), searchInput = ref();
const opened = ref(false), query = ref("");
const deleteTarget = ref(null);
const locked = computed(() => Boolean(restoring.value || deleteTarget.value));
let deleteTrigger;
const filtered = computed(() => runs.value.filter((run) =>
  run.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
function open() {
  opened.value = true;
  query.value = "";
  restoreError.value = "";
  dialog.value.showModal();
  void refresh();
  void nextTick(() => searchInput.value?.focus());
}
function close() {
  if (locked.value) return;
  opened.value = false;
  dialog.value.close();
  trigger.value?.focus();
}
async function recover(run) {
  if (locked.value) return;
  if (await restore(run.key)) {
    showMessage(`已恢复「${run.title}」，可在左侧会话列表中打开。`, "success");
    emit("restored", run.key);
    void nextTick(() => searchInput.value?.focus());
  }
}
function requestDelete(run, event) {
  if (locked.value) return;
  restoreError.value = "";
  deleteTrigger = event.currentTarget;
  deleteTarget.value = run;
}
function deleted(key) {
  const title = deleteTarget.value?.title;
  remove(key);
  showMessage(`已永久删除「${title}」。`, "success");
  emit("deleted", key);
}
function closeDeletion() {
  deleteTarget.value = null;
  void nextTick(() => {
    if (deleteTrigger?.isConnected) deleteTrigger.focus();
    else searchInput.value?.focus();
    deleteTrigger = null;
  });
}
function dateLabel(value) {
  return formatDate(value, { hour: "2-digit", minute: "2-digit", hour12: false });
}
watch(() => props.revision, () => { if (opened.value) void refresh(); });
defineExpose({ open });
</script>

<template>
  <button ref="trigger" type="button" class="settings-link archived-sessions-trigger" :disabled="disabled" @click="open">
    <InboxOutlined aria-hidden="true" />{{ $t("已归档会话") }}
  </button>
  <Teleport to="body">
    <dialog ref="dialog" class="workspace-dialog archived-sessions-dialog" :aria-label="$t('已归档会话')" @cancel.prevent="close">
      <div class="workspace-dialog-heading">
        <h2>{{ $t("已归档会话") }}</h2>
        <button type="button" class="workspace-menu" :aria-label="$t('关闭已归档会话')" :disabled="locked" @click="close">×</button>
      </div>
      <p class="muted">{{ $t("恢复后会话重新显示在需求列表中，保留原有历史和代码状态。") }}</p>
      <label for="archived-session-search">{{ $t("搜索会话名称") }}</label>
      <input id="archived-session-search" ref="searchInput" v-model="query" type="search" :placeholder="$t('输入会话名称')" />
      <FeedbackMessage :message="restoreError ? $t('恢复失败：{p0}', { p0: restoreError }) : ''" type="error" />
      <p v-if="loading" class="muted" role="status">{{ $t("正在加载已归档会话…") }}</p>
      <div v-else-if="error">
        <FeedbackMessage :message="$t('加载失败：{p0}', { p0: error })" type="error" />
        <button type="button" @click="refresh"><ReloadOutlined aria-hidden="true" /> {{ $t("重试") }}</button>
      </div>
      <ul v-else-if="filtered.length" class="archived-session-list" :aria-label="$t('已归档会话列表')">
        <li v-for="run in filtered" :key="run.key">
          <div class="archived-session-info">
            <h3>{{ run.title }}</h3>
            <p class="field-hint">{{ $t("归档于") }} <time :datetime="run.archivedAt">{{ dateLabel(run.archivedAt) }}</time></p>
          </div>
          <div class="archived-session-actions">
            <button type="button" :disabled="locked" :aria-label="$t('恢复会话：{p0}', { p0: run.title })" @click="recover(run)">
              <UndoOutlined aria-hidden="true" />{{ restoring === run.key ? $t("恢复中…") : $t("恢复") }}
            </button>
            <button type="button" class="danger-button" :disabled="locked" :aria-label="$t('永久删除会话：{p0}', { p0: run.title })" @click="requestDelete(run, $event)">
              <DeleteOutlined aria-hidden="true" />{{ $t("删除") }}
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="empty-inline">{{ query.trim() ? $t("没有匹配的已归档会话。") : $t("暂无已归档会话。") }}</p>
      <div class="actions">
        <button type="button" :disabled="loading || locked" @click="refresh"><ReloadOutlined aria-hidden="true" /> {{ $t("刷新列表") }}</button>
        <button type="button" class="primary" :disabled="locked" @click="close">{{ $t("完成") }}</button>
      </div>
    </dialog>
  </Teleport>
  <slot v-if="deleteTarget" name="delete-dialog" :run="deleteTarget" :deleted="deleted" :close="closeDeletion" />
</template>

<style scoped>
.archived-sessions-dialog { width: min(820px, calc(100vw - 32px)); }
.archived-session-list { margin: 24px 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; }
.archived-session-list li { padding: 22px 24px; margin: 0; border: 0; border-bottom: 1px solid var(--line); background: var(--surface); }
.archived-session-list li:last-child { border-bottom: 0; }
.archived-session-info h3 { font-size: 14px; font-weight: 500; line-height: 1.6; }
.archived-session-actions { gap: 8px; }
@media (max-width: 767px) {
  .archived-session-list li { padding: 18px 16px; align-items: flex-start; flex-wrap: wrap; gap: 14px; }
  .archived-session-info { flex-basis: 100%; }
  .archived-session-actions { width: 100%; }
  .archived-session-actions > button { min-height: 44px; }
}
</style>
