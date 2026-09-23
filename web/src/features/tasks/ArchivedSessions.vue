<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { InboxOutlined, UndoOutlined, ReloadOutlined } from "@antdv-next/icons";
import { useArchivedSessions } from "./use-archived-sessions.js";

const props = defineProps({ revision: { type: Number, default: 0 }, disabled: Boolean });
const emit = defineEmits(["restored"]);
const { runs, loading, error, restoring, restoreError, refresh, restore } = useArchivedSessions();
const dialog = ref(), trigger = ref(), searchInput = ref();
const opened = ref(false), query = ref(""), notice = ref("");
const filtered = computed(() => runs.value.filter((run) =>
  run.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
function open() {
  opened.value = true;
  query.value = "";
  notice.value = "";
  restoreError.value = "";
  dialog.value.showModal();
  void refresh();
  void nextTick(() => searchInput.value?.focus());
}
function close() {
  if (restoring.value) return;
  opened.value = false;
  dialog.value.close();
  trigger.value?.focus();
}
async function recover(run) {
  notice.value = "";
  if (await restore(run.key)) {
    notice.value = `已恢复「${run.title}」，可在左侧会话列表中打开。`;
    emit("restored", run.key);
    void nextTick(() => searchInput.value?.focus());
  }
}
function dateLabel(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
watch(() => props.revision, () => { if (opened.value) void refresh(); });
</script>

<template>
  <button ref="trigger" type="button" class="settings-link archived-sessions-trigger" :disabled="disabled" @click="open">
    <InboxOutlined aria-hidden="true" />已归档会话
  </button>
  <Teleport to="body">
    <dialog ref="dialog" class="workspace-dialog archived-sessions-dialog" aria-label="已归档会话" @cancel.prevent="close">
      <div class="workspace-dialog-heading">
        <h2>已归档会话</h2>
        <button type="button" class="workspace-menu" aria-label="关闭已归档会话" :disabled="Boolean(restoring)" @click="close">×</button>
      </div>
      <p class="muted">恢复后会话重新显示在需求列表中，保留原有历史和代码状态。</p>
      <label for="archived-session-search">搜索会话名称</label>
      <input id="archived-session-search" ref="searchInput" v-model="query" type="search" placeholder="输入会话名称" />
      <p v-if="notice" class="git-feedback" role="status">{{ notice }}</p>
      <p v-if="restoreError" class="error" role="alert">恢复失败：{{ restoreError }}</p>
      <p v-if="loading" class="muted" role="status">正在加载已归档会话…</p>
      <div v-else-if="error" role="alert">
        <p class="error">加载失败：{{ error }}</p>
        <button type="button" @click="refresh"><ReloadOutlined aria-hidden="true" /> 重试</button>
      </div>
      <ul v-else-if="filtered.length" class="archived-session-list" aria-label="已归档会话列表">
        <li v-for="run in filtered" :key="run.key">
          <div class="archived-session-info">
            <h3>{{ run.title }}</h3>
            <p class="field-hint">归档于 <time :datetime="run.archivedAt">{{ dateLabel(run.archivedAt) }}</time></p>
          </div>
          <button type="button" :disabled="Boolean(restoring)" :aria-label="`恢复会话：${run.title}`" @click="recover(run)">
            <UndoOutlined aria-hidden="true" />{{ restoring === run.key ? "恢复中…" : "恢复" }}
          </button>
        </li>
      </ul>
      <p v-else class="empty-inline">{{ query.trim() ? "没有匹配的已归档会话。" : "暂无已归档会话。" }}</p>
      <div class="actions">
        <button type="button" :disabled="loading || Boolean(restoring)" @click="refresh"><ReloadOutlined aria-hidden="true" /> 刷新列表</button>
        <button type="button" class="primary" :disabled="Boolean(restoring)" @click="close">完成</button>
      </div>
    </dialog>
  </Teleport>
</template>
