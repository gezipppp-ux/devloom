<script setup>
import { computed, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import releaseNameRules from "../../../../shared/project-release-name.json";
const props = defineProps({ projectId: { type: String, required: true }, canManage: Boolean });
const includeArchived = ref(false), editing = ref(false), form = reactive({ id: "", name: "", description: "", revision: 0 });
const endpoint = `/projects/${props.projectId}/releases`;
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(`${endpoint}?includeArchived=${includeArchived.value}`));
const nameTouched = ref(false);
const namePattern = new RegExp(`^(?:${releaseNameRules.pattern})$`);
const nameInvalid = computed(() => form.name.length > releaseNameRules.maxLength || form.name !== form.name.trim() || !namePattern.test(form.name));
function edit(release = {}) { Object.assign(form, { id: "", name: "", description: "", revision: 0 }, release); nameTouched.value = false; editing.value = true; }
function submit() {
  nameTouched.value = true;
  if (nameInvalid.value) return;
  return save(`${endpoint}${form.id ? `/${form.id}` : ''}`, { name: form.name, description: form.description, ...(form.id ? { revision: form.revision } : {}) }, () => { editing.value = false; void reload(); });
}
function archive(release) { return save(`${endpoint}/${release.id}/${release.status === 'archived' ? 'restore' : 'archive'}`, { revision: release.revision }, () => { void reload(); }); }
</script>
<template>
  <section class="project-detail">
    <header class="project-heading"><h2>发布版本</h2><button v-if="canManage" class="primary" :disabled="saving" @click="edit()">新建版本</button></header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <label class="permission-choice"><input v-model="includeArchived" type="checkbox" @change="reload" />包含已归档版本</label>
    <button :disabled="loading || saving" @click="reload">刷新版本</button>
    <form v-if="editing && canManage" class="project-form project-section" @submit.prevent="submit">
      <div>
        <label>版本名称<input v-model="form.name" required :maxlength="releaseNameRules.maxLength" :pattern="releaseNameRules.pattern" :title="releaseNameRules.hint" :disabled="saving" placeholder="v0.5.9" :aria-invalid="nameTouched && nameInvalid" :aria-describedby="nameTouched && nameInvalid ? 'release-name-hint release-name-error' : 'release-name-hint'" @blur="nameTouched = true" @invalid="nameTouched = true" /></label>
        <p id="release-name-hint" class="field-hint">{{ releaseNameRules.hint }}</p>
        <p v-if="nameTouched && nameInvalid" id="release-name-error" class="error" role="alert">{{ releaseNameRules.error }}</p>
      </div>
      <label>版本说明<textarea v-model="form.description" :disabled="saving" rows="3" /></label>
      <div class="actions"><button class="primary" :disabled="saving">保存版本</button><button type="button" :disabled="saving" @click="editing = false">取消</button></div>
    </form>
    <p v-if="loading" role="status">正在读取版本…</p>
    <ul v-else class="project-issue-list"><li v-for="release in data?.items" :key="release.id"><div class="project-issue-link"><strong>{{ release.name }}</strong><p>{{ release.description }}</p><small>{{ release.status === 'archived' ? '已归档 · 内容只读' : '进行中' }}</small><div v-if="canManage" class="actions"><button v-if="release.status !== 'archived'" :disabled="saving" @click="edit(release)">编辑版本</button><button :disabled="saving" @click="archive(release)">{{ release.status === 'archived' ? '恢复版本' : '确认归档版本' }}</button></div></div></li></ul>
    <p v-if="data && !data.items.length" class="muted">暂无版本，可先维护未排期事项。</p>
    <p class="field-hint">归档要求所有事项已完成或取消，并且没有未结束开发任务。归档版本中的事项与任务只读。</p>
  </section>
</template>
