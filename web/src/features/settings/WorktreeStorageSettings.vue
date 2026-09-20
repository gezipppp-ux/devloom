<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { FolderOpenOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import FormSection from "../../shared/components/FormSection.vue";
import ServerDirectoryPicker from "./ServerDirectoryPicker.vue";

const directoryPicker = ref();
const basePath = ref("");
const savedPath = ref(null);
const platform = ref("");
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref(false);
let disposed = false;
const dirty = computed(
  () => savedPath.value !== null && basePath.value !== savedPath.value,
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await appApi("/system/settings");
    if (disposed) return;
    basePath.value = result.worktreeBasePath;
    savedPath.value = result.worktreeBasePath;
    platform.value = result.platform;
  } catch (e) {
    if (!disposed) error.value = e.message;
  } finally {
    if (!disposed) loading.value = false;
  }
}

async function save() {
  if (loading.value || saving.value || !dirty.value) return;
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    const result = await appApi("/system/settings", {
      worktreeBasePath: basePath.value,
    });
    if (disposed) return;
    basePath.value = result.worktreeBasePath;
    savedPath.value = result.worktreeBasePath;
    saved.value = true;
  } catch (e) {
    if (!disposed) error.value = e.message;
  } finally {
    if (!disposed) saving.value = false;
  }
}

onMounted(load);
onUnmounted(() => {
  disposed = true;
});
</script>

<template>
  <FormSection
    title="Worktree 存储"
    description="统一设置各工作区新建 Worktree 的基础目录。"
  >
    <form @submit.prevent="save">
      <label for="worktree-base-path" class="storage-field-label"
        >Worktree 基础目录</label
      >
      <div class="directory-path-row">
        <input
          id="worktree-base-path"
          v-model="basePath"
          aria-label="Worktree 基础目录"
          :placeholder="
            platform === 'win32' ? 'D:\\wt' : '/srv/wt'
          "
          :disabled="loading || saving || savedPath === null"
          required
        />
        <button
          type="button"
          :disabled="loading || saving || savedPath === null"
          @click="directoryPicker.open(basePath)"
        >
          <FolderOpenOutlined aria-hidden="true" /> 浏览服务器目录
        </button>
      </div>
      <p class="field-hint">
        填写运行服务的主机上的绝对路径，也可浏览并选择该主机已有目录。输入尚不存在的目录时，保存会自动创建；服务用户须有写入权限。
      </p>
      <p class="field-hint">
        建议使用较短路径{{ platform === "win32" ? "，例如 D:\\wt" : "，例如 /srv/wt" }}，减少项目内深层文件路径过长的风险。
      </p>
      <div class="worktree-path-example">
        <strong>基础目录 + 用户名 + 工作区目录 = 工作区 Worktree 完整路径</strong>
        <code>{{
          platform === "win32"
            ? "D:\\wt + alice + project-a → D:\\wt\\alice\\project-a"
            : "/srv/wt + alice + project-a → /srv/wt/alice/project-a"
        }}</code>
        <p>
          示例用户名为 alice。系统按账号区分目录，每个工作区设置自己的相对目录；每个任务在其下仅创建一层短目录，例如 ce-shi-a1b2c3d4e5f6。
        </p>
      </div>
      <p class="field-hint">
        修改后对所有工作区的新任务生效；已有任务继续使用记录的路径，不会移动目录。
      </p>
      <p v-if="loading" class="muted" role="status">正在加载基础目录…</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="saved && !dirty" class="notice" role="status">
        基础目录已保存，后续新任务将使用新的路径配置。
      </p>
      <div class="actions">
        <button
          v-if="savedPath === null && !loading"
          type="button"
          @click="load"
        >
          重新加载
        </button>
        <button
          class="primary"
          type="submit"
          :disabled="loading || saving || !dirty || !basePath.trim()"
        >
          {{ saving ? "正在保存…" : "保存基础目录" }}
        </button>
      </div>
    </form>
    <ServerDirectoryPicker
      ref="directoryPicker"
      @select="(path) => (basePath = path)"
    />
  </FormSection>
</template>
