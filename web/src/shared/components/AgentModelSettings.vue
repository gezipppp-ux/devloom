<script setup>
import FeedbackMessage from "./FeedbackMessage.vue";
import { computed, watchEffect } from "vue";
import FormSection from "./FormSection.vue";
import AgentModelControls from "./AgentModelControls.vue";
import PermissionSelect from "./PermissionSelect.vue";
import { api, appApi } from "../api/api.js";
import { useModelCatalog } from "../api/use-model-catalog.js";
import { usePermissionModes } from "../api/use-permission-modes.js";
import { ReloadOutlined } from "@antdv-next/icons";
const props = defineProps({
  model: { type: String, default: "" },
  reasoningEffort: { type: String, default: "" },
  permissionMode: { type: String, default: "ask" },
  disabled: Boolean,
  embedded: Boolean,
  workspaceId: { type: String, default: "" },
});
const emit = defineEmits([
  "update:model",
  "update:reasoningEffort",
  "update:permissionMode",
  "validity-change",
]);
const request = url => props.workspaceId
  ? appApi(`/workspaces/${encodeURIComponent(props.workspaceId)}${url}`)
  : api(url);
const { models, loading, error, refresh } = useModelCatalog(request);
const permissions = usePermissionModes(request);
const modelUnavailable = computed(() => {
  if (loading.value || error.value || !props.model) return false;
  const selected = models.value.find(entry => entry.model === props.model);
  return !selected || Boolean(props.reasoningEffort && !selected.reasoningEfforts.includes(props.reasoningEffort));
});
watchEffect(() => emit("validity-change", permissions.isAvailable(props.permissionMode) && !modelUnavailable.value));
function changeModel(settings) {
  emit("update:model", settings.model);
  emit("update:reasoningEffort", settings.reasoningEffort);
}
</script>

<template>
  <FormSection :title="$t('执行偏好')" :number="embedded ? '' : '02'" :class="{ 'agent-model-settings-embedded': embedded }">
    <template #action>
      <button
        class="text-button"
        type="button"
        :disabled="disabled || loading"
        @click="refresh"
      >
        <ReloadOutlined aria-hidden="true" /> {{ $t("刷新模型列表") }}
      </button>
    </template>
    <AgentModelControls
      :agent-label="permissions.agent.value?.label || 'Agent'"
      :model="model"
      :reasoning-effort="reasoningEffort"
      :models="models"
      :loading="loading"
      :disabled="disabled"
      @change="changeModel"
    />
    <p v-if="permissions.nextSupplier.value" class="field-hint">{{ $t("系统供应商：") }}{{ permissions.nextSupplier.value.name }}</p>
    <p v-if="modelUnavailable" class="error" role="alert">{{ $t("当前模型或思考强度不受系统供应商支持，请重新选择。") }}</p>
    <p class="field-hint">
      {{ $t("选择具体模型后可设置其支持的思考强度。创建后仍可在会话输入区修改，从下一轮生效。") }}
    </p>
    <a-form-item :label="$t('执行权限')" layout="vertical">
      <PermissionSelect
        refreshable
        :refreshing="permissions.loading.value"
        :model-value="permissionMode"
        :options="permissions.permissionModes.value"
        :disabled="disabled"
        @refresh="permissions.refresh"
        @update:model-value="emit('update:permissionMode', $event)"
      />
    </a-form-item>
    <FeedbackMessage :message="permissions.error.value ? $t('权限选项加载失败：{p0}。确认权限可用后才能创建任务。 {p1}', { p0: permissions.error.value, p1: permissions.errorHint.value }) : ''" type="error" />
    <div v-if="permissions.error.value"><button
        type="button"
        class="text-button"
        :disabled="permissions.loading.value"
        @click="permissions.refresh"
      >
        {{ $t("刷新权限选项") }}
      </button></div>
    <p v-if="!permissions.loading.value && !permissions.error.value && !permissions.isAvailable(permissionMode)" role="alert" class="error">{{ $t("当前权限模式不可用，请选择可用的权限模式。") }}</p>
    <p v-if="loading" role="status" class="field-hint">{{ $t("正在读取可用模型…") }}</p>
    <p v-if="!loading && !error && !models.length" class="field-hint">
      {{ permissions.agent.value?.label || 'Agent' }} {{ $t("未返回可选模型，可使用默认配置或稍后刷新。") }}
    </p>
    <FeedbackMessage :message="error ? $t('模型列表加载失败：{p0}。当前选择会保留。', { p0: error }) : ''" type="error" />
  </FormSection>
</template>
