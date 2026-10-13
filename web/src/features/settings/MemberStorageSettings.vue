<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { FolderOpenOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import FormSection from "../../shared/components/FormSection.vue";
import ServerDirectoryPicker from "./ServerDirectoryPicker.vue";

const directoryPicker = ref();
const memberStorageRoot = ref("");
const savedStorageRoot = ref(null);
const platform = ref("");
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref(false);
const git = ref(null);
let disposed = false;
const dirty = computed(
  () =>
    savedStorageRoot.value !== null &&
    memberStorageRoot.value !== savedStorageRoot.value,
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await appApi("/system/settings");
    if (disposed) return;
    memberStorageRoot.value = result.memberStorageRoot;
    savedStorageRoot.value = result.memberStorageRoot;
    platform.value = result.platform;
    git.value = result.git || null;
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
      memberStorageRoot: memberStorageRoot.value,
    });
    if (disposed) return;
    memberStorageRoot.value = result.memberStorageRoot;
    savedStorageRoot.value = result.memberStorageRoot;
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
    title="成员项目与任务目录"
    description="统一设置成员项目克隆目录和任务 Worktree 的共同基础路径。"
  >
    <form @submit.prevent="save">
      <label for="member-storage-root" class="storage-field-label"
        >成员目录基础路径</label
      >
      <div class="directory-path-row">
        <input
          id="member-storage-root"
          v-model="memberStorageRoot"
          aria-label="成员目录基础路径"
          :placeholder="platform === 'win32' ? 'D:\\wt' : '/srv/wt'"
          :disabled="loading || saving || savedStorageRoot === null"
          required
        />
        <button
          type="button"
          :disabled="loading || saving || savedStorageRoot === null"
          @click="directoryPicker.open(memberStorageRoot)"
        >
          <FolderOpenOutlined aria-hidden="true" /> 浏览服务器目录
        </button>
      </div>
      <p class="field-hint">
        填写运行服务主机上的绝对路径，也可浏览并选择已有目录。成员项目和任务按稳定项目 ID、用户 ID 分隔。
      </p>
      <p class="field-hint">
        建议使用较短路径{{
          platform === "win32" ? "，例如 D:\\wt" : "，例如 /srv/wt"
        }}，减少项目内深层文件路径过长的风险。
      </p>
      <div class="storage-path-example">
        <strong
          >基础目录 / projects / 项目 ID / members / 用户 ID</strong
        >
        <code>{{
          platform === "win32"
            ? "D:\\wt\\projects\\<项目ID>\\members\\<用户ID>"
            : "/srv/wt/projects/<项目ID>/members/<用户ID>"
        }}</code>
        <p>
          仓库保存在 repository-&lt;准备修订号&gt;，任务保存在 worktree/&lt;任务目录&gt;。重命名不会搬移目录。
        </p>
      </div>
      <p class="field-hint" :class="{ error: git && !git.installed }">
        Git 环境：{{
          git
            ? git.installed
              ? `已安装（${git.version}）`
              : "未检测到 Git，请安装后再创建工作区。"
            : "正在检测…"
        }}
      </p>
      <p class="field-hint">
        修改后对所有工作区的新任务生效；已有任务继续使用记录的路径，不会移动目录。
      </p>
      <p v-if="loading" class="muted" role="status">正在加载基础目录…</p>
      <FeedbackMessage :message="error" type="error" />
      <FeedbackMessage :message="saved ? '基础目录已保存，后续新任务将使用新的路径配置。' : ''" type="success" />
      <div class="actions">
        <button
          v-if="savedStorageRoot === null && !loading"
          type="button"
          @click="load"
        >
          重新加载
        </button>
        <button
          class="primary"
          type="submit"
          :disabled="loading || saving || !dirty || !memberStorageRoot.trim()"
        >
          {{ saving ? "正在保存…" : "保存基础目录" }}
        </button>
      </div>
    </form>
    <ServerDirectoryPicker
      ref="directoryPicker"
      @select="(path) => (memberStorageRoot = path)"
    />
  </FormSection>
</template>
