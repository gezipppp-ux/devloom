<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, ref, watch } from "vue";
import {
  ArrowUpOutlined,
  CloseOutlined,
  PlusOutlined,
  StopOutlined,
} from "@antdv-next/icons";
import AgentModelControls from "../../shared/components/AgentModelControls.vue";
import PermissionSelect from "../../shared/components/PermissionSelect.vue";
import { useModelCatalog } from "../../shared/api/use-model-catalog.js";
import { usePermissionModes } from "../../shared/api/use-permission-modes.js";

const props = defineProps({
  agent: { type: Object, default: null },
  modelValue: { type: String, default: "" },
  preview: { type: Object, default: null },
  images: { type: Array, default: () => [] },
  imagesUploading: Boolean,
  imagesBlocked: Boolean,
  imagesError: { type: String, default: "" },
  canSend: Boolean,
  canStop: { type: Boolean, default: true },
  running: Boolean,
  initializing: Boolean,
  busy: Boolean,
  online: Boolean,
  readOnlyReason: { type: String, default: "" },
  error: { type: String, default: "" },
  notice: { type: String, default: "" },
  executionSettings: { type: Object, required: true },
  settingsPending: Boolean,
  activeSupplier: { type: Object, default: null },
  nextSupplier: { type: Object, default: null },
  supplierPending: Boolean,
  settingsBusy: Boolean,
  settingsError: { type: String, default: "" },
  canEditSettings: Boolean,
});
const emit = defineEmits([
  "update:modelValue",
  "send",
  "images-add",
  "images-remove",
  "images-retry",
  "stop",
  "settings-change",
  "preview-remove",
]);
const form = computed(() => ({ text: props.modelValue }));
const formRef = ref();
const imageInput = ref();
const supportsImages = computed(() => props.agent?.capabilities?.images === true);
const canSubmit = computed(
  () =>
    props.canSend &&
    (props.running || !modelUnavailable.value) &&
    (props.running || permissions.isAvailable(props.executionSettings.permissionMode)) &&
    (supportsImages.value || !props.images.length) &&
    !props.imagesBlocked &&
    Boolean(props.modelValue.trim() || props.images.length),
);
const sendLabel = computed(() => (props.running ? "补充指令 ↑" : "发送 ↑"));
const catalog = useModelCatalog();
const permissions = usePermissionModes();
const modelUnavailable = computed(() => {
  if (catalog.loading.value || catalog.error.value || !props.executionSettings.model) return false;
  const selected = catalog.models.value.find(entry => entry.model === props.executionSettings.model);
  return !selected || Boolean(props.executionSettings.reasoningEffort && !selected.reasoningEfforts.includes(props.executionSettings.reasoningEffort));
});
watch(() => `${props.nextSupplier?.id}:${props.nextSupplier?.runtimeRevision}`, () => { catalog.refresh(); permissions.refresh(); });
const agentLabel = computed(() => props.agent?.label || permissions.agent.value?.label || "Agent");
const permissionUnavailable = computed(() => !permissions.loading.value && !permissions.error.value && !permissions.isAvailable(props.executionSettings.permissionMode));

function paste(event) {
  if (!props.canSend || !supportsImages.value) return;
  const files = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (files.length) emit("images-add", files);
  // Preserve native textarea pasting, including text accompanying an image.
}
function chooseImages(event) {
  if (!supportsImages.value) return;
  if (event.target.files?.length) emit("images-add", [...event.target.files]);
  event.target.value = "";
}
function submit() {
  if (canSubmit.value) formRef.value?.submit();
}
function onEnter(event) {
  // IME confirmation must keep its native behavior, including legacy keyCode 229.
  if (event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!event.repeat) submit();
}
function send() {
  if (canSubmit.value) emit("send");
}
</script>

