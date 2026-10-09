import { onUnmounted, reactive, ref, watch } from "vue";
import { api } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";

export function useRequirementAdditions(taskKey, saved) {
  const form = reactive({ items: [], supplementaryInstructions: "", requestId: createRequestId() });
  const busy = ref(false), error = ref("");
  let revision = 0;
  function reset() {
    revision++;
    Object.assign(form, { items: [], supplementaryInstructions: "", requestId: createRequestId() });
    error.value = "";
    busy.value = false;
  }
  watch(taskKey, reset);
  onUnmounted(() => { revision++; });
  async function append(workspace) {
    if (busy.value) return;
    if (!form.items.length) { error.value = "请选择要追加的需求。"; return; }
    const current = revision;
    busy.value = true;
    error.value = "";
    try {
      await api(`/runs/${taskKey()}/requirements`, { ...form, workspace, items: form.items.map(({ id, type }) => ({ id, type })) });
      if (revision !== current) return;
      reset();
      saved();
    } catch (e) { if (revision === current) error.value = e.message; }
    finally { if (revision === current) busy.value = false; }
  }
  return { form, busy, error, append, reset };
}
