import { computed, onMounted, onUnmounted, ref } from "vue";
import catalog from "../../../../shared/codex-permissions.json";
import { api } from "./api.js";

export function usePermissionModes(request = api) {
  const discovered = ref(null),
    loading = ref(false),
    error = ref(""),
    errorHint = ref("");
  let revision = 0;
  const permissionModes = computed(() =>
    catalog.map((entry) => {
      const result = discovered.value?.find((mode) => mode.id === entry.id);
      return {
        ...entry,
        available: result ? result.available === true : entry.id !== "auto",
        reason:
          result?.reason ||
          (entry.id === "auto" && !result
            ? "尚未确认服务是否支持帮我批准，请刷新权限选项。"
            : ""),
      };
    }),
  );
  async function refresh() {
    const current = ++revision;
    loading.value = true;
    error.value = "";
    errorHint.value = "";
    try {
      const result = await request("/execution-options");
      if (
        !Array.isArray(result?.permissionModes) ||
        !result.permissionModes.every(
          (mode) =>
            mode &&
            typeof mode.id === "string" &&
            typeof mode.available === "boolean",
        ) ||
        !catalog.every((entry) =>
          result.permissionModes.some(
            (mode) =>
              mode?.id === entry.id && typeof mode.available === "boolean",
          ),
        )
      )
        throw new Error("权限选项响应格式无效");
      if (current === revision) discovered.value = result.permissionModes;
    } catch (e) {
      if (current === revision) {
        discovered.value = null;
        error.value =
          e.status && !e.message.includes(`HTTP ${e.status}`)
            ? `HTTP ${e.status}：${e.message}`
            : e.message;
        errorHint.value =
          e.status === 404
            ? "当前服务缺少权限接口，请重启 Web 服务并刷新页面。"
            : e instanceof TypeError
              ? "请确认服务连接正常，再刷新权限选项。"
              : "请刷新权限选项；仍然失败时检查服务日志。";
      }
    } finally {
      if (current === revision) loading.value = false;
    }
  }
  onMounted(refresh);
  onUnmounted(() => {
    revision++;
  });
  return { permissionModes, loading, error, errorHint, refresh };
}