<template>
  <section class="composer-wrap session-composer" :aria-label="$t('会话输入区')">
    <p v-if="nextSupplier && supplierPending" class="execution-settings-hint" role="status">
      <span v-if="running && activeSupplier">{{ $t("本轮供应商：") }}{{ activeSupplier.name }} · </span>
      {{ running && supplierPending ? $t("下一轮供应商") : $t("系统供应商") }}：{{ nextSupplier.name }}
    </p>
    <FeedbackMessage :message="error" type="error" />
    <FeedbackMessage :message="notice" type="success" />
    <p v-if="modelUnavailable" class="error" role="alert">{{ $t("当前模型或思考强度不受下一轮供应商支持，请重新选择后发送。") }}{{ running ? $t("本轮补充指令仍使用原配置。") : '' }}</p>
    <a-form
      ref="formRef"
      class="composer"
      :model="form"
      @finish="send"
    >
      <div v-if="preview" class="composer-preview-reference">
        <div><strong>{{ $t('引用预览') }} · {{ preview.title }} · {{ $t('版本 {version}', { version: preview.version }) }}</strong>
          <details><summary>{{ $t('查看本次反馈上下文') }}</summary><pre>{{ JSON.stringify(preview.state, null, 2) }}</pre></details>
        </div>
        <button type="button" class="text-button" :disabled="busy" :aria-label="$t('移除预览引用')" @click="emit('preview-remove')"><CloseOutlined /></button>
      </div>
      <a-form-item name="text">
        <textarea
          :value="modelValue"
          :aria-label="$t('发送给 {p0} 的指令', { p0: agentLabel })"
          :disabled="!canSend"
          :placeholder="
            readOnlyReason
              ? $t('此会话为只读')
              : running
                ? $t('补充指令，调整当前执行方向…')
                : $t('输入指令，继续这个 session…')
          "
          rows="2"
          maxlength="60000"
          @input="emit('update:modelValue', $event.target.value)"
          @paste="paste"
          @keydown.enter="onEnter"
        />
      </a-form-item>
      <ul
        v-if="images.length"
        class="composer-image-list"
        :aria-label="$t('待发送图片')"
      >
        <li v-for="image in images" :key="image.localId" class="composer-image">
          <img :src="image.preview" :alt="image.name" />
          <button
            type="button"
            class="composer-image-remove"
            :aria-label="$t('移除图片 {p0}', { p0: image.name })"
            :title="$t('移除图片 {p0}', { p0: image.name })"
            :disabled="busy"
            @click="emit('images-remove', image.localId)"
          >
            <CloseOutlined aria-hidden="true" />
          </button>
          <span class="composer-image-name" :title="image.name">{{
            image.name
          }}</span>
          <span
            v-if="image.status === 'uploading'"
            class="composer-image-status"
            role="status"
            >{{ $t("正在上传…") }}</span
          >
          <span
            v-else-if="image.status === 'ready'"
            class="composer-image-status"
            >{{ $t("待发送") }}</span
          >
          <template v-else>
            <FeedbackMessage :message="image.error" type="error" />
            <button
              type="button"
              class="text-button composer-image-retry"
              :aria-label="$t('重试上传 {p0}', { p0: image.name })"
              :disabled="!canSend || !supportsImages"
              @click="emit('images-retry', image.localId)"
            >
              {{ $t("重试上传") }}
            </button>
          </template>
        </li>
      </ul>
      <FeedbackMessage :message="imagesError" type="error" />
      <p
        v-if="imagesUploading"
        class="composer-image-feedback muted"
        role="status"
      >
        {{ $t("图片上传完成后即可发送。") }}
      </p>
      <div class="composer-footer composer-toolbar">
        <div class="composer-permissions">
          <input
            ref="imageInput"
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            :aria-label="$t('选择会话图片')"
            :disabled="!canSend || !supportsImages"
            @change="chooseImages"
          />
          <button
            type="button"
            class="composer-add-images"
            :aria-label="$t('添加图片')"
            :title="$t('添加图片（PNG / JPEG / WebP，最多 20 张，每张 10 MiB）')"
            :disabled="!canSend || !supportsImages || images.length >= 20"
            @click="imageInput?.click()"
          >
            <PlusOutlined aria-hidden="true" />
          </button>
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
          <AgentModelControls
            compact
            :agent-label="agentLabel"
            :model="executionSettings.model"
            :reasoning-effort="executionSettings.reasoningEffort"
            :models="catalog.models.value"
            :loading="catalog.loading.value"
            :disabled="!canEditSettings || settingsBusy || !permissions.isAvailable(executionSettings.permissionMode)"
            @change="emit('settings-change', $event)"
          />
          <div class="actions composer-actions">
            <button
              v-if="canStop && (running || initializing)"
              type="button"
              class="stop composer-stop"
              :disabled="busy || !online"
              :aria-label="$t('■ 停止')"
              :title="$t('停止当前一轮')"
              @click="emit('stop')"
            >
              <StopOutlined aria-hidden="true" />
            </button>
            <button
              type="submit"
              class="primary composer-send"
              :disabled="!canSubmit"
              :aria-label="sendLabel"
              :title="sendLabel"
            >
              <ArrowUpOutlined aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </a-form>
    <FeedbackMessage :message="settingsError ? $t('执行偏好保存失败：{p0}', { p0: settingsError }) : ''" type="error" />
    <FeedbackMessage :message="catalog.error.value ? $t('模型列表加载失败：{p0}。当前选择会保留。', { p0: catalog.error.value }) : ''" type="error" />
    <div v-if="catalog.error.value"><button
        type="button"
        class="text-button"
        :disabled="catalog.loading.value"
        @click="catalog.refresh"
      >
        {{ $t("刷新模型列表") }}
      </button></div>
    <FeedbackMessage :message="permissions.error.value ? $t('权限选项加载失败：{p0}。{p1} {p2}', { p0: permissions.error.value, p1: running ? '当前轮仍可补充指令，启动下一轮前需要确认权限。' : '确认权限可用后才能发送。', p2: permissions.errorHint.value }) : ''" type="error" />
    <div v-if="permissions.error.value"><button
        type="button"
        class="text-button"
        :disabled="permissions.loading.value"
        @click="permissions.refresh"
      >
        {{ $t("刷新权限选项") }}
      </button></div>
    <p v-if="permissionUnavailable" role="alert" class="error composer-catalog-error">{{ running ? $t("下一轮权限模式不可用；当前轮仍可补充指令，请在启动下一轮前重新选择。") : $t("当前权限模式不可用，请选择可用的权限模式后发送。") }}</p>
    <div class="composer-hints">
      <p v-if="!settingsError" class="execution-settings-hint" role="status">
        {{
          settingsBusy
            ? $t("正在保存执行偏好…")
            : settingsPending
              ? $t("已保存，下一轮生效；补充当前轮指令仍使用本轮设置。")
              : $t("模型、思考和权限从下一轮生效。")
        }}
      </p>
      <div class="composer-note">{{ $t("Enter 发送 · Shift + Enter 换行 · Ctrl + V 粘贴图片") }}</div>
    </div>
  </section>
