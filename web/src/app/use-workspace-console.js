import { onMounted, onUnmounted, ref } from "vue";
import { bootstrap, apiPath } from "../shared/api/api.js";
import { useTaskList } from "../features/tasks/use-task-list.js";
import { useSession } from "../features/session/use-session.js";

export function useWorkspaceConsole({
  canRefresh,
  onOpen,
  onOpened,
  onItem,
  onEmpty,
  onResultRead = () => false,
  onUnreadResult = () => {},
}) {
  const channels = ref([]),
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

  function metadataSaved(key, metadata) {
    tasks.updateMetadata(key, metadata);
    conversation.updateMetadata(key, metadata);
  }

  function eventReceived(event) {
    if (disposed) return;
    if (event.type === "metadata") {
      metadataSaved(event.key, event.metadata);
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
      events.onopen = () => {
        online.value = true;
        scheduleRefresh();
      };
      events.onerror = () => {
        online.value = false;
      };
      events.onmessage = (event) => eventReceived(JSON.parse(event.data));
      await tasks.refresh();
      if (disposed) return;
      if (tasks.runs.value.length)
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
    metadataSaved,
  };
}
