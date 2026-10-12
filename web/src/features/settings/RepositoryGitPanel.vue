<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { ReloadOutlined, CloudDownloadOutlined } from "@antdv-next/icons";
import { api } from "../../shared/api/api.js";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({ canOperate: { type: Boolean, default: true } });

const repository = ref(null);
const selectedRemote = ref("");
const loading = ref(false);
const operation = ref("");
const error = ref("");
const notice = ref("");
let revision = 0;

async function refresh() {
  const current = ++revision;
  loading.value = true;
  error.value = "";
  try {
    const result = await api("/repository/git");
    if (current !== revision) return;
    repository.value = result;
    if (!result.remotes?.some((remote) => remote.name === selectedRemote.value))
      selectedRemote.value = result.remote || result.remotes?.[0]?.name || "";
  } catch (e) {
    if (current === revision) error.value = e.message;
  } finally {
    if (current === revision) loading.value = false;
  }
}

async function execute(action) {
  if (operation.value || loading.value || !props.canOperate) return;
  const current = ++revision;
  operation.value = action;
  error.value = "";
  notice.value = "";
  try {
    await api(
      `/repository/git/${action}`,
      action === "fetch" ? { remote: selectedRemote.value } : {},
    );
    if (current !== revision) return;
    notice.value =
      action === "fetch"
        ? "已获取远端更新。现有任务代码保持不变。"
        : "已更新本地基准分支，新任务将使用更新后的代码。";
    await refresh();
  } catch (e) {
    if (current === revision) error.value = e.message;
  } finally {
    // A refresh owns a newer revision, but this component still owns the action.
    if (current === revision || current + 1 === revision) operation.value = "";
  }
}

function fetchedLabel(value) {
  if (!value) return "尚未通过此工作台获取";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
onMounted(refresh);
onUnmounted(() => {
  revision++;
});
</script>

<template>
  <section class="start-panel repository-git-panel" aria-label="代码仓库">
    <header class="page-heading">
      <div class="eyebrow">REPOSITORY</div>
      <h1>代码仓库</h1>
      <p>
        管理当前工作区的远端更新与新任务基准。已有 Worktree
        的代码同步、合并和冲突处理可直接交给会话中的 Codex。
      </p>
    </header>
    <FormSection
      title="仓库状态"
      description="显示服务器上的项目仓库与配置的基准引用。"
    >
      <template #action>
        <button
          type="button"
          :disabled="loading || Boolean(operation)"
          @click="refresh"
        >
          <ReloadOutlined aria-hidden="true" /> 刷新仓库状态
        </button>
      </template>
      <p v-if="loading && !repository" class="muted" role="status">
        正在读取仓库状态…
      </p>
      <dl v-if="repository" class="git-facts">
        <dt>项目仓库</dt>
        <dd>
          <code>{{ repository.repository }}</code>
        </dd>
        <dt>新任务基准</dt>
        <dd>
          <code>{{ repository.baseRef }}</code>
        </dd>
        <dt>本地基准分支</dt>
        <dd>{{ repository.branch || "当前引用不是可更新的本地分支" }}</dd>
        <dt>跟踪远端</dt>
        <dd>{{ repository.upstream || "尚未设置上游分支" }}</dd>
        <dt>最近获取</dt>
        <dd>{{ fetchedLabel(repository.lastFetchedAt) }}</dd>
      </dl>
      <p v-if="error" class="error" role="alert">
        {{ repository ? "仓库状态可能已过期。" : "" }}{{ error }}
      </p>
    </FormSection>
    <FormSection
      v-if="repository && canOperate"
      title="获取最新代码"
      description="先获取远端分支信息，再按需更新本地基准分支。"
    >
      <label class="git-field-label" for="repository-remote"
        >要获取更新的远端</label
      >
      <select
        id="repository-remote"
        v-model="selectedRemote"
        aria-label="远端仓库"
        :disabled="loading || Boolean(operation) || !repository.remotes?.length"
      >
        <option v-if="!repository.remotes?.length" value="">
          此仓库未配置远端
        </option>
        <option
          v-for="remote in repository.remotes"
          :key="remote.name"
          :value="remote.name"
        >
          {{ remote.name }}
        </option>
      </select>
      <p class="git-hint">
        「获取远端更新」只更新远程跟踪引用，现有任务文件不变。待推送和落后远端的数量以最近获取结果为准。
      </p>
      <div class="git-repository-actions">
        <button
          type="button"
          class="primary"
          :disabled="loading || Boolean(operation) || !selectedRemote"
          @click="execute('fetch')"
        >
          <CloudDownloadOutlined aria-hidden="true" />{{
            operation === "fetch" ? "正在获取…" : "获取远端更新"
          }}
        </button>
        <button
          type="button"
          :disabled="
            loading ||
            Boolean(operation) ||
            !repository.canUpdate ||
            Boolean(error)
          "
          @click="execute('update')"
        >
          {{ operation === "update" ? "正在更新…" : "更新基准分支" }}
        </button>
      </div>
      <p class="git-hint">
        「更新基准分支」会获取上游最新提交，并仅以快进方式更新本地基准分支。分支分叉或存在未提交修改时停止，由
        Codex 协助处理。
      </p>
      <p
        v-if="!repository.canUpdate && repository.updateReason"
        class="git-feedback warning"
      >
        {{ repository.updateReason }}
      </p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    </FormSection>
  </section>
</template>
