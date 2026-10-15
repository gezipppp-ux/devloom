/* global setTimeout, clearTimeout */
import { computed, onScopeDispose, ref, toValue, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { workLocation } from "./work-navigation.js";

const groups = ["issues", "tasks", "deliveries"];
const projectRow = project => ({ key: `project/${project.id}`, title: project.name, description: project.description || "", kind: "projects", type: "project", location: { name: "project", params: { projectId: project.id } } });

export function useGlobalSearch(projects) {
  const query = ref(""), loading = ref(false), error = ref(""), data = ref(null);
  let generation = 0, alive = true, timer;
  const rows = computed(() => {
    if (!data.value) return [];
    const available = toValue(projects);
    if (!data.value.query) {
      const recent = data.value.recent.map(project => available.find(item => item.id === project.id)).filter(Boolean);
      return (recent.length ? recent : available).slice(0, 6).map(projectRow);
    }
    const matched = available.filter(project => `${project.name} ${project.description || ""}`.toLocaleLowerCase().includes(data.value.query.toLocaleLowerCase())).slice(0, 5).map(projectRow);
    return [...matched, ...groups.flatMap(kind => (data.value[kind]?.items || []).filter(item => {
      const project = available.find(project => project.id === item.projectId);
      return project?.permissions.includes(kind === "tasks" ? "session.view" : kind === "deliveries" ? "collaboration.view" : "issue.view") && (kind !== "deliveries" || project.permissions.includes("issue.view"));
    }).map(item => ({ key: `${kind}/${item.projectId}/${item.id}`, title: item.title, description: [item.projectName, item.number ? `#${item.number}` : ""].filter(Boolean).join(" · "), kind, type: item.type, location: workLocation(kind, item) })))];
  });
  const recent = computed(() => !data.value?.query && Boolean(data.value?.recent?.some(project => toValue(projects).some(item => item.id === project.id))));
  async function load(expected, value) {
    const results = await Promise.allSettled(value ? groups.map(kind => appApi(`/workbench/${kind}?query=${encodeURIComponent(value)}&limit=5`)) : [appApi("/workbench/recent-projects")]);
    if (!alive || expected !== generation) return;
    const failure = results.find(result => result.status === "rejected");
    error.value = failure?.reason.message || "";
    data.value = value ? { query: value, ...Object.fromEntries(groups.map((kind, index) => [kind, results[index].status === "fulfilled" ? results[index].value : null])) } : { query: "", recent: results[0].status === "fulfilled" ? results[0].value.projects : [] };
    loading.value = false;
  }
  function search(delay = 0) {
    clearTimeout(timer);
    const expected = ++generation, value = query.value.trim();
    data.value = null; error.value = ""; loading.value = true;
    if (delay) timer = setTimeout(() => void load(expected, value), delay);
    else void load(expected, value);
  }
  watch(query, () => search(200), { flush: "sync" });
  search();
  onScopeDispose(() => { alive = false; generation++; clearTimeout(timer); });
  return { query, rows, recent, loading, error, search: () => search() };
}
