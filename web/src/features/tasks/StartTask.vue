<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import UserSearchSelect from "./UserSearchSelect.vue";
import ManualRequirementFields from "./ManualRequirementFields.vue";
import AgentModelSettings from "../../shared/components/AgentModelSettings.vue";
import FormSection from "../../shared/components/FormSection.vue";
import { api } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";
import { createRequestId } from "../../shared/api/request-id.js";
const props = defineProps({
  workspace: { type: String, default: "" },
  channels: { type: Array, default: () => [] },
});
const emit = defineEmits(["started", "cancel"]);
const form = reactive({
  channel: props.channels[0]?.id || "manual",
  workspace: props.workspace,
  id: "",
  developer: "",
  tester: "",
  requestId: createRequestId(),
  title: "",
  content: "",
  images: [],
  worktreeName: "",
  model: accountSession.settings.model || "",
  reasoningEffort: accountSession.settings.reasoningEffort || "",
  permissionMode: accountSession.settings.permissionMode || "ask",
});
const query = ref("");
const items = ref([]);
const error = ref("");
const searching = ref(false);
const starting = ref(false);
const permissionsReady = ref(false);
const busy = computed(() => searching.value || starting.value);
const uploading = ref(false);
const searched = ref(false);
const selectedChannel = computed(() =>
  props.channels.find((channel) => channel.id === form.channel),
);
const needsAssignees = computed(
  () => selectedChannel.value?.capabilities.assignees,
);
const manualInput = computed(
  () => selectedChannel.value?.capabilities.manualInput,
);
const rules = computed(() =>
  Object.fromEntries(
    [
      "channel",
      ...(manualInput.value ? ["title"] : ["workspace", "id"]),
      ...(needsAssignees.value ? ["developer", "tester"] : []),
    ].map((key) => [key, [{ required: true, message: "请填写或选择此项" }]]),
  ),
);
watch(
  () => form.channel,
  () => {
    form.workspace = selectedChannel.value?.workspace || "";
    form.id = "";
    form.developer = "";
    form.tester = "";
    items.value = [];
    searched.value = false;
  },
);
watch(
  () => form.workspace,
  () => {
    form.id = "";
    form.developer = "";
    form.tester = "";
    items.value = [];
    searched.value = false;
  },
);
let searchRevision = 0;
let disposed = false;
onUnmounted(() => {
  disposed = true;
  searchRevision++;
});
watch(
  () => [form.workspace, form.channel],
  () => {
    searchRevision++;
    searching.value = false;
  },
);

async function search() {
  if (disposed || starting.value || uploading.value || !form.workspace) return;
  const revision = ++searchRevision;
  searching.value = true;
  error.value = "";
  try {
    const result = (
      await api(
        `/requirements?${new URLSearchParams({ channel: form.channel, workspace: form.workspace, query: query.value })}`,
      )
    ).items;
    if (revision !== searchRevision) return;
    items.value = result;
    searched.value = true;
  } catch (e) {
    if (revision === searchRevision) error.value = e.message;
  } finally {
    if (revision === searchRevision) searching.value = false;
  }
}
async function start() {
  if (disposed || busy.value || uploading.value || !permissionsReady.value) return;
  starting.value = true;
  error.value = "";
  try {
    if (manualInput.value && !form.content.trim() && !form.images.length)
      throw new Error("请填写需求内容或上传图片。");
    const result = await api(
      "/runs",
      manualInput.value
        ? {
            channel: form.channel,
            requestId: form.requestId,
            title: form.title,
            content: form.content,
            images: [...form.images],
            worktreeName: form.worktreeName,
            model: form.model,
            reasoningEffort: form.reasoningEffort,
            permissionMode: form.permissionMode,
          }
        : {
            channel: form.channel,
            workspace: form.workspace,
            id: form.id,
            ...(needsAssignees.value ? { developer: form.developer, tester: form.tester } : {}),
            model: form.model,
            reasoningEffort: form.reasoningEffort,
            permissionMode: form.permissionMode,
          },
    );
    if (!disposed) emit("started", result.key);
  } catch (e) {
    if (!disposed) error.value = e.message;
  } finally {
    if (!disposed) starting.value = false;
  }
}
</script>

