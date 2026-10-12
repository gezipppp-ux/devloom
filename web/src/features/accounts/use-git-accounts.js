import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";

export function useGitAccounts() {
  const accounts = ref([]),
    loading = ref(false),
    saving = ref(false),
    checking = ref(false),
    generating = ref(false),
    deleting = ref(false);
  const error = ref(""),
    notice = ref(""),
    deleteId = ref("");
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
        ? form.username.trim() && (form.password || form.id)
        : form.publicKey),
  );
  let alive = true;
  onBeforeUnmount(() => {
    alive = false;
  });
  function edit(account) {
    if (busy.value) return;
    Object.assign(form, empty(), account || {});
    error.value = "";
    notice.value = "";
    deleteId.value = "";
  }
  function changeAuthType() {
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
      Object.assign(form, empty(), result.account);
      notice.value = "Git 账号已保存。准备项目开发空间时会验证实际仓库的访问权限。";
    });
  }
  function check() {
    return perform(checking, async () => {
      await appApi(
        `/account/git-accounts${form.id ? `/${form.id}/test` : "/check"}`,
        payload(),
      );
      if (alive) notice.value = "连接检测成功。当前填写内容尚未保存。";
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
      if (form.id === id) Object.assign(form, empty());
      deleteId.value = "";
      notice.value = "Git 账号已删除。";
    });
  }
  onMounted(load);
  return {
    accounts,
    form,
    loading,
    saving,
    checking,
    generating,
    deleting,
    busy,
    ready,
    error,
    notice,
    deleteId,
    edit,
    load,
    save,
    check,
    generate,
    remove,
    changeAuthType,
  };
}
