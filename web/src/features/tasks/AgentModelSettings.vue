<script setup>
import { watchEffect } from "vue";
import FormSection from "../../shared/components/FormSection.vue";
import AgentModelControls from "../../shared/components/AgentModelControls.vue";
import PermissionSelect from "../../shared/components/PermissionSelect.vue";
import { useModelCatalog } from "../../shared/api/use-model-catalog.js";
import { usePermissionModes } from "../../shared/api/use-permission-modes.js";
import { ReloadOutlined } from "@antdv-next/icons";
const props = defineProps({
  model: { type: String, default: "" },
  reasoningEffort: { type: String, default: "" },
  permissionMode: { type: String, default: "ask" },
  disabled: Boolean,
});
const emit = defineEmits([
  "update:model",
  "update:reasoningEffort",
  "update:permissionMode",
  "validity-change",
]);
const { models, loading, error, refresh } = useModelCatalog();
const permissions = usePermissionModes();
watchEffect(() => emit("validity-change", permissions.isAvailable(props.permissionMode)));
function changeModel(settings) {
  emit("update:model", settings.model);
  emit("update:reasoningEffort", settings.reasoningEffort);
}
</script>

<template>
  <FormSection title="执行偏好" number="02">
    <template #action>
      <button
        class="text-button"
        type="button"
        :disabled="disabled || loading"
        @click="refresh"
      >
        <ReloadOutlined aria-hidden="true" /> 刷新模型列表
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
    <p class="field-hint">
      选择具体模型后可设置其支持的思考强度。创建后仍可在会话输入区修改，从下一轮生效。
    </p>
    <a-form-item label="执行权限">
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
    <p v-if="permissions.error.value" role="alert" class="error">
      权限选项加载失败：{{
        permissions.error.value
      }}。确认权限可用后才能创建任务。
      {{ permissions.errorHint.value }}
      <button
        type="button"
        class="text-button"
        :disabled="permissions.loading.value"
        @click="permissions.refresh"
      >
        刷新权限选项
      </button>
    </p>
    <p v-if="!permissions.loading.value && !permissions.error.value && !permissions.isAvailable(permissionMode)" role="alert" class="error">当前权限模式不可用，请选择可用的权限模式。</p>
    <p v-if="loading" role="status" class="field-hint">正在读取可用模型…</p>
    <p v-if="!loading && !error && !models.length" class="field-hint">
      {{ permissions.agent.value?.label || 'Agent' }} 未返回可选模型，可使用默认配置或稍后刷新。
    </p>
    <p v-if="error" role="alert" class="error">
      模型列表加载失败：{{ error }}。当前选择会保留。
    </p>
  </FormSection>
</template>
