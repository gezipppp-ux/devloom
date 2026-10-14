<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { SettingOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import WorkspaceIconEditor from "./WorkspaceIconEditor.vue";
import { workspaceIcon } from "./workspace-icons.js";
import { createRequestId } from "../../shared/api/request-id.js";
const props = defineProps({
  workspaces: { type: Array, default: () => [] },
  current: { type: Object, default: null },
  unreadWorkspaceIds: { type: Array, default: () => [] },
  rail: Boolean,
  systemSettingsOpen: Boolean,
  showSystemSettings: { type: Boolean, default: true },
  createWorkspace: { type: Function, required: true },
});
const emit = defineEmits(["select", "saved", "system-settings", "clone-started"]);
const dialog = ref(),
  nameInput = ref();
const renaming = ref(false),
  icon = ref(null),
  name = ref(""),
  remoteUrl = ref(""),
  gitAccountId = ref(""),
  gitAccounts = ref([]),
  loadingAccounts = ref(false),
  error = ref(""),
  busy = ref(false);
const form = reactive({ name, icon, remoteUrl, gitAccountId });
let alive = true,
  requestId = "",
  generation = 0,
  editingId = "",
  returnFocus;
onBeforeUnmount(() => {
  alive = false;
  generation++;
});
watch([name, icon, remoteUrl, gitAccountId], () => { requestId = createRequestId(); });
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
  if (busy.value) return;
  const operation = ++generation;
  returnFocus = globalThis.document.activeElement;
  editingId = rename ? props.current.id : "";
  requestId = createRequestId();
  renaming.value = rename;
  name.value = rename ? props.current.name : "";
  icon.value = rename ? (props.current.icon ?? null) : null;
  remoteUrl.value = "";
  gitAccountId.value = "";
  error.value = "";
  gitAccounts.value = [];
  loadingAccounts.value = !rename;
  dialog.value.showModal();
  await nextTick();
  if (!alive || operation !== generation) return;
  nameInput.value.focus();
  nameInput.value.select();
  if (!rename) {
    try {
      const result = await appApi("/account/git-accounts");
      if (!alive || operation !== generation) return;
      gitAccounts.value = result.accounts || [];
      gitAccountId.value = gitAccounts.value[0]?.id || "";
      selectAccount();
    } catch (failure) {
      if (alive && operation === generation) error.value = failure.message;
    } finally {
      if (alive && operation === generation) loadingAccounts.value = false;
    }
  }
}
function selectAccount() {
  remoteUrl.value =
    gitAccounts.value.find((account) => account.id === gitAccountId.value)
      ?.remoteUrl || "";
}
function close(event) {
  if (busy.value) event?.preventDefault();
  else {
    generation++;
    dialog.value.close();
    returnFocus?.focus();
  }
}
async function save() {
  if (busy.value || loadingAccounts.value) return;
  const operation = generation;
  busy.value = true;
  error.value = "";
  try {
    const result = renaming.value
      ? await appApi(`/workspaces/${editingId}`, { name: name.value, icon: icon.value })
      : await props.createWorkspace({
            requestId,
            name: name.value,
            icon: icon.value,
            remoteUrl: remoteUrl.value,
            gitAccountId: gitAccountId.value,
          });
    if (!alive || operation !== generation) return;
    dialog.value?.close();
    returnFocus?.focus();
    if (renaming.value) emit("saved", result);
    else emit("clone-started");
  } catch (e) {
    if (alive && operation === generation) error.value = renaming.value ? e.message : `${e.message} 如请求中断，请先从「克隆任务」确认是否已受理，再重试。`;
  } finally {
    if (alive && operation === generation) busy.value = false;
  }
}
defineExpose({ edit });
onMounted(() => {
  if (!props.workspaces.length && !props.rail) edit();
});
</script>

