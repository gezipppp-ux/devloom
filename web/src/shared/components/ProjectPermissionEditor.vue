<script setup>
import { translate } from "../i18n/index.js";
import { computed, ref, useId } from "vue";
import catalog from "../../../../shared/project-permissions.json";
import presets from "../../../../shared/project-permission-presets.json";
const props = defineProps({ modelValue: { type: Array, default: () => [] }, baseline: { type: Array, default: () => [] }, ceiling: { type: Array, default: () => catalog.map(p => p.id) }, department: Boolean, administratorAccess: Boolean, disabled: Boolean });
const emit = defineEmits(["update:modelValue"]);
const preview = ref(presets[0].id);
const editorId = useId();
const search = ref("");
const onlySelected = ref(false);
const selectedGroup = ref(catalog[0].group);
const lastChange = ref("");
const items = computed(() => catalog.filter(p => props.department || p.scope !== "department"));
const groups = computed(() => [...new Set(items.value.map(p => p.group))].map(name => {
  const permissions = items.value.filter(p => p.group === name);
  return { name, permissions, selected: permissions.filter(p => props.modelValue.includes(p.id)).length, matches: permissions.filter(matches) };
}));
const activeGroup = computed(() => groups.value.find(group => group.name === selectedGroup.value && group.matches.length) || groups.value.find(group => group.matches.length));
const visiblePermissions = computed(() => activeGroup.value?.matches || []);
const selectable = computed(() => visiblePermissions.value.filter(p => allowed(p.id)));
const allSelected = computed(() => selectable.value.length > 0 && selectable.value.every(p => props.modelValue.includes(p.id)));
const partlySelected = computed(() => !allSelected.value && selectable.value.some(p => props.modelValue.includes(p.id)));
const selectedVisible = computed(() => visiblePermissions.value.filter(p => props.modelValue.includes(p.id)));
const filtering = computed(() => Boolean(search.value.trim()) || onlySelected.value);
const changes = computed(() => ({ added: props.modelValue.filter(id => !props.baseline.includes(id)), removed: props.baseline.filter(id => !props.modelValue.includes(id)) }));
const hasChanges = computed(() => Boolean(changes.value.added.length || changes.value.removed.length));
const preset = computed(() => presets.find(p => p.id === preview.value));
function matches(permission) {
  const query = search.value.trim().toLocaleLowerCase();
  return (!query || `${translate(permission.group)} ${translate(permission.label)} ${permission.group} ${permission.label}`.toLocaleLowerCase().includes(query)) && (!onlySelected.value || props.modelValue.includes(permission.id));
}
function allowed(id) { const permission = catalog.find(p => p.id === id); return props.ceiling.includes(id) && permission.requires.every(allowed); }
function caution(permission) {
  if (["session.start", "session.continue", "session.approve"].includes(permission.id)) return "允许执行命令及修改代码";
  if (permission.id.startsWith("asset.secret.")) return "涉及密码、Token 等敏感字段";
  return "";
}
const capabilities = [
  { id: "management", label: "项目管理", description: "允许配置项目、管理成员、归档及申请创建项目", permissions: catalog.filter(p => p.group === "项目" && p.id !== "project.view").map(p => p.id) },
  { id: "collaboration", label: "需求与 Bug 协作", description: "允许维护事项、验收、评论和发布交付", permissions: catalog.filter(p => ["需求与 Bug", "协作"].includes(p.group)).map(p => p.id) },
  { id: "code", label: "代码操作", description: "允许准备开发空间和执行仓库操作", permissions: ["code.view", "code.operate"] },
  { id: "agent", label: "Agent 开发", description: "允许启动、续聊、审批和停止；同时开放必要的代码操作", permissions: catalog.filter(p => p.id.startsWith("session.")).map(p => p.id) },
  { id: "assets", label: "普通资产", description: "允许查看和维护普通文档、环境等资产", permissions: ["asset.view", "asset.edit"] },
  { id: "secrets", label: "敏感资产", description: "允许查看和维护密码、Token 等敏感字段，需谨慎开放", permissions: ["asset.secret.view", "asset.secret.edit"] },
];
const coreBlocked = computed(() => preset.value.corePermissions.filter(id => !allowed(id)));
function capabilityState(capability) {
  const count = capability.permissions.filter(id => props.modelValue.includes(id)).length;
  return count === capability.permissions.length ? "已开放" : count ? "部分开放" : "未开放";
}
const available = computed(() => preset.value.permissions.filter(allowed));
const blocked = computed(() => preset.value.permissions.filter(id => !allowed(id)));
const effective = computed(() => {
  const selected = new Set(props.modelValue.filter(allowed));
  let changed;
  do { changed = false; for (const permission of catalog) if (selected.has(permission.id) && permission.requires.some(id => !selected.has(id))) { selected.delete(permission.id); changed = true; } } while (changed);
  return items.value.filter(permission => selected.has(permission.id));
});
function labels(ids) { return ids.map(id => translate(catalog.find(p => p.id === id)?.label)).join("、"); }
function apply() { if (coreBlocked.value.length) return; toggleMany(available.value, true); }
function toggle(id, checked) { toggleMany([id], checked); }
function toggleMany(ids, checked) {
  if (props.disabled) return;
  const selected = new Set(props.modelValue);
  function add(key) { if (!allowed(key)) return; selected.add(key); catalog.find(p => p.id === key)?.requires.forEach(add); }
  if (checked) ids.forEach(add); else {
    ids.forEach(id => selected.delete(id));
    let removed;
    do { removed = false; for (const p of catalog) if (selected.has(p.id) && p.requires.some(key => !selected.has(key))) { selected.delete(p.id); removed = true; } } while (removed);
  }
  const added = [...selected].filter(id => !props.modelValue.includes(id));
  const removed = props.modelValue.filter(id => !selected.has(id));
  const dependencies = (checked ? added : removed).filter(id => !ids.includes(id));
  lastChange.value = translate(checked ? '已选择 {count} 项。' : '已取消 {count} 项。', { count: checked ? added.length : removed.length }) + (dependencies.length ? translate(checked ? '自动补齐' : '联动关闭') + ': ' + labels(dependencies) : '');
  emit("update:modelValue", [...selected]);
}
function resetFilters() { search.value = ""; onlySelected.value = false; }
function revert() {
  if (props.disabled) return;
  emit("update:modelValue", [...props.baseline]);
  lastChange.value = "已撤销本次权限修改。";
}
</script>
<template>
  <div class="project-permission-editor">
    <p class="field-hint">{{ department ? $t("启用可用功能仅扩大部门上限，不会自动授予任何项目权限。项目负责人仍需在具体项目分配成员工作。") : administratorAccess ? $t("管理员已有全局协作管理权限。这里维护额外的项目授权，开发和敏感资产仍需部门许可及完整的项目依赖授权。") : $t("实际可用权限由部门上限与项目授权共同决定。添加组合会保留已选权限，包括项目管理权限。") }}</p>
    <p v-if="department" class="field-hint">{{ $t("开启功能会补齐必要依赖；关闭功能会同步关闭依赖它的操作。高级设置可只开放查看等细项。") }}</p>
    <div v-if="department" class="permission-capabilities">
      <label v-for="capability in capabilities" :key="capability.id" class="permission-capability">
        <span><input type="checkbox" :aria-label="$t(capability.label)" :checked="capabilityState(capability) === '已开放'" :indeterminate="capabilityState(capability) === '部分开放'" :disabled="disabled" @change="toggleMany(capability.permissions, $event.target.checked)" />{{ $t(capability.label) }}</span>
        <small>{{ $t(capabilityState(capability)) }} · {{ $t(capability.description) }}</small>
      </label>
    </div>
    <div v-else class="permission-preset">
      <label>{{ $t("权限组合") }}<select v-model="preview" :disabled="disabled" :aria-label="$t(&quot;权限组合&quot;)"><option v-for="entry in presets" :key="entry.id" :value="entry.id">{{ $t(entry.label) }}</option></select></label>
      <p>{{ $t(preset.description) }}</p><p class="field-hint">{{ $t("将添加：") }}{{ labels(available) || $t("无可用权限") }}</p>
      <p v-if="blocked.length" class="field-hint">{{ $t("部门未开放：") }}{{ labels(blocked) }}</p>
      <p v-if="coreBlocked.length" class="field-hint">{{ $t("组合核心功能未开放：") }}{{ labels(coreBlocked) }}{{ $t("。请联系系统管理员调整部门可用功能后再添加此组合。") }}</p>
      <button type="button" :disabled="disabled || !available.length || Boolean(coreBlocked.length)" @click="apply">{{ $t("添加") }}{{ $t(preset.label) }}{{ $t("组合") }}</button>
    </div>
    <p class="field-hint" aria-live="polite">{{ department ? $t("部门开放功能") : administratorAccess ? $t("本次项目授权可用功能") : $t("保存后实际可用功能") }}：{{ department ? $t("{p0} / {p1} 项，可在下方按分类查看", { p0: effective.length, p1: items.length }) : effective.map(p => p.label).join('、') || $t("尚未授权") }}</p>
    <p v-if="!department && !administratorAccess && !modelValue.includes('project.view')" class="field-hint">{{ $t("参与中的成员必须有“查看项目”权限，否则无法进入项目。") }}</p>
    <details class="permission-details" :open="department"><summary>{{ $t("高级权限细项（") }}{{ modelValue.length }} {{ $t("项已选）") }}</summary>
      <p class="field-hint">{{ $t("选中操作会补齐必要依赖；取消基础权限会同时取消相关操作。") }}</p>
      <div class="permission-toolbar">
        <label class="permission-search">{{ $t("搜索权限") }}<input v-model="search" type="search" :placeholder="$t(&quot;搜索功能或权限名称&quot;)" @keydown.enter.prevent /></label>
        <label class="permission-filter"><input v-model="onlySelected" type="checkbox" />{{ department ? $t("只看已开放") : $t("只看已选") }}</label>
      </div>
      <div class="permission-workbench">
        <nav class="permission-categories" :aria-label="$t(&quot;权限分类&quot;)">
          <button v-for="group in groups" :key="group.name" type="button" :aria-label="$t(group.name)" :aria-pressed="activeGroup?.name === group.name" :disabled="!group.matches.length" @click="selectedGroup = group.name">
            <span>{{ $t(group.name) }}</span><small>{{ group.selected }} / {{ group.permissions.length }}</small>
          </button>
        </nav>
        <section class="permission-pane" :aria-label="activeGroup ? $t(&quot;{p0}权限&quot;, { p0: $t(activeGroup.name) }) : $t(&quot;权限搜索结果&quot;)">
          <template v-if="activeGroup">
            <header class="permission-pane-heading"><h3>{{ $t(activeGroup.name) }}</h3><span>{{ activeGroup.selected }} / {{ activeGroup.permissions.length }} {{ $t("项") }}{{ department ? $t("已开放") : $t("已选") }}</span></header>
            <div class="permission-group-actions">
              <label class="permission-filter"><input type="checkbox" :checked="allSelected" :indeterminate="partlySelected" :disabled="disabled || !selectable.length" @change="toggleMany(selectable.map(p => p.id), $event.target.checked)" />{{ filtering ? $t("全选筛选结果") : $t("本组全选") }}</label>
              <button type="button" class="permission-quiet" :disabled="disabled || !selectedVisible.length" @click="toggleMany(selectedVisible.map(p => p.id), false)">{{ filtering ? $t("清空筛选结果") : $t("清空本组") }}</button>
            </div>
            <div class="permission-rows">
              <label v-for="permission in visiblePermissions" :key="permission.id" class="permission-detail-row">
                <input type="checkbox" :aria-label="$t(permission.label)" :aria-describedby="`${editorId}-${permission.id}`" :checked="modelValue.includes(permission.id)" :disabled="disabled || (!allowed(permission.id) && !modelValue.includes(permission.id))" @change="toggle(permission.id, $event.target.checked)" />
                <span><span class="permission-label">{{ $t(permission.label) }}</span><span :id="`${editorId}-${permission.id}`" class="permission-description">
                  <small v-if="!allowed(permission.id)" class="permission-caution">{{ $t("部门未开放或缺少依赖") }}</small>
                  <small>{{ permission.requires.length ? $t("依赖：{p0}", { p0: labels(permission.requires) }) : $t("项目访问的基础权限") }}</small>
                  <small v-if="caution(permission)" class="permission-caution">{{ $t(caution(permission)) }}</small>
                </span></span>
              </label>
            </div>
          </template>
          <div v-else class="permission-empty"><p>{{ onlySelected && !modelValue.length ? $t("尚未选择任何权限") : $t("没有匹配的权限") }}</p><button type="button" @click="resetFilters">{{ $t("清除筛选") }}</button></div>
        </section>
      </div>
      <p v-if="lastChange" class="permission-change" role="status">{{ $t(lastChange) }}</p>
    </details>
    <div class="permission-changes"><p aria-live="polite">{{ hasChanges ? $t("待保存：新增 {p0} 项 · 取消 {p1} 项", { p0: changes.added.length, p1: changes.removed.length }) : $t("当前权限未修改") }}</p><button type="button" class="permission-quiet" :disabled="disabled || !hasChanges" @click="revert">{{ $t("撤销权限修改") }}</button></div>
  </div>
