<script setup>
import { ref } from "vue";
import { InboxOutlined, DeleteOutlined } from "@antdv-next/icons";
import SessionLifecycleDialog from "./SessionLifecycleDialog.vue";

defineProps({
  taskKey: { type: String, required: true },
  title: { type: String, default: "" },
  worktree: { type: Object, default: null },
  deletion: { type: Object, default: null },
  active: Boolean,
  canDelete: { type: Boolean, default: true },
});
const emit = defineEmits(["archived", "deleted"]);
const mode = ref("");
</script>

<template>
  <div class="session-lifecycle-controls">
    <button type="button" :aria-label="$t('归档会话')" :title="$t('归档会话')" @click="mode = 'archive'">
      <InboxOutlined aria-hidden="true" /> {{ $t("归档") }}
    </button>
    <button v-if="canDelete" type="button" class="danger-button" :aria-label="$t('永久删除会话')" :title="$t('永久删除会话')" @click="mode = 'delete'">
      <DeleteOutlined aria-hidden="true" /> {{ $t("删除") }}
    </button>
    <SessionLifecycleDialog v-if="mode" :mode="mode" :task-key="taskKey" :title="title" :worktree="worktree" :deletion="deletion" :active="active"
      @archived="(key) => emit('archived', key)" @deleted="(key) => emit('deleted', key)" @closed="mode = ''" />
  </div>
</template>
