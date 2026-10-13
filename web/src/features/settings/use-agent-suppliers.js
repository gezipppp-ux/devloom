import { onMounted, onUnmounted, ref } from "vue";
import { appApi } from "../../shared/api/api.js";

const base = "/system/agent-suppliers";
export function supplierDraft(row = {}) {
  return { agentType: "codex", name: row.name || "", baseUrl: row.baseUrl || "", notes: row.notes || "",
    enabled: row.enabled ?? true, defaultModel: row.defaultModel || "", apiKey: "",
    models: JSON.parse(JSON.stringify(row.models || [])), ...(row.id ? { id: row.id, revision: row.revision } : {}) };
}
export function supplierPayload(draft) {
  const { apiKey, ...payload } = draft;
  delete payload.id;
  return { ...payload, ...(apiKey ? { apiKey } : {}) };
}
export function useAgentSuppliers() {
  const suppliers = ref([]), currentId = ref(""), revision = ref(0), loading = ref(false), busy = ref(false);
  const error = ref(""), notice = ref(""), editor = ref(null), confirmation = ref(null);
  let generation = 0, disposed = false;
  async function load() {
    const expected = ++generation; loading.value = true; error.value = "";
    try {
      const result = await appApi(base);
      if (disposed || expected !== generation) return;
      suppliers.value = result.suppliers; currentId.value = result.currentId; revision.value = result.selectionRevision;
    } catch (e) { if (!disposed && expected === generation) error.value = e.message; }
    finally { if (!disposed && expected === generation) loading.value = false; }
  }
  async function mutate(operation, success) {
    if (busy.value) return;
    busy.value = true; error.value = ""; notice.value = "";
    try {
      const result = await operation();
      if (!disposed) await success?.(result);
    } catch (e) { if (!disposed) error.value = e.message; }
    finally { if (!disposed) busy.value = false; }
  }
  function edit(row) { editor.value = supplierDraft(row); }
  function duplicate(row) {
    return mutate(() => appApi(`${base}/${row.id}/duplicate`, {}), result => { editor.value = supplierDraft(result.draft); });
  }
  function confirm(row, action) { error.value = ""; confirmation.value = { row, action }; }
  function applyConfirmation() {
    if (!confirmation.value) return;
    const { row, action } = confirmation.value;
    return mutate(() => action === "toggle"
      ? appApi(`${base}/${row.id}`, { ...supplierPayload(supplierDraft(row)), enabled: !row.enabled })
      : appApi(`${base}/${row.id}/${action}`, action === "delete" ? { revision: row.revision, confirm: true } : { revision: revision.value }),
    async () => { confirmation.value = null; notice.value = "供应商配置已更新，新轮次将使用系统默认供应商。"; await load(); });
  }
  async function saved() { editor.value = null; notice.value = "供应商已保存。"; await load(); }
  onMounted(load);
  onUnmounted(() => { disposed = true; generation++; editor.value = null; });
  return { suppliers, currentId, loading, busy, error, notice, editor, confirmation, load, edit, duplicate, confirm, applyConfirmation, saved };
}
