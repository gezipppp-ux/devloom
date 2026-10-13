import { computed, onUnmounted, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";

// The detail component is keyed by task ID: requests and drafts belong to one task.
export function useDevelopmentTask(projectId, taskId, changed) {
  const endpoint = `/projects/${projectId}/tasks/${encodeURIComponent(taskId)}`;
  const resource = useResource(() => appApi(endpoint));
  const task = computed(() => resource.data.value?.task || null);
  const query = ref("");
  const search = useResource(
    () =>
      appApi(
        `/projects/${projectId}/issues?query=${encodeURIComponent(query.value)}&limit=100&releaseId=${task.value?.releaseId || "unassigned"}`,
      ),
    { immediate: false },
  );
  const choices = computed(() =>
    (search.data.value?.items || []).filter(
      (issue) => !task.value?.issueIds.includes(issue.id),
    ),
  );
  const startRequestId = createRequestId();
  let additionRequestId = createRequestId(),
    alive = true;
  onUnmounted(() => {
    alive = false;
  });
  async function mutate(action, input = {}, message = "任务已更新。") {
    if (!task.value || resource.loading.value || resource.saving.value) return;
    return resource.save(
      `${endpoint}${action ? `/${action}` : ""}`,
      { revision: task.value.revision, ...input },
      (result) => {
        resource.data.value = result;
        changed();
      },
      message,
    );
  }
  async function start(baseBranch, supplementaryPrompt = "", selection = {}) {
    if (resource.loading.value || resource.saving.value) return;
    const result = await mutate(
      "start",
      { requestId: startRequestId, baseBranch, supplementaryPrompt, ...selection },
      "已提交开发启动请求，请在会话中跟进。",
    );
    // A failed response may follow accepted dispatch. Read the recorded result,
    // keeping the original diagnostic rather than offering a blind restart.
    if (!result && alive) {
      const message = resource.error.value;
      await resource.reload();
      if (alive && message) resource.error.value = message;
    }
    return result;
  }
  function append(issueIds) {
    if (resource.loading.value) return;
    return resource.save(
      `${endpoint}/issues`,
      { requestId: additionRequestId, issueIds, send: false },
      (result) => {
        resource.data.value = result;
        additionRequestId = createRequestId();
        changed();
      },
      "追加资料已保存，点击发送才会继续 Codex。",
    );
  }
  function send(batch) {
    if (resource.loading.value) return;
    return resource.save(
      `${endpoint}/additions/${encodeURIComponent(batch.requestId)}/continue`,
      {},
      (result) => {
        resource.data.value = result;
        changed();
      },
      "追加资料已发送。",
    );
  }
  return {
    ...resource,
    task,
    query,
    search,
    choices,
    mutate,
    start,
    append,
    send,
  };
}
