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
    :title="$t(&quot;成员项目与任务目录&quot;)"
    :description="$t(&quot;统一设置成员项目克隆目录和任务 Worktree 的共同基础路径。&quot;)"
  >
    <form @submit.prevent="save">
      <label for="member-storage-root" class="storage-field-label"
        >{{ $t("成员目录基础路径") }}</label
      >
      <div class="directory-path-row">
        <input
          id="member-storage-root"
          v-model="memberStorageRoot"
          :aria-label="$t(&quot;成员目录基础路径&quot;)"
          :placeholder="platform === 'win32' ? 'D:\\wt' : '/srv/wt'"
          :disabled="loading || saving || savedStorageRoot === null"
          required
        />
        <button
          type="button"
          :disabled="loading || saving || savedStorageRoot === null"
          @click="directoryPicker.open(memberStorageRoot)"
        >
          <FolderOpenOutlined aria-hidden="true" /> {{ $t("浏览服务器目录") }}
        </button>
      </div>
      <p class="field-hint">
        {{ $t("填写运行服务主机上的绝对路径，也可浏览并选择已有目录。成员项目和任务按 Git 仓库名、登录用户名分隔，同名仓库的后创建项目自动加短后缀。") }}
      </p>
      <p class="field-hint">
        {{ $t("建议使用较短路径") }}{{
          platform === "win32" ? $t("，例如 D:\\wt") : $t("，例如 /srv/wt")
        }}{{ $t("，减少项目内深层文件路径过长的风险。") }}
      </p>
      <div class="storage-path-example">
        <strong
          >{{ $t("基础目录 / projects / 仓库目录名 / members / 登录用户名") }}</strong
        >
        <code>{{
          platform === "win32"
            ? "D:\\wt\\projects\\web-coding\\members\\admin"
            : "/srv/wt/projects/web-coding/members/admin"
        }}</code>
        <p>
          仓库保存在 repository-&lt;准备修订号&gt;，任务保存在 worktree/&lt;任务目录&gt;。重命名不会搬移目录。
        </p>
      </div>
      <p class="field-hint" :class="{ error: git && !git.installed }">
        {{ $t("Git 环境：") }}{{
          git
            ? git.installed
              ? $t("已安装（{p0}）", { p0: git.version })
              : $t("未检测到 Git，请安装后再创建工作区。")
            : $t("正在检测…")
        }}
      </p>
      <p class="field-hint">
        {{ $t("修改后对所有工作区的新任务生效；已有任务继续使用记录的路径，不会移动目录。") }}
      </p>
      <p v-if="loading" class="muted" role="status">{{ $t("正在加载基础目录…") }}</p>
      <FeedbackMessage :message="error" type="error" />
      <FeedbackMessage :message="saved ? '基础目录已保存，后续新任务将使用新的路径配置。' : ''" type="success" />
      <div class="actions">
        <button
          v-if="savedStorageRoot === null && !loading"
          type="button"
          @click="load"
        >
          {{ $t("重新加载") }}
        </button>
        <button
          class="primary"
          type="submit"
          :disabled="loading || saving || !dirty || !memberStorageRoot.trim()"
        >
          {{ saving ? $t("正在保存…") : $t("保存基础目录") }}
        </button>
      </div>
    </form>
    <ServerDirectoryPicker
      ref="directoryPicker"
      @select="(path) => (memberStorageRoot = path)"
    />
  </FormSection>
</template>
