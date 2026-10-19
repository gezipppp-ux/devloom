<script setup>
/* global document */
import { nextTick, onMounted, onUnmounted, ref, useId } from "vue";
import { DeleteOutlined, MoreOutlined } from "@antdv-next/icons";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import { useResource } from "../../shared/api/use-resource.js";
import { appApi } from "../../shared/api/api.js";

const props = defineProps({ projectId: { type: String, required: true }, issue: { type: Object, required: true }, disabled: Boolean });
const emit = defineEmits(["deleted", "refresh"]);
const root = ref(null), trigger = ref(null), option = ref(null), menu = ref(false), confirmation = ref(null), id = useId();
const { saving, error, perform } = useResource(() => null, { immediate: false });
let alive = true;
async function toggle() { menu.value = !menu.value; if (menu.value) { await nextTick(); option.value?.focus(); } }
function closeMenu() { menu.value = false; trigger.value?.focus(); }
function open() { closeMenu(); error.value = ""; confirmation.value = { ...props.issue }; }
function close() { if (!saving.value) confirmation.value = null; }
function outside(event) { if (!root.value?.contains(event.target)) menu.value = false; }
function remove() {
  if (props.disabled || !confirmation.value?.deletion?.allowed) return;
  const { id: issueId, revision } = confirmation.value;
  return perform(async () => {
    try { return await appApi(`/projects/${props.projectId}/issues/${issueId}/delete`, { revision }); }
    catch (failure) {
      if (alive && [401, 403, 404].includes(failure.status)) { confirmation.value = null; emit("refresh"); }
      throw failure;
    }
  }, () => {
    const removed = confirmation.value.id;
    confirmation.value = null;
    emit("deleted", removed);
  }, "事项已删除。");
}
onMounted(() => document.addEventListener("pointerdown", outside));
onUnmounted(() => { alive = false; document.removeEventListener("pointerdown", outside); });
</script>

<template>
  <div ref="root" class="issue-delete-action" @keydown.esc.stop.prevent="closeMenu">
    <button ref="trigger" type="button" :aria-label="$t('更多操作')" aria-haspopup="menu" :aria-expanded="menu" :aria-controls="id" :disabled="disabled || saving" @click="toggle" @keydown.down.prevent="!menu && toggle()"><MoreOutlined aria-hidden="true" /></button>
    <div v-if="menu" :id="id" class="issue-more-menu" role="menu" :aria-label="$t('更多操作')" @keydown.tab="menu = false">
      <button ref="option" type="button" role="menuitem" @click="open"><DeleteOutlined aria-hidden="true" />{{ $t('删除事项') }}</button>
    </div>
  </div>
  <ModalDialog v-if="confirmation" open :title="$t('删除事项')" :return-focus="trigger" @close="close">
    <p class="issue-delete-title">#{{ confirmation.number }} · {{ confirmation.title }}</p>
    <p>{{ $t('删除后，事项及其讨论、附件将无法访问，并从列表、搜索、待办和版本统计中移除。此操作无法在页面中撤销。') }}</p>
    <p v-if="confirmation.deletion?.reason" class="warning">{{ $t(confirmation.deletion.reason) }}</p>
    <p v-else class="muted">{{ $t('仅可删除未关联开发任务和交付记录的事项。') }}</p>
    <p v-if="error" class="error" role="alert">{{ $t(error) }}</p>
    <template #footer>
      <div class="actions">
        <button type="button" :disabled="saving" @click="close">{{ $t('取消') }}</button>
        <button v-if="error" type="button" :disabled="saving" @click="close(); emit('refresh')">{{ $t('刷新事项后重新确认') }}</button>
        <button v-else type="button" class="danger-button" :disabled="saving || disabled || !confirmation.deletion?.allowed" @click="remove">{{ $t(saving ? '正在删除…' : '确认删除') }}</button>
      </div>
    </template>
  </ModalDialog>
</template>

<style scoped>
.issue-delete-action { position: relative; flex-shrink: 0; }
.issue-delete-action > button { min-width: 44px; min-height: 44px; }
.issue-more-menu { position: absolute; z-index: 50; inset: calc(100% + 8px) 0 auto auto; width: max-content; max-width: calc(100vw - 32px); padding: 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow-sm); }
.issue-more-menu > button { display: flex; gap: 8px; align-items: center; width: 100%; min-height: 44px; border: 0; color: var(--danger); background: transparent; }
.issue-more-menu > button:hover, .issue-more-menu > button:focus-visible { background: var(--danger-soft); }
.issue-delete-title { font-weight: 600; overflow-wrap: anywhere; }
</style>
