import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";

const hostPresets = [
  { id: "github", label: "GitHub", hostname: "github.com" },
  { id: "gitee", label: "Gitee", hostname: "gitee.com" },
  { id: "gitlab", label: "GitLab", hostname: "gitlab.com" },
];
function hostForPreset(preset, authType) {
  return `${authType === "http" ? "https://" : ""}${preset.hostname}`;
}
function presetForHost(host, authType) {
  try {
    const url = new URL(authType === "http" ? host.trim() : `ssh://${host.trim()}`);
    if (url.protocol !== (authType === "http" ? "https:" : "ssh:") || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) || url.port && !(authType === "ssh" && url.port === "22")) return undefined;
    return hostPresets.find(preset => preset.hostname === url.hostname.toLowerCase());
  } catch { return undefined; }
}

export function useGitAccounts() {
  const accounts = ref([]),
    loading = ref(false),
    saving = ref(false),
    checking = ref(false),
    generating = ref(false),
    deleting = ref(false);
  const error = ref(""),
    notice = ref(""),
    formOpen = ref(false),
    hostPreset = ref("github"),
    deleteId = ref(""),
    provider = ref("auto");
  const empty = () => ({
    id: "",
    name: "",
    authType: "http",
    host: "",
    authorName: "",
    authorEmail: "",
    revision: undefined,
    username: "",
    password: "",
    keyDraftId: "",
    publicKey: "",
  });
  const form = reactive(empty());
  let customHost = "", customProvider = "auto";
  const officialHost = computed(() => presetForHost(form.host, form.authType));
  const loginProvider = computed(() => form.authType === "http" ? officialHost.value?.id || provider.value : "auto");
  const hasSavedHttpCredential = computed(() => accounts.value.some(account => account.id === form.id && account.authType === "http"));
  const busy = computed(
    () =>
      loading.value ||
      saving.value ||
      checking.value ||
      generating.value ||
      deleting.value,
  );
  const ready = computed(
    () =>
      form.name.trim() &&
      form.host.trim() &&
      (form.authType === "http"
        ? form.username.trim() && (form.password || hasSavedHttpCredential.value)
        : form.publicKey),
  );
  let alive = true;
  onBeforeUnmount(() => {
    alive = false;
  });
  function edit(account) {
    if (busy.value) return;
    Object.assign(form, empty(), account || { host: hostForPreset(hostPresets[0], "http") });
    hostPreset.value = presetForHost(form.host, form.authType)?.id || "custom";
    customHost = hostPreset.value === "custom" ? form.host : "";
    customProvider = "auto";
    provider.value = "auto";
    error.value = "";
    notice.value = "";
    deleteId.value = "";
    formOpen.value = true;
  }
  function cancel() {
    if (busy.value) return;
    Object.assign(form, empty());
    customHost = "";
    customProvider = "auto";
    provider.value = "auto";
    formOpen.value = false;
    error.value = "";
    notice.value = "";
  }
  function selectHostPreset(id) {
    if (busy.value || id !== "custom" && !hostPresets.some(preset => preset.id === id)) return;
    if (hostPreset.value === "custom") { customHost = form.host; customProvider = provider.value; }
    hostPreset.value = id;
    form.host = id === "custom" ? customHost : hostForPreset(hostPresets.find(preset => preset.id === id), form.authType);
    provider.value = id === "custom" ? customProvider : "auto";
    error.value = "";
    notice.value = "";
  }
  function changeAuthType() {
    if (hostPreset.value !== "custom") form.host = hostForPreset(hostPresets.find(preset => preset.id === hostPreset.value), form.authType);
    form.password = "";
    form.keyDraftId = "";
    form.publicKey = "";
    const saved = accounts.value.find(
      (account) => account.id === form.id && account.authType === form.authType,
    );
    if (saved) {
      form.publicKey = saved.publicKey || "";
      form.username = saved.username || "";
    }
    error.value = "";
    notice.value = "";
  }
  async function perform(state, operation) {
    if (busy.value) return;
    state.value = true;
    error.value = "";
    notice.value = "";
    try {
      await operation();
    } catch (failure) {
      if (alive) error.value = failure.message;
    } finally {
      if (alive) state.value = false;
    }
  }
  function load() {
    return perform(loading, async () => {
      const result = await appApi("/account/git-accounts");
      if (alive) accounts.value = result.accounts;
    });
  }
  function payload() {
    const value = {
      name: form.name,
      authType: form.authType,
      host: form.host,
      authorName: form.authorName,
      authorEmail: form.authorEmail,
      ...(form.id ? { revision: form.revision } : {}),
    };
    if (form.authType === "http") {
      value.username = form.username;
      if (form.password) value.password = form.password;
    } else if (form.keyDraftId) value.keyDraftId = form.keyDraftId;
    return value;
  }
  function save() {
    if (!ready.value) return;
    return perform(saving, async () => {
      const result = await appApi(
        `/account/git-accounts${form.id ? `/${form.id}` : ""}`,
        payload(),
      );
      if (!alive) return;
      accounts.value = [
        ...accounts.value.filter((account) => account.id !== result.account.id),
        result.account,
      ];
      Object.assign(form, empty());
      formOpen.value = false;
      notice.value = "Git 账号已保存。准备项目开发空间时会验证实际仓库的访问权限。";
    });
  }
  function verify() {
    if (!ready.value) return;
    return perform(checking, async () => {
      await appApi(
        `/account/git-accounts${form.id ? `/${form.id}/verify` : "/verify"}`,
        { ...payload(), provider: loginProvider.value },
      );
      if (alive) notice.value = "Git 主机登录验证成功。验证不会保存修改；项目仓库权限会在准备开发空间时检测。";
    });
  }
  function generate() {
    return perform(generating, async () => {
      const result = await appApi("/account/git-keys", {});
      if (!alive) return;
      form.keyDraftId = result.id;
      form.publicKey = result.publicKey;
      notice.value =
        "已生成密钥。请将公钥添加到 Git 服务并保存账号。密钥草稿 24 小时内有效。";
    });
  }
  function remove() {
    const id = deleteId.value;
    if (!id) return;
    return perform(deleting, async () => {
      await appApi(`/account/git-accounts/${id}/delete`, {});
      if (!alive) return;
      accounts.value = accounts.value.filter((account) => account.id !== id);
      if (form.id === id) {
        Object.assign(form, empty());
        formOpen.value = false;
      }
      deleteId.value = "";
      notice.value = "Git 账号已删除。";
    });
  }
  onMounted(load);
  return {
    accounts,
    form,
    formOpen,
    hostPresets,
    hostPreset,
    officialHost,
    hasSavedHttpCredential,
    selectHostPreset,
    loading,
    saving,
    checking,
    provider,
    generating,
    deleting,
    busy,
    ready,
    error,
    notice,
    deleteId,
    edit,
    cancel,
    load,
    save,
    verify,
    generate,
    remove,
    changeAuthType,
  };
}
