<script setup>
import { computed, ref } from "vue";
import {
  ArrowUpOutlined,
  CloseOutlined,
  PlusOutlined,
  StopOutlined,
} from "@antdv-next/icons";
import CodexModelControls from "../../shared/components/CodexModelControls.vue";
import PermissionSelect from "../../shared/components/PermissionSelect.vue";
import { useModelCatalog } from "../../shared/api/use-model-catalog.js";
import { usePermissionModes } from "../../shared/api/use-permission-modes.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  images: { type: Array, default: () => [] },
  imagesUploading: Boolean,
  imagesBlocked: Boolean,
  imagesError: { type: String, default: "" },
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
  "images-add",
  "images-remove",
  "images-retry",
  "stop",
  "settings-change",
]);
const form = computed(() => ({ text: props.modelValue }));
const formRef = ref();
const imageInput = ref();
const canSubmit = computed(
  () =>
    props.canSend &&
    !props.imagesBlocked &&
    Boolean(props.modelValue.trim() || props.images.length),
);
const sendLabel = computed(() => (props.running ? "补充指令 ↑" : "发送 ↑"));
const catalog = useModelCatalog();
const permissions = usePermissionModes();

function paste(event) {
  if (!props.canSend) return;
  const files = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (files.length) emit("images-add", files);
  // Preserve native textarea pasting, including text accompanying an image.
}
function chooseImages(event) {
  if (event.target.files?.length) emit("images-add", [...event.target.files]);
  event.target.value = "";
}
function submit() {
  if (canSubmit.value) formRef.value?.submit();
}
function send() {
  if (canSubmit.value) emit("send");
}
</script>

<template>
  <section class="composer-wrap session-composer" aria-label="会话输入区">
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <a-form
      ref="formRef"
      class="composer"
      :model="form"
      @finish="send"
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
          @paste="paste"
          @keydown.ctrl.enter.prevent="submit"
        />
      </a-form-item>
      <ul
        v-if="images.length"
        class="composer-image-list"
        aria-label="待发送图片"
      >
        <li v-for="image in images" :key="image.localId" class="composer-image">
          <img :src="image.preview" :alt="image.name" />
          <button
            type="button"
            class="composer-image-remove"
            :aria-label="`移除图片 ${image.name}`"
            :title="`移除图片 ${image.name}`"
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
            >正在上传…</span
          >
          <span
            v-else-if="image.status === 'ready'"
            class="composer-image-status"
            >待发送</span
          >
          <template v-else>
            <p class="composer-image-error" role="alert">{{ image.error }}</p>
            <button
              type="button"
              class="text-button composer-image-retry"
              :aria-label="`重试上传 ${image.name}`"
              :disabled="!canSend"
              @click="emit('images-retry', image.localId)"
            >
              重试上传
            </button>
          </template>
        </li>
      </ul>
      <p v-if="imagesError" class="error composer-image-feedback" role="alert">
        {{ imagesError }}
      </p>
      <p
        v-if="imagesUploading"
        class="composer-image-feedback muted"
        role="status"
      >
        图片上传完成后即可发送。
      </p>
      <div class="composer-footer composer-toolbar">
        <div class="composer-permissions">
          <input
            ref="imageInput"
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            aria-label="选择会话图片"
            :disabled="!canSend"
            @change="chooseImages"
          />
          <button
            type="button"
            class="composer-add-images"
            aria-label="添加图片"
            title="添加图片（PNG / JPEG / WebP，最多 20 张，每张 10 MiB）"
            :disabled="!canSend || images.length >= 20"
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
    <div class="composer-note">Ctrl + V 粘贴图片 · Ctrl + Enter 发送</div>
  </section>
</template>
