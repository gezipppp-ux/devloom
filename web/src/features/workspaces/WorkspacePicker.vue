<script setup>
import { nextTick, onMounted, ref } from "vue";
import { SettingOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import WorkspaceIconEditor from "./WorkspaceIconEditor.vue";
import { workspaceIcon } from "./workspace-icons.js";
const props = defineProps({
  workspaces: { type: Array, default: () => [] },
  current: { type: Object, default: null },
  unreadWorkspaceIds: { type: Array, default: () => [] },
  rail: Boolean,
  systemSettingsOpen: Boolean,
});
const emit = defineEmits(["select", "saved", "system-settings"]);
const dialog = ref(),
  nameInput = ref();
const renaming = ref(false),
  icon = ref(null),
  name = ref(""),
  error = ref(""),
  busy = ref(false);
function initial(workspace) {
  return Array.from(workspace.name.trim())[0]?.toUpperCase() || "项";
}
function duplicateInitial(workspace) {
  return (
    !workspace.icon &&
    props.workspaces.filter(
      (entry) => !entry.icon && initial(entry) === initial(workspace),
    ).length > 1
  );
}
async function edit(rename = false) {
  renaming.value = rename;
  name.value = rename ? props.current.name : "";
  icon.value = rename ? (props.current.icon ?? null) : null;
  error.value = "";
  dialog.value.showModal();
  await nextTick();
  nameInput.value.focus();
  nameInput.value.select();
}
function close(event) {
  if (busy.value) event?.preventDefault();
  else dialog.value.close();
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await appApi(
      `/workspaces${renaming.value ? `/${props.current.id}` : ""}`,
      { name: name.value, icon: icon.value },
    );
    dialog.value?.close();
    emit("saved", result);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
defineExpose({ edit });
onMounted(() => {
  if (!props.workspaces.length) edit();
});
</script>

<template>
  <nav
    :class="rail ? 'workspace-rail' : 'workspace-choices'"
    aria-label="工作区"
  >
    <div v-if="rail" class="rail-brand" aria-label="需求开发工作台">t_</div>
    <div class="workspace-icons">
      <button
        v-for="(entry, index) in workspaces"
        :key="entry.id"
        type="button"
        class="workspace-icon"
        :class="{ active: current?.id === entry.id }"
        :aria-label="
          `切换工作区：${entry.name}${
            unreadWorkspaceIds.includes(entry.id) ? '，有未读 Codex 回复' : ''
          }`
        "
        :aria-current="current?.id === entry.id ? 'true' : undefined"
        :title="entry.name"
        @click="
          (current?.id !== entry.id || systemSettingsOpen) &&
            emit('select', entry.id)
        "
      >
        <component
          :is="workspaceIcon(entry.icon)"
          v-if="rail && workspaceIcon(entry.icon)"
          aria-hidden="true"
        />
        <span v-else aria-hidden="true">{{
          rail ? initial(entry) : entry.name
        }}</span>
        <small v-if="rail && duplicateInitial(entry)" aria-hidden="true">{{
          index + 1
        }}</small>
        <span
          v-if="unreadWorkspaceIds.includes(entry.id)"
          class="workspace-unread-result"
          aria-hidden="true"
        ></span>
      </button>
    </div>
    <button
      type="button"
      class="workspace-add"
      aria-label="＋ 新建工作区"
      title="新建工作区"
      @click="edit()"
    >
      <span aria-hidden="true">＋</span><span v-if="!rail">新建工作区</span>
    </button>
    <button
      v-if="rail"
      type="button"
      class="workspace-icon workspace-system-settings"
      :class="{ active: systemSettingsOpen }"
      aria-label="系统设置"
      title="系统设置"
      @click="emit('system-settings')"
    >
      <SettingOutlined aria-hidden="true" />
    </button>
  </nav>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="workspace-dialog"
      aria-labelledby="workspace-dialog-title"
      @cancel="close"
    >
      <form @submit.prevent="save">
        <div class="workspace-dialog-heading">
          <h2 id="workspace-dialog-title">
            {{ renaming ? "编辑工作区" : "新建工作区" }}
          </h2>
          <button
            type="button"
            class="workspace-menu"
            aria-label="关闭"
            :disabled="busy"
            @click="close"
          >
            ×
          </button>
        </div>
        <p class="muted">
          {{
            renaming
              ? "设置工作区名称和图标，便于识别不同项目。"
              : "为项目起一个名称，随后配置仓库和需求渠道。"
          }}
        </p>
        <label for="workspace-name">工作区名称</label>
        <input
          id="workspace-name"
          ref="nameInput"
          v-model="name"
          maxlength="80"
          required
          placeholder="例如：客户管理系统"
          :disabled="busy"
        />
        <WorkspaceIconEditor v-model="icon" :name="name" :disabled="busy" />
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="actions">
          <button type="button" :disabled="busy" @click="close">取消</button>
          <button class="primary" :disabled="busy || !name.trim()">
            {{ busy ? "正在保存…" : renaming ? "保存工作区" : "创建工作区" }}
          </button>
        </div>
      </form>
    </dialog>
  </Teleport>
</template>
