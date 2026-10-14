<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { FolderOpenOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { translate } from "../../shared/i18n/index.js";
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
const directoryPreview = computed(() => {
  const separator = platform.value === "win32" ? "\\" : "/";
  const base = memberStorageRoot.value || (platform.value === "win32" ? "D:\\wt" : "/srv/wt");
  const memberRoot = [base.replace(/[\\/]+$/, ""), "projects", translate("仓库目录名"), "members", translate("登录用户名")].join(separator);
  return [
    `${translate("成员项目仓库")}\n${memberRoot}${separator}${translate("repository-<准备修订号>")}`,
    `${translate("任务 Worktree")}\n${memberRoot}${separator}worktree${separator}${translate("<任务目录>")}`,
  ].join("\n\n");
});
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
  <section class="member-storage-settings" :aria-label="$t('成员项目与任务目录')">
    <header class="ui-settings-heading"><div><h2>{{ $t("成员目录") }}</h2><p>{{ $t("统一设置成员项目克隆目录和任务 Worktree 的共同基础路径。") }}</p></div></header>
    <form class="storage-settings-form" @submit.prevent="save">
      <section class="storage-form-section">
      <label for="member-storage-root" class="storage-field-label"
        >{{ $t("成员目录基础路径") }}</label
      >
      <div class="directory-path-row">
        <input
          id="member-storage-root"
          v-model="memberStorageRoot"
          :aria-label="$t('成员目录基础路径')"
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
      </section>
      <section class="storage-form-section storage-preview-section"><h3>{{ $t("目录结构预览") }}</h3><pre class="storage-directory-preview"><code>{{ directoryPreview }}</code></pre>
      <p class="field-hint">{{ $t("仓库保存在 repository-<准备修订号>，任务保存在 worktree/<任务目录>。重命名不会搬移目录。") }}</p>
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
      </section>
      <footer class="storage-form-footer">
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
      </footer>
    </form>
    <ServerDirectoryPicker
      ref="directoryPicker"
      @select="(path) => (memberStorageRoot = path)"
    />
  </section>
</template>
<style scoped>
.member-storage-settings { max-width: 1160px; min-width: 0; }
.storage-settings-form { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; }
.storage-form-section { padding: 28px; }
.storage-form-section + .storage-form-section { border-top: 1px solid var(--line); }
.storage-preview-section h3 { margin: 0 0 20px; font-size: 18px; }
.storage-directory-preview { margin: 0 0 16px; padding: 20px; background: var(--soft); border-radius: var(--radius-control); font: 12px/1.8 var(--font-code); white-space: pre; overflow: auto; }
.storage-directory-preview code { padding: 0; background: transparent; }
.storage-form-footer { border-top: 1px solid var(--line); padding: 20px 28px; }
.storage-form-footer .actions { justify-content: flex-end; }
@media (max-width: 767px) { .storage-form-section, .storage-form-footer { padding: 20px; } }
</style>
