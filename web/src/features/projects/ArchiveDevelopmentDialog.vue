<script setup>
import { computed, onUnmounted, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { formatNumber } from "../../shared/i18n/index.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
const props = defineProps({ tasks: { type: Array, required: true } });
const emit = defineEmits(["closed", "archived"]);
const busy = ref(false), currentId = ref(""), completed = ref([]), failures = ref({});
const pending = computed(() => props.tasks.filter(task => !completed.value.includes(task.id)));
let alive = true;
onUnmounted(() => { alive = false; });
function close() { if (!busy.value) emit("closed"); }
async function submit() {
  if (busy.value || !pending.value.length) return;
  busy.value = true;
  const archived = [];
  for (const task of pending.value) {
    if (!alive) return;
    currentId.value = task.id;
    try {
      await appApi(`/workspaces/${encodeURIComponent(task.workspaceId)}/runs/${encodeURIComponent(task.runKey)}/archive`, {});
      if (!alive) return;
      completed.value = [...completed.value, task.id];
      archived.push(task.id);
      delete failures.value[task.id];
    } catch (error) {
      if (!alive) return;
      failures.value[task.id] = error.message;
      // Do not keep submitting after the account or its permission changes.
      if ([401, 403].includes(error.status) || error.name === "AbortError") break;
    }
  }
  currentId.value = "";
  busy.value = false;
  if (archived.length) emit("archived", archived);
  if (!pending.value.length) close();
}
</script>

<template>
  <ModalDialog open :title="$t('归档所选会话')" @close="close">
    <p>{{ $t('将归档 {count} 个会话。', { count: formatNumber(tasks.length) }) }}</p>
    <p class="muted">{{ $t('归档后从我的任务和会话列表隐藏，可在「查看已归档会话」中恢复。历史、需求资料和 Worktree 保留，开发任务状态不变。') }}</p>
    <p class="field-hint">{{ $t('正在执行或等待审批的会话无法归档，请先结束本轮。') }}</p>
    <ul class="archive-development-list">
      <li v-for="task in tasks" :key="task.id">
        <strong>{{ task.title }}</strong><small v-if="task.projectName" class="muted">{{ task.projectName }}</small>
        <span v-if="completed.includes(task.id)" role="status">{{ $t('已归档') }}</span>
        <span v-else-if="currentId === task.id" role="status">{{ $t('正在归档…') }}</span>
        <span v-else-if="failures[task.id]" class="error" role="alert">{{ $t(failures[task.id]) }}</span>
      </li>
    </ul>
    <template #footer>
      <div class="actions">
        <button type="button" :disabled="busy" @click="close">{{ $t(completed.length ? '关闭' : '取消') }}</button>
        <button type="button" class="primary" :disabled="busy || !pending.length" @click="submit">{{ $t(busy ? '正在归档…' : Object.keys(failures).length ? '重试未归档会话' : '确认归档') }}</button>
      </div>
    </template>
  </ModalDialog>
</template>

<style scoped>
.archive-development-list { padding: 0; margin: 20px 0 0; list-style: none; }
.archive-development-list li { display: grid; gap: 6px; padding: 12px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
.archive-development-list strong { font-weight: 500; }
</style>
