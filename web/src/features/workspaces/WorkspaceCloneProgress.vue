<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { ref } from "vue";
import { CloudDownloadOutlined } from "@antdv-next/icons";
const props = defineProps({ clones: { type: Array, default: () => [] }, error: { type: String, default: "" }, dismiss: { type: Function, required: true } });
const emit = defineEmits(["open-workspace"]);
const dialog = ref(), failure = ref("");
let returnFocus;
function open() { returnFocus = globalThis.document.activeElement; dialog.value.showModal(); }
function close() { dialog.value.close(); returnFocus?.focus(); }
async function dismissClone(id) {
  failure.value = "";
  try { await props.dismiss(id); } catch (error) { failure.value = error.message; }
}
function openWorkspace(workspace) { close(); emit("open-workspace", workspace.id); }
const labels = { preparing: "准备克隆", connecting: "连接仓库，等待远端响应", counting: "统计对象", compressing: "压缩对象", receiving: "下载仓库对象", resolving: "整理对象差异", checkout: "检出项目文件", publishing: "校验项目并创建工作区" };
defineExpose({ open });
</script>

<template>
  <button type="button" class="clone-progress-trigger" :aria-label="$t(&quot;克隆任务{p0}&quot;, { p0: clones.length ? `（${clones.length}）` : '' })" @click="open"><CloudDownloadOutlined aria-hidden="true" /><span>{{ $t("克隆任务") }}</span><small v-if="clones.length" class="clone-count" aria-hidden="true">{{ clones.length }}</small></button>
  <Teleport to="body">
    <dialog ref="dialog" class="workspace-dialog clone-progress-dialog" :aria-label="$t(&quot;工作区克隆进度&quot;)" @cancel.prevent="close">
      <div class="workspace-dialog-heading"><h2>{{ $t("工作区克隆进度") }}</h2><button type="button" :aria-label="$t(&quot;关闭克隆进度&quot;)" @click="close">×</button></div>
      <p class="field-hint">{{ $t("任务受理后在服务器后台执行。关闭此窗口、刷新或关闭浏览器不会中止克隆；再次登录可从「克隆任务」查看进度。") }}</p>
      <p class="field-hint">{{ $t("大仓库可能需要较长时间，各阶段进度单独计算。服务停止或重启会中断克隆，不会自动重试。") }}</p>
      <FeedbackMessage :message="error || failure" type="error" />
      <p v-if="!clones.length" class="muted">{{ $t("暂无克隆任务。") }}</p>
      <section v-for="clone in clones" :key="clone.id" class="clone-progress-item" :aria-label="$t(&quot;克隆任务：{p0}&quot;, { p0: clone.name })">
        <h3>{{ clone.name }}</h3>
        <template v-if="clone.status === 'running'">
          <p role="status">{{ labels[clone.progress.stage] || $t("正在克隆") }}<span v-if="clone.progress.percent !== null"> · {{ clone.progress.percent }}%</span></p>
          <progress :value="clone.progress.percent ?? undefined" max="100" :aria-label="$t(&quot;{p0} 当前阶段进度&quot;, { p0: clone.name })"></progress>
          <p class="field-hint">{{ $t("服务器正在处理，请耐心等待。长时间无进度不一定表示失败。") }}</p>
        </template>
        <template v-else>
          <p :class="clone.status === 'completed' ? 'success' : 'error'" role="status">{{ clone.status === 'completed' ? $t("克隆完成，工作区已创建。") : clone.error }}</p>
          <div class="actions">
            <button v-if="clone.workspace" type="button" class="primary" @click="openWorkspace(clone.workspace)">{{ $t("打开工作区") }}</button>
            <button type="button" @click="dismissClone(clone.id)">{{ $t("移除记录") }}</button>
          </div>
        </template>
      </section>
      <div class="actions"><button type="button" @click="close">{{ clones.some(clone => clone.status === 'running') ? $t("关闭窗口，后台继续") : $t("关闭") }}</button></div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.clone-progress-dialog { width: min(680px, calc(100vw - 32px)); }
.clone-progress-item { padding: 22px 0; margin: 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; }
.clone-progress-item h3 { font-size: 14px; font-weight: 600; line-height: 1.6; }
.clone-progress-item progress { width: 100%; height: 6px; accent-color: var(--highlight); }
.clone-progress-item .actions { flex-wrap: wrap; gap: 10px; }
@media (max-width: 767px) { .clone-progress-item { padding-block: 18px; } }
</style>