<template>
  <nav
    :class="rail ? 'workspace-rail' : 'workspace-choices'"
    :aria-label="$t('工作区')"
  >
    <div v-if="rail" class="rail-brand" :aria-label="$t('需求开发工作台')">t_</div>
    <div v-if="workspaces.length" class="workspace-icons">
      <button
        v-for="(entry, index) in workspaces"
        :key="entry.id"
        type="button"
        class="workspace-icon"
        :class="{ active: current?.id === entry.id }"
        :aria-label="$t('切换工作区：{p0}{p1}', { p0: entry.name, p1: unreadWorkspaceIds.includes(entry.id) ? $t('，有未读 Codex 回复') : '' })"
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
      :aria-label="$t('＋ 新建工作区')"
      :title="$t('新建工作区')"
      @click="edit()"
    >
      <span aria-hidden="true">＋</span><span v-if="!rail">{{ $t("新建工作区") }}</span>
    </button>
    <button
      v-if="rail && showSystemSettings"
      type="button"
      class="workspace-icon workspace-system-settings"
      :class="{ active: systemSettingsOpen }"
      :aria-label="$t('系统设置')"
      :title="$t('系统设置')"
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
      <a-form :model="form" layout="vertical" @finish="save">
        <div class="workspace-dialog-heading">
          <h2 id="workspace-dialog-title">
            {{ renaming ? $t("编辑工作区") : $t("新建工作区") }}
          </h2>
          <button
            type="button"
            class="workspace-menu"
            :aria-label="$t('关闭')"
            :disabled="busy"
            @click="close"
          >
            ×
          </button>
        </div>
        <p class="muted">
          {{
            renaming
              ? $t("设置工作区名称和图标，便于识别不同项目。")
              : $t("选择 Git 账号并输入远程地址，提交后台克隆任务后创建工作区。")
          }}
        </p>
        <a-form-item :label="$t('工作区名称')" html-for="workspace-name">
          <input
            id="workspace-name"
            ref="nameInput"
            v-model="name"
            maxlength="80"
            required
            :placeholder="$t('例如：客户管理系统')"
            :disabled="busy"
          />
        </a-form-item>
        <template v-if="!renaming">
          <a-form-item :label="$t('Git 账号')" html-for="workspace-git-account">
            <select
              id="workspace-git-account"
              v-model="gitAccountId"
              :disabled="busy || loadingAccounts || !gitAccounts.length"
              required
              @change="selectAccount"
            >
              <option v-if="!gitAccounts.length" value="">
                {{ $t("请先在个人设置添加 Git 账号") }}
              </option>
              <option
                v-for="account in gitAccounts"
                :key="account.id"
                :value="account.id"
              >
                {{ account.name }}（{{
                  account.authType === "ssh" ? $t("SSH 密钥") : $t("HTTP/HTTPS 凭据")
                }}）
              </option>
            </select>
            <p v-if="loadingAccounts" class="field-hint" role="status">
              {{ $t("正在加载 Git 账号…") }}
            </p>
          </a-form-item>
          <a-form-item :label="$t('Git 远程地址')" html-for="workspace-remote-url">
            <input
              id="workspace-remote-url"
              v-model="remoteUrl"
              :placeholder="$t('例如：http://git.example.com/team/project.git')"
              required
              :disabled="busy || loadingAccounts"
            />
            <p class="field-hint">
              {{ $t("仓库会克隆至当前账号的 projects 目录，项目名称从远程地址自动生成。") }}
            </p>
          </a-form-item>
        </template>
        <WorkspaceIconEditor v-model="icon" :name="name" :disabled="busy" />
        <p v-if="!renaming" class="field-hint">{{ $t("任务受理后可关闭窗口或浏览器，再次进入可从顶部「克隆任务」查看进度。") }}</p>
        <FeedbackMessage :message="error" type="error" />
        <div class="actions">
          <button type="button" :disabled="busy" @click="close">{{ $t("取消") }}</button>
          <button
            type="submit"
            class="primary"
            :disabled="
              busy ||
              loadingAccounts ||
              !name.trim() ||
              (!renaming && (!remoteUrl.trim() || !gitAccountId))
            "
          >
            {{
              busy
                ? renaming
                  ? $t("正在保存…")
                  : $t("正在提交克隆任务…")
                : renaming
                  ? $t("保存工作区")
                  : $t("创建工作区")
            }}
          </button>
        </div>
      </a-form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.workspace-choices .workspace-icons { gap: 12px; }
.workspace-choices .workspace-icon, .workspace-choices .workspace-add { min-height: 44px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--ink); box-shadow: none; }
.workspace-choices .workspace-icon.active { border-color: var(--field-border); background: var(--selected); color: var(--highlight); }
.workspace-icon.active { box-shadow: none; }
.workspace-icon.active::before { background: var(--highlight); }
.workspace-dialog { width: min(640px, calc(100vw - 32px)); }
.workspace-dialog-heading h2 { font-size: 20px; font-weight: 600; }
.workspace-dialog .actions { gap: 12px; }
@media (max-width: 767px) {
  .workspace-choices .workspace-icons { display: flex; flex-wrap: wrap; }
  .workspace-choices .workspace-icon { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
}
</style>
