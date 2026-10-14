<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
/* global document, window */
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { PlusOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import StatusBadge from "../../shared/components/StatusBadge.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
defineProps({ embedded: Boolean });
const creating = ref(false), demoting = ref(null), memberDepartmentId = ref("");
const users = ref([]), busy = ref(false), loading = ref(true), error = ref(""), notice = ref("");
const departments = ref([]);
const form = reactive({ username: "", displayName: "", password: "", role: "member", departmentId: "", canCreateProjects: false });
const selected = ref(null), resetPassword = ref("");
const editingName = ref(null), displayName = ref("");
let disposed = false, openMenu = null;
function positionMenu() {
  if (!openMenu?.open) return;
  const panel = openMenu.querySelector('.account-row-actions');
  const anchor = openMenu.querySelector('summary').getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const bottom = window.innerHeight - (window.innerWidth < 768 ? 80 : 16);
  panel.style.left = `${Math.max(16, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 16))}px`;
  panel.style.top = `${Math.max(16, Math.min(anchor.bottom + 8 + bounds.height <= bottom ? anchor.bottom + 8 : anchor.top - bounds.height - 8, bottom - bounds.height))}px`;
}
function toggleMenu(event) {
  if (event.target !== event.currentTarget) return;
  const details = event.currentTarget, panel = details.querySelector('.account-row-actions');
  if (details.open) { openMenu = details; panel.showPopover(); positionMenu(); }
  else if (panel.matches(':popover-open')) panel.hidePopover();
}
function menuVisibility(event) {
  if (event.newState === 'closed') {
    const details = event.target.closest('details');
    details.open = false;
    if (openMenu === details) openMenu = null;
  }
}
onMounted(() => { document.addEventListener('scroll', positionMenu, true); window.addEventListener('resize', positionMenu); });
onUnmounted(() => { disposed = true; form.password = ""; resetPassword.value = ""; document.removeEventListener('scroll', positionMenu, true); window.removeEventListener('resize', positionMenu); });
async function load() {
  loading.value = true;
  try { const [result, organization] = await Promise.all([appApi("/admin/accounts"), appApi("/admin/departments")]); if (!disposed) { users.value = result.users; departments.value = organization.departments; } }
  catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) loading.value = false; }
}
onMounted(load);
async function mutate(url, data, message) {
  if (busy.value) return;
  busy.value = true; error.value = ""; notice.value = "";
  try {
    const result = await appApi(url, data);
    if (disposed) return;
    if (result.user?.id === accountSession.user?.id) accountSession.user = result.user;
    form.password = ""; resetPassword.value = ""; selected.value = null; editingName.value = null;
    notice.value = message; creating.value = false; demoting.value = null;
    await load();
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) busy.value = false; }
}
function closeCreate() { if (!busy.value) { creating.value = false; form.password = ""; } }
function closeMenu(event) { event.target.closest("details").open = false; }
function create() { if (!form.displayName.trim()) return; return mutate("/admin/accounts", { ...form, ...(form.role === "admin" ? { departmentId: null, canCreateProjects: false } : {}) }, "账号已创建，首次登录需要修改密码。"); }
function update(user, patch) { return mutate(`/admin/accounts/${encodeURIComponent(user.id)}`, patch, "账号已更新。"); }
</script>
<template>
  <section class="system-settings-panel">
    <header class="ui-settings-heading"><div><component :is="embedded ? 'h2' : 'h1'">{{ $t('账号管理') }}</component><p>{{ $t('维护登录账号及组织归属。') }}</p></div><button class="primary" @click="creating = true"><PlusOutlined aria-hidden="true" />{{ $t('新建账号') }}</button></header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <ModalDialog :open="creating" :title="$t('创建账号')" @close="closeCreate">
      <a-form :model="form" layout="vertical" @finish="create">
        <div class="form-columns"><a-form-item :label="$t('新账号')"><input v-model="form.username" :aria-label="$t('新账号')" autocomplete="off" required maxlength="80" :disabled="busy" /></a-form-item><a-form-item :label="$t('账号角色')"><AppSelect native-events v-model="form.role" :aria-label="$t('账号角色')" :disabled="busy"><option value="member">{{ $t("普通成员") }}</option><option value="admin">{{ $t("管理员") }}</option></AppSelect></a-form-item></div>
        <a-form-item :label="$t('显示名称')"><input v-model="form.displayName" :aria-label="$t('显示名称')" required maxlength="80" :disabled="busy" /><p class="field-hint">{{ $t("用于成员、评论和负责人展示；登录仍使用账号。") }}</p></a-form-item>
        <a-form-item :label="$t('临时密码')"><input v-model="form.password" type="password" :aria-label="$t('临时密码')" autocomplete="new-password" required minlength="6" :disabled="busy" /><p class="field-hint">{{ $t("至少 6 个字符；首次登录强制修改。") }}</p></a-form-item>
        <a-form-item v-if="form.role === 'member'" :label="$t('所属部门')"><AppSelect native-events v-model="form.departmentId" :aria-label="$t('所属部门')" required :disabled="busy"><option value="" disabled>{{ $t("选择部门") }}</option><option v-for="department in departments.filter(d => d.status === 'active')" :key="department.id" :value="department.id">{{ department.name }}</option></AppSelect><p v-if="!departments.length" class="field-hint">{{ $t("请先在「部门与权限」中创建部门。") }}</p></a-form-item>
        <p v-if="form.role === 'admin'" class="field-hint">{{ $t("管理员不属于任何部门，自动拥有全部权限，无需分配。") }}</p><a-form-item v-else><label class="permission-choice"><input v-model="form.canCreateProjects" type="checkbox" :disabled="busy" />{{ $t("允许创建项目（仍受部门权限上限限制）") }}</label></a-form-item>
        <button class="primary" type="submit" :disabled="busy || !form.displayName.trim()">{{ $t("创建账号") }}</button>
      </a-form>
    </ModalDialog>
    <ModalDialog v-if="demoting" :open="true" :title="$t('设为普通成员')" @close="!busy && (demoting = null)">
      <form class="project-form" @submit.prevent="update(demoting, { role: 'member', departmentId: memberDepartmentId })">
        <label>{{ $t('所属部门') }}<AppSelect native-events v-model="memberDepartmentId" :aria-label="$t('所属部门')" required :disabled="busy"><option value="" disabled>{{ $t('选择部门') }}</option><option v-for="department in departments.filter(d => d.status === 'active')" :key="department.id" :value="department.id">{{ department.name }}</option></AppSelect></label>
        <div class="actions"><button class="primary" type="submit" :disabled="busy || !memberDepartmentId">{{ $t('设为普通成员') }}</button><button type="button" :disabled="busy" @click="demoting = null">{{ $t('取消') }}</button></div>
      </form>
    </ModalDialog>
    <section class="ui-account-directory" :aria-label="$t('账号列表')">
      <p v-if="loading" role="status">{{ $t("正在读取账号…") }}</p>
      <div v-else class="ui-account-table"><div class="ui-account-table-head"><span>{{ $t('成员') }}</span><span>{{ $t('部门') }}</span><span>{{ $t('系统身份') }}</span><span>{{ $t('状态') }}</span><span /></div><ul class="account-list">
        <li v-for="user in users" :key="user.id" class="account-list-row">
          <div class="account-list-identity"><PersonAvatar :name="user.displayName" /><div><strong>{{ user.displayName }}<span v-if="user.id === accountSession.user.id">{{ $t("（当前账号）") }}</span></strong><span class="muted">{{ user.username }}</span></div></div><span class="ui-account-department">{{ user.role === 'admin' ? $t('无需部门') : departments.find(item => item.id === user.departmentId)?.name || $t('尚未分配部门') }}</span><span>{{ user.role === 'admin' ? $t('管理员') : $t('普通成员') }}</span><StatusBadge :tone="user.status === 'disabled' ? 'neutral' : 'success'">{{ user.status === 'disabled' ? $t('已停用') : $t('正常') }}</StatusBadge>
          <details class="ui-account-manage" @toggle="toggleMenu"><summary>{{ $t('管理') }}</summary><div popover="auto" class="account-row-actions" @toggle="menuVisibility">
            <button :disabled="busy" :aria-label="$t('{p0}：编辑显示名称', { p0: user.username })" @click="closeMenu($event); editingName = user; displayName = user.displayName; selected = null">{{ $t("编辑显示名称") }}</button>
            <AppSelect native-events v-if="user.role !== 'admin'" :value="user.departmentId || ''" :aria-label="$t('{p0}：所属部门', { p0: user.username })" :disabled="busy" @change="update(user, { departmentId: $event.target.value })"><option value="" disabled>{{ $t("尚未分配部门") }}</option><option v-for="department in departments" :key="department.id" :value="department.id">{{ department.name }}</option></AppSelect>
            <button v-if="user.role !== 'admin'" :disabled="busy" @click="update(user, { canCreateProjects: !user.canCreateProjects })">{{ user.canCreateProjects ? $t("取消创建项目资格") : $t("授予创建项目资格") }}</button>
            <button :disabled="busy" :aria-label="`${user.username}：${user.role === 'admin' ? $t('设为普通成员') : $t('设为管理员')}`" @click="user.role === 'admin' ? (closeMenu($event), demoting = user, memberDepartmentId = '') : update(user, { role: 'admin' })">{{ user.role === 'admin' ? $t("设为普通成员") : $t("设为管理员") }}</button>
            <button :disabled="busy || user.id === accountSession.user.id" :aria-label="`${user.username}：${user.status === 'disabled' ? $t('启用账号') : $t('停用账号')}`" @click="update(user, { status: user.status === 'disabled' ? 'active' : 'disabled' })">{{ user.status === 'disabled' ? $t("启用账号") : $t("停用账号") }}</button>
            <button :disabled="busy" :aria-label="$t('{p0}：重置密码', { p0: user.username })" @click="closeMenu($event); selected = user; resetPassword = ''; editingName = null">{{ $t("重置密码") }}</button>
          </div></details>
          <form v-if="editingName?.id === user.id" class="account-reset-form" @submit.prevent="displayName.trim() && update(user, { displayName: displayName.trim() })"><label :for="`name-${user.id}`">{{ user.username }} {{ $t("的显示名称") }}</label><input :id="`name-${user.id}`" v-model="displayName" required maxlength="80" :disabled="busy" /><div class="actions"><button type="submit" :disabled="busy || !displayName.trim()">{{ $t("保存显示名称") }}</button><button type="button" :disabled="busy" @click="editingName = null">{{ $t("取消") }}</button></div></form>
          <form v-if="selected?.id === user.id" class="account-reset-form" @submit.prevent="update(user, { password: resetPassword })"><label :for="`reset-${user.id}`">{{ user.username }} {{ $t("的新临时密码") }}</label><input :id="`reset-${user.id}`" v-model="resetPassword" type="password" autocomplete="new-password" required minlength="6" :disabled="busy" /><div class="actions"><button type="submit" :disabled="busy">{{ $t("确认重置密码") }}</button><button type="button" :disabled="busy" @click="selected = null; resetPassword = ''">{{ $t("取消") }}</button></div></form>
        </li>
      </ul></div>
    </section>
  </section>
</template>
