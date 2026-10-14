import { onMounted, onUnmounted, ref, toValue, watch } from "vue";
import { bootstrap, apiPath, expireAuthentication } from "../shared/api/api.js";
import { revalidateAccountSession } from "../shared/api/account-session.js";
import { suppliersChanged } from "../shared/api/agent-supplier-events.js";
import { useTaskList } from "../features/tasks/use-task-list.js";
import { useSession } from "../features/session/use-session.js";

export function useWorkspaceConsole({
  initialTask = "",
  canRefresh,
  onOpen,
  onOpened,
  onItem,
  onEmpty,
  onResultRead = () => false,
  onUnreadResult = () => {},
}) {
  const channels = ref([]),
    archiveRevision = ref(0),
    workspace = ref(""),
    online = ref(false),
    workspaceLoading = ref(true);
  const tasks = useTaskList();
  const conversation = useSession({
    online,
    canRefresh,
    onOpen,
    onOpened,
    onItem,
    onMutation: scheduleRefresh,
  });
  let events,
    refreshTimer,
    checkingAuthentication = false,
    disposed = false,
    refreshQueued = false;

  function scheduleRefresh() {
    if (disposed) return;
    // Subscribe before loading snapshots, but let the initial list decide the
    // default session before an SSE refresh can supersede that list request.
    if (workspaceLoading.value) {
      refreshQueued = true;
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(
      () =>
        Promise.all([tasks.refresh(), conversation.refresh()]).catch((e) => {
          if (!disposed) conversation.error.value = e.message;
        }),
      400,
    );
  }

  function titleSaved(key, title) {
    tasks.updateTitle(key, title);
    conversation.updateTitle(key, title);
    archiveRevision.value++;
  }

  async function removed(key) {
    archiveRevision.value++;
    const wasActive = conversation.active.value === key;
    tasks.remove(key);
    conversation.remove(key);
    if (wasActive) {
      if (toValue(initialTask) === key) await conversation.open(key);
      else if (tasks.runs.value.length) await conversation.open(tasks.runs.value[0].key);
      else onEmpty();
    }
  }

  function archiveRestored() {
    archiveRevision.value++;
    scheduleRefresh();
  }

  function eventReceived(event) {
    if (disposed) return;
    if (event.type === "supplier-changed") suppliersChanged();
    if (event.type === "title") {
      titleSaved(event.key, event.title);
      return;
    }
    if (["archived", "deleted"].includes(event.type)) {
      void removed(event.key);
      return;
    }
    if (event.type === "restored") {
      archiveRestored();
      return;
    }
    conversation.receiveEvent(event);
    if (event.type === "state" && event.status === "completed") {
      if (!onResultRead(event)) {
        tasks.markUnread(event.key);
        onUnreadResult({
          key: event.key,
          title: tasks.runs.value.find((run) => run.key === event.key)?.title,
        });
      }
    }
    if (event.type !== "item") scheduleRefresh();
  }

  async function reloadChannels() {
    if (disposed) return;
    const initial = await bootstrap();
    if (disposed) return;
    workspace.value = initial.workspace;
    channels.value = initial.channels;
  }

  onMounted(async () => {
    try {
      await reloadChannels();
      if (disposed) return;
      events = new EventSource(apiPath("/events"));
      events.addEventListener("auth-expired", () => {
        events.close();
        online.value = false;
        expireAuthentication();
      });
      events.onopen = () => {
        online.value = true;
        archiveRevision.value++;
        scheduleRefresh();
      };
      events.onerror = () => {
        online.value = false;
        if (!checkingAuthentication && !disposed) {
          checkingAuthentication = true;
          void revalidateAccountSession().catch(() => {
            // Network outages retain the disconnected view; 401 clears it centrally.
          }).finally(() => { checkingAuthentication = false; });
        }
      };
      events.onmessage = (event) => eventReceived(JSON.parse(event.data));
      await tasks.refresh();
      if (disposed) return;
      if (toValue(initialTask)) await conversation.open(toValue(initialTask));
      else if (tasks.runs.value.length)
        await conversation.open(tasks.runs.value[0].key);
      else onEmpty();
    } catch (e) {
      if (!disposed) conversation.error.value = e.message;
    } finally {
      workspaceLoading.value = false;
      if (refreshQueued) {
        refreshQueued = false;
        scheduleRefresh();
      }
    }
  });
  watch([() => toValue(initialTask), workspaceLoading], ([key, initializing]) => {
    if (initializing || disposed) return;
    const target = key || tasks.runs.value[0]?.key;
    if (target && target !== conversation.active.value) void conversation.open(target);
  });
  onUnmounted(() => {
    disposed = true;
    events?.close();
    clearTimeout(refreshTimer);
  });

  const {
    active,
    session,
    loading,
    busy,
    error,
    notice,
    running,
    initializing,
    canSend,
    waitingForInput,
    executionSettings,
    canEditSettings,
    settingsBusy,
    settingsError,
    updateExecutionSettings,
    open,
    action,
    older,
  } = conversation;
  return {
    channels,
    workspace,
    workspaceLoading,
    online,
    runs: tasks.runs,
    unreadResultKeys: tasks.unreadResultKeys,
    preferenceError: tasks.preferenceError,
    markResultRead: tasks.markRead,
    active,
    session,
    loading,
    busy,
    error,
    notice,
    running,
    initializing,
    canSend,
    waitingForInput,
    executionSettings,
    canEditSettings,
    settingsBusy,
    settingsError,
    updateExecutionSettings,
    open,
    action,
    older,
    refreshList: tasks.refresh,
    refreshSession: conversation.refresh,
    reloadChannels,
    titleSaved,
    archiveRevision,
    archiveRestored,
    archiveSaved: removed,
    sessionDeleted: removed,
  };
}
