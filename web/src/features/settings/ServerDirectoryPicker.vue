<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { nextTick, onUnmounted, ref } from "vue";
import { ArrowUpOutlined, FolderOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";

const emit = defineEmits(["select"]);
const dialog = ref();
const pathInput = ref();
const draftPath = ref("");
const listing = ref(null);
const roots = ref([]);
const loading = ref(false);
const error = ref("");
let revision = 0;

async function browse(path, append = false) {
  const current = ++revision;
  loading.value = true;
  error.value = "";
  if (!append) listing.value = null;
  const params = new URLSearchParams({
    offset: append ? listing.value.directories.length : 0,
    limit: 100,
  });
  if (path?.trim()) params.set("path", path.trim());
  try {
    const result = await appApi(`/system/directories?${params}`);
    if (current !== revision) return;
    roots.value = result.roots || [];
    listing.value = append
      ? {
          ...result,
          directories: [...listing.value.directories, ...result.directories],
        }
      : result;
    draftPath.value = result.path;
  } catch (e) {
    if (current === revision) error.value = e.message;
  } finally {
    if (current === revision) loading.value = false;
  }
}

async function open(path) {
  draftPath.value = path || "";
  listing.value = null;
  dialog.value.showModal();
  await nextTick();
  pathInput.value.focus();
  void browse(path);
}
function close() {
  revision++;
  loading.value = false;
  dialog.value.close();
}
function select() {
  if (!listing.value || loading.value) return;
  emit("select", listing.value.path);
  close();
}
onUnmounted(() => {
  revision++;
});
defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="workspace-dialog directory-picker"
      aria-label="选择服务器目录"
      @cancel.prevent="close"
    >
      <div class="workspace-dialog-heading">
        <h2>选择服务器目录</h2>
        <button
          type="button"
          class="workspace-menu"
          aria-label="关闭目录选择"
          @click="close"
        >
          ×
        </button>
      </div>
      <p class="muted">
        浏览运行服务的主机目录。选择后返回表单，点击「保存基础目录」生效。
      </p>
      <form @submit.prevent="browse(draftPath)">
        <label for="directory-browse-path">浏览目录路径</label>
        <div class="directory-path-row">
          <input
            id="directory-browse-path"
            ref="pathInput"
            v-model="draftPath"
            aria-label="浏览目录路径"
            placeholder="输入服务器绝对路径"
          />
          <button type="submit" :disabled="loading">打开目录</button>
        </div>
      </form>
      <nav class="directory-roots" aria-label="服务器根目录">
        <button type="button" :disabled="loading" @click="browse()">
          默认目录
        </button>
        <button
          v-for="root in roots"
          :key="root.path"
          type="button"
          :disabled="loading"
          @click="browse(root.path)"
        >
          {{ root.name }}
        </button>
      </nav>
      <div v-if="listing" class="directory-current">
        <span>当前目录</span><code>{{ listing.path }}</code>
        <button
          type="button"
          :disabled="loading || !listing.parentPath"
          @click="browse(listing.parentPath)"
        >
          <ArrowUpOutlined aria-hidden="true" /> 上一级
        </button>
      </div>
      <p v-if="loading" class="muted" role="status">正在读取目录…</p>
      <FeedbackMessage :message="error" type="error" />
      <ul v-if="listing" class="directory-list" aria-label="子目录">
        <li v-for="entry in listing.directories" :key="entry.path">
          <button
            type="button"
            :aria-label="`打开目录：${entry.name}`"
            :disabled="loading"
            @click="browse(entry.path)"
          >
            <FolderOutlined aria-hidden="true" /><span>{{ entry.name }}</span>
          </button>
        </li>
        <li
          v-if="!listing.directories.length && !loading"
          class="directory-empty"
        >
          此目录下没有可浏览的子目录，可直接选择当前目录。
        </li>
      </ul>
      <button
        v-if="listing?.hasMore"
        type="button"
        class="directory-load-more"
        :disabled="loading"
        @click="browse(listing.path, true)"
      >
        加载更多目录
      </button>
      <div class="actions">
        <button type="button" @click="close">取消</button>
        <button
          type="button"
          class="primary"
          :disabled="loading || !listing || Boolean(error)"
          @click="select"
        >
          选择此目录
        </button>
      </div>
    </dialog>
  </Teleport>
</template>
