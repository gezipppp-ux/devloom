<script setup>
import { computed, ref } from "vue";
import { ArrowUpOutlined, StopOutlined } from "@antdv-next/icons";
import CodexModelControls from "../../shared/components/CodexModelControls.vue";
import PermissionSelect from "../../shared/components/PermissionSelect.vue";
import { useModelCatalog } from "../../shared/api/use-model-catalog.js";
import { usePermissionModes } from "../../shared/api/use-permission-modes.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  canSend: Boolean,
  running: Boolean,
  initializing: Boolean,
  busy: Boolean,
  online: Boolean,
  readOnlyReason: { type: String, default: "" },
  error: { type: String, default: "" },
  notice: { type: String, default: "" },
  executionSettings: { type: Object, required: true },
  settingsPending: Boolean,
  settingsBusy: Boolean,
  settingsError: { type: String, default: "" },
  canEditSettings: Boolean,
});
const emit = defineEmits([
  "update:modelValue",
  "send",
  "stop",
  "settings-change",
]);
const form = computed(() => ({ text: props.modelValue }));
const formRef = ref();
const sendLabel = computed(() => (props.running ? "补充指令 ↑" : "发送 ↑"));
const catalog = useModelCatalog();
const permissions = usePermissionModes();
</script>

<template>
  <section class="composer-wrap session-composer" aria-label="会话输入区">
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <a-form
      ref="formRef"
      class="composer"
      :model="form"
      :rules="{
        text: [{ required: true, whitespace: true, message: '请输入指令' }],
      }"
      @finish="emit('send')"
    >
      <a-form-item name="text">
        <textarea
          :value="modelValue"
          aria-label="发送给 Codex 的指令"
          :disabled="!canSend"
          :placeholder="
            readOnlyReason
              ? '此会话为只读'
              : running
                ? '补充指令，调整当前执行方向…'
                : '输入指令，继续这个 session…'
          "
          rows="3"
          maxlength="60000"
          @input="emit('update:modelValue', $event.target.value)"
          @keydown.ctrl.enter.prevent="formRef?.submit()"
        />
      </a-form-item>
      <div class="composer-footer composer-toolbar">
        <div class="composer-permissions">
          <PermissionSelect
            compact
            refreshable
            :refreshing="permissions.loading.value"
            :model-value="executionSettings.permissionMode"
            :options="permissions.permissionModes.value"
            :disabled="!canEditSettings || settingsBusy"
            @refresh="permissions.refresh"
            @update:model-value="
              emit('settings-change', { permissionMode: $event })
            "
          />
        </div>
        <div class="composer-tools">
          <CodexModelControls
            compact
            :model="executionSettings.model"
            :reasoning-effort="executionSettings.reasoningEffort"
            :models="catalog.models.value"
            :loading="catalog.loading.value"
            :disabled="!canEditSettings || settingsBusy"
            @change="emit('settings-change', $event)"
          />
          <div class="actions composer-actions">
            <button
              v-if="running || initializing"
              type="button"
              class="stop composer-stop"
              :disabled="busy || !online"
              aria-label="■ 停止"
              title="停止当前一轮"
              @click="emit('stop')"
            >
              <StopOutlined aria-hidden="true" />
            </button>
            <button
              type="submit"
              class="primary composer-send"
              :disabled="!canSend || !modelValue.trim()"
              :aria-label="sendLabel"
              :title="sendLabel"
            >
              <ArrowUpOutlined aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </a-form>
    <p v-if="settingsError" role="alert" class="error execution-settings-error">
      执行偏好保存失败：{{ settingsError }}
    </p>
    <p v-else class="execution-settings-hint" role="status">
      {{
        settingsBusy
          ? "正在保存执行偏好…"
          : settingsPending
            ? "已保存，下一轮生效；补充当前轮指令仍使用本轮设置。"
            : "模型、思考和权限从下一轮生效。"
      }}
    </p>
    <p
      v-if="catalog.error.value"
      class="error composer-catalog-error"
      role="alert"
    >
      模型列表加载失败：{{ catalog.error.value }}。当前选择会保留。
      <button
        type="button"
        class="text-button"
        :disabled="catalog.loading.value"
        @click="catalog.refresh"
      >
        刷新模型列表
      </button>
    </p>
    <p
      v-if="permissions.error.value"
      class="error composer-catalog-error"
      role="alert"
    >
      权限选项加载失败：{{
        permissions.error.value
      }}。尚未确认“帮我批准”是否可用。
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
    <div class="composer-note">Ctrl + Enter 发送 · 原 session 持续对话</div>
  </section>
</template>
