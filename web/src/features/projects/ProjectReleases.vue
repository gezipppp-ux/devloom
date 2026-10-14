<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { InfoCircleOutlined, PlusOutlined, ReloadOutlined, TagOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { readableTime } from "./project-records.js";
import releaseNameRules from "../../../../shared/project-release-name.json";
const props = defineProps({ projectId: { type: String, required: true }, canManage: Boolean });
const includeArchived = ref(false), editing = ref(false), selectedId = ref("");
const form = reactive({ id: "", name: "", description: "", revision: 0 });
const nameInput = ref(), newButton = ref(), editButton = ref();
const archiveDialog = ref(), archiveTarget = ref(null);
const endpoint = `/projects/${props.projectId}/releases`;
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(`${endpoint}?includeArchived=${includeArchived.value}`));
const nameTouched = ref(false);
const releases = computed(() => data.value?.items || []);
const selectedRelease = computed(() => releases.value.find(release => release.id === selectedId.value));
const controlsLocked = computed(() => loading.value || saving.value || editing.value);
const namePattern = new RegExp(`^(?:${releaseNameRules.pattern})$`);
const nameInvalid = computed(() => form.name.length > releaseNameRules.maxLength || form.name !== form.name.trim() || !namePattern.test(form.name));
watch(releases, items => {
  if (!items.some(release => release.id === selectedId.value)) selectedId.value = items[0]?.id || "";
});
watch(() => props.canManage, allowed => {
  if (!allowed) { editing.value = false; closeArchive(); }
});
async function edit(release = {}) {
  if (!props.canManage || saving.value) return;
  Object.assign(form, { id: "", name: "", description: "", revision: 0 }, release);
  nameTouched.value = false;
  editing.value = true;
  await nextTick();
  nameInput.value?.focus();
}
async function cancelEdit() {
  if (saving.value) return;
  editing.value = false;
  await nextTick();
  (form.id ? editButton.value : newButton.value)?.focus();
}
function submit() {
  if (!props.canManage) return;
  nameTouched.value = true;
  if (nameInvalid.value) return;
  return save(`${endpoint}${form.id ? `/${form.id}` : ''}`, { name: form.name, description: form.description, ...(form.id ? { revision: form.revision } : {}) }, result => { selectedId.value = result.id; editing.value = false; void reload(); });
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
  return save(`${endpoint}/${release.id}/${release.status === 'archived' ? 'restore' : 'archive'}`, { revision: release.revision }, () => { closeArchive(); void reload(); }, release.status === 'archived' ? '版本已恢复。' : '版本已归档。');
}
</script>
<template>
  <section class="project-releases" aria-labelledby="project-releases-title">
    <header class="project-heading release-heading">
      <div class="release-title"><h2 id="project-releases-title">{{ $t("发布版本") }}</h2><span v-if="data" class="release-count" :aria-label="$t(&quot;版本数量&quot;)">{{ releases.length }}</span></div>
      <button v-if="canManage" ref="newButton" class="primary" :disabled="controlsLocked" @click="edit()"><PlusOutlined aria-hidden="true" />{{ $t("新建版本") }}</button>
    </header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <div class="release-toolbar">
      <label class="permission-choice"><input v-model="includeArchived" type="checkbox" :disabled="controlsLocked" @change="reload" />{{ $t("包含已归档版本") }}</label>
      <button class="release-quiet-button" :disabled="controlsLocked" @click="reload"><ReloadOutlined aria-hidden="true" />{{ $t("刷新版本") }}</button>
    </div>
    <p v-if="loading" class="release-placeholder" role="status">{{ $t("正在读取版本…") }}</p>
    <div v-else-if="releases.length || editing" class="release-workbench">
      <nav class="release-sidebar" :aria-label="$t(&quot;版本列表&quot;)">
        <p class="release-list-label">{{ $t("版本列表") }}</p>
        <ul class="release-list">
          <li v-for="release in releases" :key="release.id">
            <button class="release-list-button" :aria-pressed="release.id === selectedId && (!editing || !!form.id)" :disabled="saving || editing" @click="selectedId = release.id">
              <span class="release-list-title"><strong>{{ release.name }}</strong><span v-if="release.status !== 'archived'" class="release-status-dot" aria-hidden="true"></span></span>
              <span class="release-list-meta">{{ release.status === 'archived' ? $t("已归档 · 只读") : $t("进行中") }}</span>
            </button>
          </li>
        </ul>
        <p v-if="!releases.length" class="release-list-label">{{ $t("暂无版本") }}</p>
      </nav>
      <div class="release-detail">
        <form v-if="editing && canManage" class="project-form release-form" @submit.prevent="submit" @keydown.esc.prevent="cancelEdit">
          <h3>{{ form.id ? $t("编辑版本") : $t("新建版本") }}</h3>
          <div>
            <label>{{ $t("版本名称") }}<input ref="nameInput" v-model="form.name" required :maxlength="releaseNameRules.maxLength" :pattern="releaseNameRules.pattern" :title="$t(releaseNameRules.hint)" :disabled="saving" placeholder="v0.5.9" :aria-invalid="nameTouched && nameInvalid" :aria-describedby="nameTouched && nameInvalid ? 'release-name-hint release-name-error' : 'release-name-hint'" @blur="nameTouched = true" @invalid="nameTouched = true" /></label>
            <p id="release-name-hint" class="field-hint">{{ $t(releaseNameRules.hint) }}</p>
            <p v-if="nameTouched && nameInvalid" id="release-name-error" class="error" role="alert">{{ $t(releaseNameRules.error) }}</p>
          </div>
          <label>{{ $t("版本说明") }}<textarea v-model="form.description" :disabled="saving" maxlength="4000" rows="5" :placeholder="$t(&quot;填写本次版本的说明（可选）&quot;)" /></label>
          <div class="actions"><button class="primary" :disabled="saving">{{ saving ? $t("正在保存…") : $t("保存版本") }}</button><button type="button" :disabled="saving" @click="cancelEdit">{{ $t("取消") }}</button></div>
        </form>
        <article v-else-if="selectedRelease" aria-labelledby="release-detail-title">
          <header class="release-detail-heading">
            <div class="release-title"><h3 id="release-detail-title">{{ selectedRelease.name }}</h3><span class="release-status" :class="{ 'release-status-archived': selectedRelease.status === 'archived' }">{{ selectedRelease.status === 'archived' ? $t("已归档") : $t("进行中") }}</span></div>
            <div v-if="canManage" class="release-actions">
              <button v-if="selectedRelease.status !== 'archived'" ref="editButton" class="release-quiet-button" :disabled="saving" @click="edit(selectedRelease)">{{ $t("编辑版本") }}</button>
              <button class="release-quiet-button" :disabled="saving" @click="selectedRelease.status === 'archived' ? archive(selectedRelease) : requestArchive(selectedRelease)">{{ saving ? $t("正在处理…") : selectedRelease.status === 'archived' ? $t("恢复版本") : $t("归档版本") }}</button>
            </div>
          </header>
          <h4 class="release-description-label">{{ $t("版本说明") }}</h4>
          <p class="release-description" :class="{ muted: !selectedRelease.description }">{{ selectedRelease.description || $t("暂无版本说明") }}</p>
          <footer class="release-detail-footer"><span>{{ $t("最近更新") }} {{ readableTime(selectedRelease.updatedAt) }}</span><span>{{ selectedRelease.status === 'archived' ? $t("归档内容只读") : canManage ? $t("版本信息可编辑") : $t("仅可查看版本") }}</span></footer>
        </article>
      </div>
    </div>
    <div v-else-if="error && !data" class="release-placeholder"><p>{{ $t("版本加载失败，请刷新重试。") }}</p></div>
    <div v-else class="release-empty"><TagOutlined aria-hidden="true" /><h3>{{ $t("暂无版本") }}</h3><p>{{ canManage ? $t("创建第一个版本，安排项目的交付内容。") : $t("项目尚未创建版本，可先查看未排期事项。") }}</p></div>
    <p class="release-note"><InfoCircleOutlined aria-hidden="true" /><span>{{ $t("归档要求所有事项已完成或取消，并且没有未结束开发任务。归档版本中的事项与任务只读。") }}</span></p>
    <dialog ref="archiveDialog" class="workspace-dialog release-archive-dialog" aria-labelledby="release-archive-title" @cancel.prevent="!saving && closeArchive()">
      <h2 id="release-archive-title">{{ $t("归档版本") }}</h2>
      <p>{{ $t("确认归档") }} <strong>{{ archiveTarget?.name }}</strong>{{ $t("？归档后，该版本中的事项与开发任务将变为只读。") }}</p>
      <p class="field-hint">{{ $t("所有事项须已完成或取消，且没有未结束的开发任务。") }}</p>
      <div class="actions"><button :disabled="saving" autofocus @click="closeArchive">{{ $t("取消") }}</button><button class="primary" :disabled="saving || !canManage" @click="archive(archiveTarget)">{{ saving ? $t("正在归档…") : $t("确认归档版本") }}</button></div>
    </dialog>
  </section>
</template>