</template>

<style scoped>
.composer-wrap { padding: 18px max(22px, calc((100% - var(--conversation-width)) / 2)); margin-top: auto; border-top: 1px solid var(--line); background: var(--surface-hover); border-radius: 0 0 var(--radius-card) var(--radius-card); }
.composer { padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; box-shadow: none; background: var(--surface); }
.composer:focus-within { border-color: var(--focus); box-shadow: none; }
.composer textarea { min-height: 44px; height: 44px; max-height: 180px; resize: vertical; font-size: 14px; line-height: 1.6; }
.composer-footer { gap: 9px; margin-top: 4px; }
.composer-hints { gap: 4px 16px; margin-top: 6px; }
.composer-note, .execution-settings-hint { font-size: 12px; line-height: 1.6; }
.composer-send { border-radius: 6px; box-shadow: none; }
.composer-add-images { border-color: transparent; background: transparent; }
.composer-preview-reference { display: flex; align-items: start; gap: 12px; padding: 10px 12px; margin-bottom: 10px; background: var(--selected); border-radius: 6px; font-size: 12px; }
.composer-preview-reference > div { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.composer-preview-reference strong { font-weight: 500; }
.composer-preview-reference summary { cursor: pointer; min-height: 32px; color: var(--muted); }
.composer-preview-reference pre { max-height: 150px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
@media (max-width: 767px) {
  .composer-wrap { padding: 16px; }
  .composer textarea { min-height: 44px; }
  .composer-footer, .composer-tools { min-width: 0; flex-wrap: wrap; }
}
</style>
