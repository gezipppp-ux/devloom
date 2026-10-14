<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { ArrowRightOutlined, ClockCircleOutlined, InfoCircleOutlined, PlusOutlined, ReloadOutlined, TagOutlined } from "@antdv-next/icons";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import releaseNameRules from "../../../../shared/project-release-name.json";
import ProjectReleaseDetail from "./ProjectReleaseDetail.vue";
import ReleaseSummary from "./ReleaseSummary.vue";
const props = defineProps({ projectId: { type: String, required: true }, projectName: String, canManage: Boolean, headerAction: Boolean });
const route = useRoute(), router = useRouter();
const scopeOpen = computed(() => Boolean(route.query.release));
const includeArchived = ref(false), editing = ref(false);
const form = reactive({ id: "", name: "", description: "", targetDate: "", revision: 0 });
const nameInput = ref();
const archiveDialog = ref(), archiveTarget = ref(null);
const endpoint = `/projects/${props.projectId}/releases`;
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(`${endpoint}?includeArchived=${scopeOpen.value || includeArchived.value}`));
const nameTouched = ref(false);
const releases = computed(() => data.value?.items || []);
const selectedRelease = computed(() => releases.value.find(release => release.id === route.query.release));
const controlsLocked = computed(() => loading.value || saving.value || editing.value);
defineExpose({ create: () => edit(), creationDisabled: controlsLocked });
const namePattern = new RegExp(`^(?:${releaseNameRules.pattern})$`);
const nameInvalid = computed(() => form.name.length > releaseNameRules.maxLength || form.name !== form.name.trim() || !namePattern.test(form.name));
watch(() => props.canManage, allowed => {
  if (!allowed) { editing.value = false; closeArchive(); }
});
watch(() => route.query.release, () => { editing.value = false; closeArchive(); });
async function edit(release = {}) {
  if (!props.canManage || saving.value) return;
  Object.assign(form, { id: "", name: "", description: "", targetDate: "", revision: 0 }, release, { targetDate: release.targetDate || "" });
  nameTouched.value = false;
  editing.value = true;
  await nextTick();
  nameInput.value?.focus();
}
async function cancelEdit() {
  if (saving.value) return;
  editing.value = false;
}
function viewScope(release) {
  if (controlsLocked.value) return;
  void router.push({ query: { ...route.query, release: release.id } });
}
async function back() { if (saving.value) return; await router.push({ query: { ...route.query, release: undefined } }); void reload(); }
function submit() {
  if (!props.canManage) return;
  nameTouched.value = true;
  if (nameInvalid.value) return;
  return save(`${endpoint}${form.id ? `/${form.id}` : ''}`, { name: form.name, description: form.description, targetDate: form.targetDate || null, ...(form.id ? { revision: form.revision } : {}) }, () => { editing.value = false; void reload(); });
}
function requestArchive(release) {
  archiveTarget.value = { ...release };
  archiveDialog.value.showModal();
}
function closeArchive() {
  archiveDialog.value?.close();
  archiveTarget.value = null;
}
function archive(release) {
  if (!props.canManage || !release) return;
  return save(`${endpoint}/${release.id}/${release.status === 'archived' ? 'restore' : 'archive'}`, { revision: release.revision }, () => { closeArchive(); if (release.status !== 'archived' && !includeArchived.value && route.query.release === release.id) void router.push({ query: { ...route.query, release: undefined } }).then(reload); else void reload(); }, release.status === 'archived' ? '版本已恢复。' : '版本已归档。');
}
</script>
<template>
  <section class="project-releases" :aria-label="$t('版本')">
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <template v-if="!scopeOpen">
    <header v-if="!headerAction" class="project-heading release-heading">
      <div><div class="release-title"><h2 id="project-releases-title">{{ $t("版本") }}</h2><span v-if="data" class="release-count" :aria-label="$t('版本数量')">{{ releases.length }}</span></div><p class="field-hint">{{ $t("用清晰的范围，推动每一次交付。") }}</p></div>
      <button v-if="canManage && !headerAction" class="primary" :disabled="controlsLocked" @click="edit()"><PlusOutlined aria-hidden="true" />{{ $t("新建版本") }}</button>
    </header>
    <div class="release-toolbar"><span v-if="projectName" class="release-project-badge">{{ projectName }}</span><div class="actions"><button class="release-quiet-button" :aria-label="$t('刷新版本')" :title="$t('刷新版本')" :disabled="controlsLocked" @click="reload"><ReloadOutlined aria-hidden="true" /></button><label class="release-archive-filter"><input v-model="includeArchived" type="checkbox" :aria-label="$t('包含已归档版本')" :disabled="controlsLocked" @change="reload" /><ClockCircleOutlined aria-hidden="true" />{{ $t('显示已归档') }}</label></div></div>
    <p v-if="loading" class="release-placeholder" role="status">{{ $t("正在读取版本…") }}</p>
    <ul v-else-if="releases.length" class="release-list" :aria-label="$t('版本列表')">
      <li v-for="release in releases" :key="release.id">
        <article :aria-label="release.name">
          <ReleaseSummary :release="release"><button class="release-scope-button" :disabled="controlsLocked" @click="viewScope(release)"><ArrowRightOutlined aria-hidden="true" />{{ $t("查看范围") }}</button></ReleaseSummary>
        </article>
      </li>
    </ul>
    <div v-else-if="error && !data" class="release-placeholder"><p>{{ $t("版本加载失败，请刷新重试。") }}</p></div>
    <div v-else class="release-empty"><TagOutlined aria-hidden="true" /><h3>{{ $t("暂无版本") }}</h3><p>{{ canManage ? $t("创建第一个版本，安排项目的交付内容。") : $t("项目尚未创建版本，可先查看未排期事项。") }}</p></div>
    <p class="release-note"><InfoCircleOutlined aria-hidden="true" /><span>{{ $t("归档要求所有事项已完成或取消，并且没有未结束开发任务。归档版本中的事项与任务只读。") }}</span></p>
    </template>
    <ProjectReleaseDetail v-else-if="selectedRelease" :project-id="projectId" :project-name="projectName" :release="selectedRelease" :can-manage="canManage" :disabled="controlsLocked" @back="back" @edit="edit(selectedRelease)" @archive="selectedRelease.status === 'archived' ? archive(selectedRelease) : requestArchive(selectedRelease)" />
    <div v-else><p role="status">{{ loading ? $t('正在读取版本…') : $t('版本不可查看或已移出当前列表。') }}</p><button @click="back">{{ $t('返回版本') }}</button><button v-if="error" @click="reload">{{ $t('重试') }}</button><FeedbackMessage :message="error" type="error" /></div>
    <ModalDialog :open="editing && canManage" :title="form.id ? $t('编辑版本') : $t('新建版本')" @close="cancelEdit">
      <FeedbackMessage :message="error" type="error" />
      <form class="project-form release-form" @submit.prevent="submit">
        <div>
          <label>{{ $t("版本名称") }}<input ref="nameInput" v-model="form.name" autofocus required :maxlength="releaseNameRules.maxLength" :pattern="releaseNameRules.pattern" :title="$t(releaseNameRules.hint)" :disabled="saving" placeholder="v0.5.9" :aria-invalid="nameTouched && nameInvalid" :aria-describedby="nameTouched && nameInvalid ? 'release-name-hint release-name-error' : 'release-name-hint'" @blur="nameTouched = true" @invalid="nameTouched = true" /></label>
          <p id="release-name-hint" class="field-hint">{{ $t(releaseNameRules.hint) }}</p>
          <p v-if="nameTouched && nameInvalid" id="release-name-error" class="error" role="alert">{{ $t(releaseNameRules.error) }}</p>
        </div>
        <label>{{ $t("版本说明") }}<textarea v-model="form.description" :disabled="saving" maxlength="4000" rows="5" :placeholder="$t('填写本次版本的说明（可选）')" /></label>
        <label>{{ $t('目标日期（可选）') }}<input v-model="form.targetDate" type="date" min="0001-01-01" max="9999-12-31" :disabled="saving" /></label>
        <div class="actions"><button class="primary" :disabled="saving">{{ saving ? $t("正在保存…") : $t("保存版本") }}</button><button type="button" :disabled="saving" @click="cancelEdit">{{ $t("取消") }}</button></div>
      </form>
    </ModalDialog>
    <dialog ref="archiveDialog" class="workspace-dialog release-archive-dialog" aria-labelledby="release-archive-title" @cancel.prevent="!saving && closeArchive()">
      <h2 id="release-archive-title">{{ $t("归档版本") }}</h2>
      <p>{{ $t("确认归档") }} <strong>{{ archiveTarget?.name }}</strong>{{ $t("？归档后，该版本中的事项与开发任务将变为只读。") }}</p>
      <p class="field-hint">{{ $t("所有事项须已完成或取消，且没有未结束的开发任务。") }}</p>
      <div class="actions"><button :disabled="saving" autofocus @click="closeArchive">{{ $t("取消") }}</button><button class="primary" :disabled="saving || !canManage" @click="archive(archiveTarget)">{{ saving ? $t("正在归档…") : $t("确认归档版本") }}</button></div>
    </dialog>
  </section>
</template>
