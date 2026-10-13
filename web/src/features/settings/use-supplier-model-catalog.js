import { onMounted, onUnmounted, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";

export function useSupplierModelCatalog(form, request = appApi) {
  const models = ref(null), loading = ref(true), error = ref("");
  let generation = 0, disposed = false;
  const identities = new WeakMap();
  const match = id => models.value?.find(entry => entry.model === id);
  function clearAutomatic(entry) { entry.reasoningEfforts = []; entry.defaultReasoningEffort = ""; delete entry.reasoningSource; }
  function apply(entry, force = false) {
    if (!models.value) return;
    const automatic = entry.reasoningSource === "codex" ||
      (!entry.reasoningSource && !entry.reasoningEfforts.length && !entry.defaultReasoningEffort);
    if (!automatic && !force) return;
    const native = match(entry.model);
    if (!native) return;
    entry.reasoningEfforts = [...native.reasoningEfforts];
    entry.defaultReasoningEffort = native.reasoningEfforts.includes(native.defaultReasoningEffort) ? native.defaultReasoningEffort : "";
    entry.reasoningSource = "codex";
    if (!entry.label || entry.label === entry.model) entry.label = native.label || entry.model;
  }
  async function refresh() {
    const expected = ++generation; loading.value = true; error.value = "";
    try {
      const result = await request(`/system/agent-suppliers/catalog?agentType=${encodeURIComponent(form.value.agentType)}`);
      if (disposed || expected !== generation) return;
      if (!Array.isArray(result?.models) || result.models.some(entry => typeof entry?.model !== "string" || !Array.isArray(entry.reasoningEfforts)))
        throw new Error("Codex 内置模型目录格式无效。");
      models.value = result.models;
    } catch (e) { if (!disposed && expected === generation) { models.value = null; error.value = e.message; } }
    finally { if (!disposed && expected === generation) loading.value = false; }
  }
  watch(() => [models.value, ...form.value.models.map(entry => entry.model)], () => {
    for (const entry of form.value.models) {
      if (identities.has(entry) && identities.get(entry) !== entry.model && entry.reasoningSource === "codex") clearAutomatic(entry);
      identities.set(entry, entry.model); apply(entry);
    }
  }, { immediate: true });
  function status(id) { return loading.value ? "识别中…" : !models.value ? "目录未加载" : match(id) ? "Codex 内置" : "未匹配内置目录"; }
  function custom(entry) { entry.reasoningSource = "custom"; }
  onMounted(refresh);
  onUnmounted(() => { disposed = true; generation++; });
  return { loading, error, refresh, match, status, custom, restore: entry => apply(entry, true) };
}
