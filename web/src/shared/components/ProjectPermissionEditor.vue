<script setup>
import { computed, ref } from "vue";
import catalog from "../../../../shared/project-permissions.json";
import presets from "../../../../shared/project-permission-presets.json";
const props = defineProps({ modelValue: { type: Array, default: () => [] }, ceiling: { type: Array, default: () => catalog.map(p => p.id) }, department: Boolean, administratorAccess: Boolean, disabled: Boolean });
const emit = defineEmits(["update:modelValue"]);
const preview = ref(presets[0].id);
const groups = computed(() => [...new Set(catalog.map(p => p.group))]);
const items = computed(() => catalog.filter(p => props.department || p.scope !== "department"));
const preset = computed(() => presets.find(p => p.id === preview.value));
function allowed(id) { const permission = catalog.find(p => p.id === id); return props.ceiling.includes(id) && permission.requires.every(allowed); }
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
function labels(ids) { return ids.map(id => catalog.find(p => p.id === id)?.label).join("、"); }
function apply() { if (coreBlocked.value.length) return; emit("update:modelValue", [...new Set([...props.modelValue, ...available.value])]); }
function toggle(id, checked) { toggleMany([id], checked); }
function toggleMany(ids, checked) {
  const selected = new Set(props.modelValue);
  function add(key) { if (!allowed(key)) return; selected.add(key); catalog.find(p => p.id === key)?.requires.forEach(add); }
  if (checked) ids.forEach(add); else {
    ids.forEach(id => selected.delete(id));
    let removed;
    do { removed = false; for (const p of catalog) if (selected.has(p.id) && p.requires.some(key => !selected.has(key))) { selected.delete(p.id); removed = true; } } while (removed);
  }
  emit("update:modelValue", [...selected]);
}
</script>
<template>
  <div class="project-permission-editor">
    <p class="field-hint">{{ department ? '启用可用功能仅扩大部门上限，不会自动授予任何项目权限。项目负责人仍需在具体项目分配成员工作。' : administratorAccess ? '管理员已有全局协作管理权限。这里维护额外的项目授权，开发和敏感资产仍需部门许可及完整的项目依赖授权。' : '实际可用权限由部门上限与项目授权共同决定。添加组合会保留已选权限，包括项目管理权限。' }}</p>
    <p v-if="department" class="field-hint">开启功能会补齐必要依赖；关闭功能会同步关闭依赖它的操作。高级设置可只开放查看等细项。</p>
    <div v-if="department" class="permission-capabilities">
      <label v-for="capability in capabilities" :key="capability.id" class="permission-capability">
        <span><input type="checkbox" :aria-label="capability.label" :checked="capabilityState(capability) === '已开放'" :indeterminate="capabilityState(capability) === '部分开放'" :disabled="disabled" @change="toggleMany(capability.permissions, $event.target.checked)" />{{ capability.label }}</span>
        <small>{{ capabilityState(capability) }} · {{ capability.description }}</small>
      </label>
    </div>
    <div v-else class="permission-preset">
      <label>权限组合<select v-model="preview" :disabled="disabled" aria-label="权限组合"><option v-for="entry in presets" :key="entry.id" :value="entry.id">{{ entry.label }}</option></select></label>
      <p>{{ preset.description }}</p><p class="field-hint">将添加：{{ labels(available) || '无可用权限' }}</p>
      <p v-if="blocked.length" class="field-hint">部门未开放：{{ labels(blocked) }}</p>
      <p v-if="coreBlocked.length" class="field-hint">组合核心功能未开放：{{ labels(coreBlocked) }}。请联系系统管理员调整部门可用功能后再添加此组合。</p>
      <button type="button" :disabled="disabled || !available.length || Boolean(coreBlocked.length)" @click="apply">添加{{ preset.label }}组合</button>
    </div>
    <p class="field-hint" aria-live="polite">{{ department ? '部门开放功能' : administratorAccess ? '本次项目授权可用功能' : '保存后实际可用功能' }}：{{ effective.map(p => p.label).join('、') || '尚未授权' }}</p>
    <p v-if="!department && !administratorAccess && !modelValue.includes('project.view')" class="field-hint">参与中的成员必须有“查看项目”权限，否则无法进入项目。</p>
    <details><summary>高级权限细项（{{ modelValue.length }} 项已选）</summary>
      <p class="field-hint">选中操作会补齐必要查看权限；取消依赖会同时取消相关操作。启动、续聊、审批会允许执行命令及修改代码。</p>
      <fieldset v-for="group in groups" :key="group" :disabled="disabled"><legend>{{ group }}</legend>
        <label v-for="permission in items.filter(p => p.group === group)" :key="permission.id" class="permission-choice">
          <input type="checkbox" :checked="modelValue.includes(permission.id)" :disabled="!allowed(permission.id) && !modelValue.includes(permission.id)" @change="toggle(permission.id, $event.target.checked)" />{{ permission.label }}<small v-if="!allowed(permission.id)">（部门未开放或缺少依赖）</small>
        </label>
      </fieldset>
    </details>
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
summary { cursor: pointer; padding: 12px 0; }
</style>
