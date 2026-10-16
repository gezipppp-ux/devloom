import { onMounted, onUnmounted, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import steps from "../../../../shared/setup-steps.json";
import { translate } from "../../shared/i18n/index.js";

export function useSetup() {
  const state = ref(null), loading = ref(false), saving = ref(false), error = ref(""), step = ref("environment");
  const directory = ref("");
  const accounts = reactive([
    { kind: "product", username: "test-product", displayName: translate("测试#产品"), selected: true, password: "" },
    { kind: "developer", username: "test-dev", displayName: translate("测试#研发"), selected: true, password: "" },
  ]);
  const project = reactive({ name: "", description: "", remoteUrl: "", memberIds: [] });
  let disposed = false, generation = 0, initialized = false;
  const requests = new Map();
  function clearPasswords() { accounts.forEach(account => { account.password = ""; }); }
  function accept(result, advance = false) {
    state.value = result;
    if (!initialized) {
      directory.value = result.drafts.directory ?? result.memberStorageRoot;
      result.drafts.accounts?.forEach((account, index) => Object.assign(accounts[index], account));
      Object.assign(project, result.drafts.project || {});
      if (!result.drafts.project) project.memberIds = result.accounts.map(account => account.id);
      initialized = true;
      step.value = result.currentStep;
    } else if (advance) {
      step.value = result.currentStep;
      if (!result.steps.project) project.memberIds = result.accounts.map(account => account.id);
    }
  }
  async function load() {
    if (saving.value || loading.value) return;
    const current = ++generation;
    loading.value = true; error.value = "";
    try { const result = await appApi("/system/setup"); if (!disposed && current === generation) accept(result); }
    catch (failure) { if (!disposed && current === generation) error.value = failure.message; }
    finally { if (!disposed && current === generation) loading.value = false; }
  }
  function navigate(id) {
    if (saving.value || loading.value) return;
    const maximum = steps.findIndex(item => item.id === state.value.currentStep);
    if (steps.findIndex(item => item.id === id) <= maximum) { step.value = id; error.value = ""; }
  }
  async function submit(id, value, skip = false) {
    if (!state.value || saving.value || loading.value) return false;
    const body = skip ? { skip: true } : { value: value || {} };
    const content = JSON.stringify(body);
    let request = requests.get(id);
    if (!request || request.content !== content) {
      request = { content, payload: { ...body, revision: state.value.revision, requestId: createRequestId() } };
      requests.set(id, request);
    }
    const current = ++generation;
    saving.value = true; error.value = "";
    try {
      const result = await appApi(`/system/setup/${id}`, request.payload);
      if (disposed || current !== generation) return false;
      requests.delete(id); clearPasswords(); accept(result, true);
      return true;
    } catch (failure) {
      if (!disposed && current === generation) {
        error.value = failure.message;
        if (failure.status === 409 || failure.status === 400) requests.delete(id);
      }
      return false;
    } finally { if (!disposed && current === generation) saving.value = false; }
  }
  async function saveDraft() {
    if (saving.value || loading.value || !state.value) return false;
    clearPasswords(); requests.clear();
    saving.value = true; error.value = "";
    try {
      const result = await appApi("/system/setup/draft", { revision: state.value.revision, drafts: {
        directory: directory.value,
        accounts: accounts.map(({ username, displayName, selected }) => ({ username, displayName, selected })),
        project: { ...project, memberIds: [...project.memberIds] },
      } });
      if (disposed) return false;
      accept(result); return true;
    } catch (failure) { if (!disposed) error.value = failure.message; return false; }
    finally { if (!disposed) saving.value = false; }
  }
  onMounted(load);
  onUnmounted(() => { disposed = true; generation++; clearPasswords(); requests.clear(); });
  return { state, loading, saving, error, step, directory, accounts, project, load, submit, navigate, saveDraft };
}