<template>
  <section class="page-layout start-task">
    <header class="page-heading">
      <div class="eyebrow">NEW SESSION</div>
      <h1>{{ $t("从需求，开始开发。") }}</h1>
      <p>{{ $t("描述目标与验收标准，为本次任务选择模型。") }}</p>
    </header>
    <a-form :model="form" :rules="rules" layout="vertical" @finish="start">
      <FormSection :title="$t('需求信息')" number="01">
        <div class="form-columns">
          <a-form-item :label="$t('需求渠道')" name="channel"
            ><AppSelect native-events
              v-model="form.channel"
              :aria-label="$t('需求渠道')"
              :disabled="busy || uploading"
            >
              <option
                v-for="channel in channels"
                :key="channel.id"
                :value="channel.id"
              >
                {{ $t(channel.label) }}
              </option>
            </AppSelect></a-form-item
          >
        </div>
        <ManualRequirementFields
          v-show="manualInput"
          :form="form"
          :disabled="busy || !manualInput"
          @uploading="uploading = $event"
          @change="
            Object.assign(form, $event);
            error = '';
          "
        />
        <a-form-item
          v-if="!manualInput"
          :label="selectedChannel?.scopeLabel || $t('项目 ID')"
          name="workspace"
          ><input
            v-model="form.workspace"
            :readonly="selectedChannel?.scopeLocked"
            :disabled="busy || uploading"
            :aria-label="selectedChannel?.scopeLabel || $t('项目 ID')"
            required
        /></a-form-item>
        <label v-if="selectedChannel?.capabilities.search" for="search"
          >{{ $t("检索需求") }}</label
        >
        <div v-if="selectedChannel?.capabilities.search" class="search-row">
          <input
            id="search"
            v-model="query"
            :placeholder="$t('输入需求标题关键词')"
            :disabled="starting || uploading"
            @keydown.enter.prevent="search"
          /><button
            type="button"
            :disabled="busy || !form.workspace"
            @click="search"
          >
            {{ $t("检索") }}
          </button>
        </div>
        <div v-if="items.length" class="search-results">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            :disabled="busy || uploading"
            :class="{ selected: form.id === item.id }"
            @click="form.id = item.id"
          >
            <span>{{ item.title }}</span
            ><small>{{ item.id }} · {{ item.status }}</small>
            <small v-if="item.localRun">{{ $t("本系统已有任务") }}</small>
          </button>
        </div>
        <p v-else-if="searched" class="muted">
          {{ $t("当前待办视图没有匹配结果，也可直接填写需求 ID。") }}
        </p>
        <a-form-item v-if="!manualInput" :label="$t('需求 ID')" name="id"
          ><input
            v-model="form.id"
            :aria-label="$t('需求 ID')"
            :disabled="busy || uploading"
            required
        /></a-form-item>
        <div v-if="needsAssignees" class="form-columns">
          <a-form-item :label="$t('开发人员')" name="developer"
            ><UserSearchSelect
              v-model="form.developer"
              :channel="form.channel"
              :workspace="form.workspace"
              :disabled="busy || uploading"
              :label="$t('开发人员')"
          /></a-form-item>
          <a-form-item :label="$t('测试人员')" name="tester"
            ><UserSearchSelect
              v-model="form.tester"
              :channel="form.channel"
              :workspace="form.workspace"
              :disabled="busy || uploading"
              :label="$t('测试人员')"
          /></a-form-item>
        </div>
      </FormSection>
      <AgentModelSettings
        @validity-change="permissionsReady = $event"
        v-model:model="form.model"
        v-model:reasoning-effort="form.reasoningEffort"
        v-model:permission-mode="form.permissionMode"
        :disabled="busy || uploading"
      />
      <FeedbackMessage :message="error" type="error" />
      <div class="actions page-actions">
        <button
          type="button"
          :disabled="busy || uploading"
          @click="emit('cancel')"
        >
          {{ $t("取消") }}</button
        ><button class="primary" :disabled="busy || uploading || !permissionsReady" type="submit">
          {{ busy ? $t("正在处理…") : $t("创建 session 并开始开发 →") }}
        </button>
      </div>
    </a-form>
  </section>
</template>

<style scoped>
.start-task { width: 100%; max-width: 1040px; margin-inline: auto; }
.page-heading { margin-bottom: 32px; }
.page-heading .eyebrow { display: none; }
.page-heading h1 { font-size: clamp(24px, 2.2vw, 32px); font-weight: 600; letter-spacing: -.02em; }
.page-heading p { max-width: 640px; line-height: 1.8; }
.start-task > :deep(.ant-form) { padding: 0 32px 24px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
.start-task :deep(.form-section) { margin: 0; padding: 28px 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; box-shadow: none; }
.start-task :deep(.form-section-heading) { margin-bottom: 24px; }
.start-task :deep(.form-section-heading h2) { font-size: 16px; }
.page-actions { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); gap: 12px; }
@media (max-width: 767px) {
  .page-heading { margin-bottom: 24px; }
  .start-task > :deep(.ant-form) { padding: 0 16px 20px; }
  .start-task :deep(.form-section) { padding-block: 22px; }
  .form-columns { grid-template-columns: minmax(0, 1fr); }
  .page-actions { flex-wrap: wrap; }
  .page-actions > button { min-height: 44px; }
}
</style>
