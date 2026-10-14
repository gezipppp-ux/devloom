import { watch } from "vue";
import { accountSession } from "../../shared/api/account-session.js";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { createAttentionTracker } from "./attention-tracker.js";

export function useAttentionNotifications(notify) {
  const tracker = createAttentionTracker();
  const scope = () => `${accountSession.generation}:${accountSession.user?.id || ""}`;
  const resource = useResource(async () => {
    const expected = scope();
    const result = await appApi("/workbench/attention");
    return expected === scope() ? { ...result, accountScope: expected } : null;
  }, { interval: 30000 });
  watch(scope, value => { tracker.reset(value); resource.data.value = null; if (accountSession.user) void resource.reload(); });
  watch(resource.data, value => {
    if (!value || value.accountScope !== scope()) return;
    const additions = tracker.accept(scope(), value.items);
    if (additions.length) notify?.(additions);
  });
  return resource;
}
