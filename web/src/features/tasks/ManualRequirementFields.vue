<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
/* global FileReader */
import { onUnmounted, ref } from "vue";
import { uploadManualImage } from "../../shared/api/api.js";
const props = defineProps({
  form: { type: Object, required: true },
  disabled: Boolean,
});
const emit = defineEmits(["uploading", "change"]);
const uploading = ref(false);
const error = ref("");
const previews = ref([]);
let disposed = false;
onUnmounted(() => {
  disposed = true;
});
async function upload(event) {
  const files = [...event.target.files];
  event.target.value = "";
  error.value = "";
  if (previews.value.length + files.length > 20) {
    error.value = "最多上传 20 张图片。";
    return;
  }
  uploading.value = true;
  emit("uploading", true);
  try {
    for (const file of files) {
      // A workspace switch must not send queued files to the next workspace.
      if (disposed) return;
      if (file.size > 10 * 1024 * 1024)
        throw new Error(`${file.name} 超过 10 MiB。`);
      const result = await uploadManualImage(file);
      if (disposed) return;
      const preview = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("无法读取图片预览。"));
        reader.readAsDataURL(file);
      });
      if (disposed) return;
      previews.value.push({ id: result.id, name: file.name, preview });
      emit("change", { images: [...props.form.images, result.id] });
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
    emit("uploading", false);
  }
}
function remove(index) {
  previews.value.splice(index, 1);
  emit("change", {
    images: props.form.images.filter((_, offset) => offset !== index),
  });
}
</script>

<template>
  <div class="manual-fields">
    <a-form-item label="需求标题" name="title">
      <input
        :value="form.title"
        @input="emit('change', { title: $event.target.value })"
        aria-label="需求标题"
        maxlength="200"
        :disabled="disabled"
        required
        placeholder="例如：新增登录入口"
      />
    </a-form-item>
    <a-form-item label="需求内容" name="content">
      <textarea
        :value="form.content"
        @input="emit('change', { content: $event.target.value })"
        aria-label="需求内容"
        rows="5"
        maxlength="60000"
        :disabled="disabled"
        placeholder="描述目标、交互和验收标准，支持 Markdown；也可仅上传图片。"
      />
    </a-form-item>
    <a-form-item label="需求图片" name="images">
      <input
        type="file"
        aria-label="需求图片"
        accept="image/png,image/jpeg,image/webp"
        multiple
        :disabled="disabled || uploading"
        @change="upload"
      />
      <p class="field-hint">PNG、JPEG、WebP，每张最多 10 MiB，最多 20 张。</p>
      <p v-if="uploading" role="status">正在上传图片…</p>
      <FeedbackMessage :message="error" type="error" />
      <div class="manual-images">
        <figure v-for="(item, index) in previews" :key="item.id">
          <img :src="item.preview" :alt="item.name" />
          <figcaption>{{ index + 1 }}. {{ item.name }}</figcaption>
          <button
            type="button"
            :disabled="disabled || uploading"
            :aria-label="`移除图片 ${index + 1}`"
            @click="remove(index)"
          >
            移除
          </button>
        </figure>
      </div>
    </a-form-item>
    <a-form-item label="Worktree 目录前缀（可选）" name="worktreeName">
      <input
        :value="form.worktreeName"
        @input="emit('change', { worktreeName: $event.target.value })"
        aria-label="Worktree 目录前缀（可选）"
        aria-describedby="worktree-prefix-hint"
        maxlength="16"
        pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,15}"
        :disabled="disabled"
        placeholder="例如 login-entry；留空按标题自动生成"
      />
      <p id="worktree-prefix-hint" class="field-hint">
        最多 16 位英文字母、数字、短横线或下划线，以字母或数字开头。留空时按标题生成短前缀，中文转拼音；系统自动追加 12 位短标识，例如 login-entry-a1b2c3d4e5f6。
      </p>
    </a-form-item>
  </div>
</template>

<style scoped>
.manual-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}
figure {
  margin: 0;
  min-width: 0;
}
img {
  width: 100%;
  height: 110px;
  object-fit: contain;
  border: 1px solid var(--line);
  border-radius: 8px;
}
figcaption {
  overflow-wrap: anywhere;
  font-size: 12px;
  margin: 6px 0;
}
textarea {
  width: 100%;
  resize: vertical;
}
</style>
