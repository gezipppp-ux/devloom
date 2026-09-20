import { onUnmounted, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";

export function useWorkspaceClones({ enabled, onCompleted }) {
  const clones = ref([]), error = ref("");
  let alive = true, timer, refreshing = false, revision = 0;
  const completed = new Set();
  function accept(clone) {
    if (clone.status === "completed" && !completed.has(clone.id)) {
      completed.add(clone.id);
      onCompleted(clone);
    }
  }
  async function refresh() {
    if (!alive || !enabled.value || refreshing) return;
    refreshing = true;
    const expected = revision;
    try {
      const result = await appApi("/workspace-clones");
      if (!alive || expected !== revision) return;
      clones.value = result.clones;
      for (const clone of result.clones) accept(clone);
      error.value = "";
    } catch (failure) {
      if (alive && expected === revision) error.value = "进度暂时无法更新，正在重试；后台状态待连接恢复后确认。" + failure.message;
    } finally {
      refreshing = false;
      if (alive && enabled.value) timer = setTimeout(refresh, clones.value.some(clone => clone.status === "running") ? 1500 : 5000);
    }
  }
  async function start(input) {
    const result = await appApi("/workspaces", input);
    if (!alive) return null;
    revision++;
    clones.value = [result.clone, ...clones.value.filter(clone => clone.id !== result.clone.id)];
    accept(result.clone);
    return result.clone;
  }
  async function dismiss(id) {
    await appApi(`/workspace-clones/${id}/dismiss`, {});
    if (alive) { revision++; clones.value = clones.value.filter(clone => clone.id !== id); }
  }
  watch(enabled, value => {
    revision++;
    clearTimeout(timer);
    if (value) void refresh();
  }, { immediate: true });
  onUnmounted(() => { alive = false; clearTimeout(timer); });
  return { clones, error, start, dismiss };
}