</template>
<style scoped>
.permission-capabilities { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.permission-capability { display: grid; gap: 8px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius-card); }
.permission-capability span { display: flex; align-items: center; gap: 8px; }
.permission-capability input { flex: 0 0 auto; }
.permission-capability small { color: var(--muted); overflow-wrap: anywhere; }
@media (max-width: 600px) { .permission-capabilities { grid-template-columns: 1fr; } }
.permission-preset { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; }
.permission-preset label { display: grid; gap: 8px; }
.permission-preset p { margin: 0; overflow-wrap: anywhere; }
.permission-preset button { justify-self: start; }
.permission-details > summary { cursor: pointer; padding: 12px 0; font-weight: 600; }
.permission-toolbar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px 20px; margin: 16px 0; }
.permission-search { flex: 1 1 240px; }
.project-permission-editor .permission-filter { display: inline-flex; flex-direction: row; align-items: center; gap: 8px; min-height: var(--control-height); font-size: 13px; }
.project-permission-editor input[type=checkbox] { width: 16px; height: 16px; min-height: 0; flex: 0 0 16px; margin: 0; accent-color: var(--accent); }
.permission-workbench { display: grid; grid-template-columns: 180px minmax(0, 1fr); min-width: 0; border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; background: var(--surface); }
.permission-categories { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: var(--sidebar); }
.permission-categories button { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; min-height: 44px; border-color: transparent; background: transparent; text-align: left; font-size: 13px; }
.permission-categories button[aria-pressed=true] { background: var(--selected); color: var(--ink); font-weight: 600; }
.permission-categories small { color: var(--muted); font-size: 12px; font-weight: 400; white-space: nowrap; }
.permission-pane { min-width: 0; padding: 20px; }
.permission-pane-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.permission-pane-heading h3 { margin: 0; font-size: 17px; }
.permission-pane-heading > span { color: var(--muted); font-size: 12px; }
.permission-group-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; padding: 8px 0; }
.project-permission-editor .permission-detail-row { display: flex; flex-direction: row; align-items: flex-start; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); min-width: 0; cursor: pointer; }
.project-permission-editor .permission-detail-row > input { margin-top: 4px; }
.permission-detail-row > span { min-width: 0; overflow-wrap: anywhere; }
.permission-label { display: block; font-size: 14px; }
.permission-description { display: grid; gap: 4px; margin-top: 6px; }
.permission-description small { color: var(--muted); font-size: 12px; line-height: 1.6; }
.permission-description .permission-caution { color: var(--warning); }
.permission-quiet { background: transparent; border-color: transparent; color: var(--accent); font-size: 13px; }
.permission-empty { display: grid; justify-items: center; align-content: center; gap: 16px; min-height: 200px; color: var(--muted); text-align: center; }
.permission-change { padding: 12px 16px; margin: 16px 0 0; background: var(--soft); border-radius: var(--radius-control); font-size: 12px; overflow-wrap: anywhere; }
.permission-changes { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding-top: 12px; }
.permission-changes p { margin: 0; color: var(--muted); font-size: 12px; }
@media (max-width: 600px) {
  .permission-workbench { grid-template-columns: 1fr; }
  .permission-categories { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 8px; }
  .permission-categories button { padding: 8px; }
  .permission-pane { padding: 16px; }
  .permission-search { flex-basis: 100%; }
}
</style>
