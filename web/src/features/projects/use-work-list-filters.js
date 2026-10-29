import { computed, toValue } from "vue";
import { useRoute, useRouter } from "vue-router";
import { translate } from "../../shared/i18n/index.js";
import { priorityLabels } from "./project-labels.js";
import { developmentTaskLabels } from "./development-task-view.js";

const keys = ["releaseId", "status", "priority", "ownerId", "reporterId"];
const labels = { releaseId: "版本", status: "状态", priority: "优先级", ownerId: "负责人", reporterId: "提报人" };
const placeholders = { releaseId: "全部版本", status: "全部状态", priority: "全部优先级", ownerId: "全部负责人", reporterId: "全部提报人" };
const split = value => typeof value === "string" ? value.split(",").filter(Boolean) : [];
export function useWorkListFilters(kind, options, { prefix = "", defaultStatus = "active" } = {}) {
  const route = useRoute(), router = useRouter();
  const queryKey = key => prefix ? prefix + key[0].toUpperCase() + key.slice(1) : key;
  const applicable = computed(() => toValue(kind) === "deliveries" ? ["releaseId", "reporterId"] : toValue(kind) === "tasks" ? ["status", "releaseId", "ownerId", "reporterId"] : keys);
  const model = computed(() => Object.fromEntries(applicable.value.map(key => [key, split(route.query[queryKey(key)] || (key === "status" && toValue(kind) === "tasks" ? toValue(defaultStatus) : ""))])));
  const params = computed(() => Object.fromEntries(applicable.value.map(key => [key, model.value[key].join(",")])));
  const fields = computed(() => {
    const data = toValue(options) || {};
    const multipleProjects = new Set((data.releases || []).map(release => release.projectId)).size > 1;
    const people = (data.people || []).map(person => ({ value: person.id, label: person.displayName }));
    const choices = {
      releaseId: [{ value: "none", label: translate("未排期") }, ...(data.releases || []).map(release => ({ value: release.id, label: `${multipleProjects && release.projectName ? release.projectName + " · " : ""}${release.name}${release.status === "archived" ? translate("（已归档）") : ""}` }))],
      status: toValue(kind) === "tasks" ? Object.entries({ active: "需要开发", not_cancelled: "未取消", all: "全部状态", ...developmentTaskLabels }).map(([value, label]) => ({ value, label: translate(label) })) : (data.statuses || []).map(status => ({ value: status.id, label: status.name })),
      priority: Object.entries(priorityLabels).map(([value, label]) => ({ value, label: translate(label) })),
      ownerId: [{ value: "none", label: translate("待分派") }, ...people],
      reporterId: [...people, ...(toValue(kind) === "issues" ? [] : [{ value: "none", label: translate("无关联事项") }])],
    };
    return applicable.value.map(key => ({ key, label: translate(key === "status" ? toValue(kind) === "tasks" ? "任务状态" : "事项状态" : labels[key]), placeholder: translate(placeholders[key]), options: choices[key], exclusive: key === "status" && toValue(kind) === "tasks" ? ["all", "active", "not_cancelled"] : [], defaultValues: key === "status" && toValue(kind) === "tasks" ? [toValue(defaultStatus)] : [] }));
  });
  function update(value) {
    const next = { ...route.query, [prefix ? `${prefix}Offset` : "offset"]: undefined, selection: undefined };
    for (const key of applicable.value) next[queryKey(key)] = value[key]?.join(",") || undefined;
    return router.push({ query: next });
  }
  return { model, fields, params, update, reset: () => update({}) };
}
