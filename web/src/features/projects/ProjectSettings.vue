<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { sameValue } from "./project-records.js";
import EditConflict from "./EditConflict.vue";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({ project: { type: Object, required: true } });
const emit = defineEmits(["saved"]);
const { data, saving, error, notice, save, perform } = useResource(() => appApi(`/projects/${props.project.id}/members`));
const settings = computed(() => props.project.settings || {});
function fields(project) {
  const settings = project.settings || {};
  return { name: project.name, remoteUrl: project.remoteUrl, description: project.description, ownerUserId: project.ownerUserId, initCommands: (settings.initCommands || []).join("\n"), manual: settings.prompts?.manual || "", tapd: settings.prompts?.tapd || "", workspaceId: settings.tapd?.workspaceId || "", imageHosts: (settings.tapd?.imageHosts || []).join("\n") };
}
const baseline = ref(fields(props.project)), latest = ref(null);
const form = reactive({ ...baseline.value, cookie: "", clearCookie: false });
let revision = props.project.revision;
const serverChanged = ref(false);
const lockedRemoteUrl = ref(props.project.repositoryEditable ? null : props.project.remoteUrl);
const repositoryEditable = computed(() => lockedRemoteUrl.value === null && props.project.repositoryEditable);
const repositoryNotice = ref("");
function retainLockedRepository(project) {
  if (project && !project.repositoryEditable) lockedRemoteUrl.value = project.remoteUrl;
  if (lockedRemoteUrl.value === null) return;
  if (form.remoteUrl !== lockedRemoteUrl.value) repositoryNotice.value = "项目已分配开发空间，未保存的 Git 仓库地址已恢复为服务器地址，其他修改仍保留。";
  form.remoteUrl = lockedRemoteUrl.value;
  baseline.value.remoteUrl = lockedRemoteUrl.value;
  if (latest.value) latest.value.remoteUrl = lockedRemoteUrl.value;
}
watch(() => [props.project.repositoryEditable, props.project.remoteUrl], () => retainLockedRepository(props.project));
const dirty = computed(() => Boolean(form.cookie || form.clearCookie) || Object.keys(fields(props.project)).some(key => !sameValue(form[key], baseline.value[key])));
watch(() => props.project.revision, () => {
  if (props.project.revision === revision) return;
  if (dirty.value || latest.value) { serverChanged.value = true; return; }
  const value = fields(props.project);
  Object.assign(form, value); baseline.value = value; retainLockedRepository(); revision = props.project.revision; serverChanged.value = false;
});
function loadLatest() { return perform(() => appApi(`/projects/${props.project.id}`), result => { latest.value = { ...fields(result.project), revision: result.project.revision }; retainLockedRepository(result.project); }, ""); }
function resolve(values, discard = false) {
  Object.assign(form, values);
  if (discard) { form.cookie = ""; form.clearCookie = false; }
  revision = latest.value.revision;
  baseline.value = { ...latest.value }; retainLockedRepository(); latest.value = null; serverChanged.value = false; error.value = "";
}
function submit() {
  if (latest.value) return;
  retainLockedRepository();
  if ((form.clearCookie || form.cookie || form.imageHosts.trim()) && !form.workspaceId.trim()) { error.value = "请填写 TAPD 项目 ID 后再修改 Cookie 或图片域名；当前修改尚未保存。"; return; }
  if (form.cookie && form.clearCookie) { error.value = "请在设置新 Cookie 和清除 Cookie 中选择一种操作。"; return; }
  const config = { initCommands: form.initCommands.split("\n").map(s => s.trim()).filter(Boolean), prompts: { manual: form.manual.trim() ? form.manual : null, tapd: form.tapd.trim() ? form.tapd : null } };
  if (form.workspaceId) config.tapd = { workspaceId: form.workspaceId, ...(form.cookie ? { cookie: form.cookie } : {}), clearCookie: form.clearCookie, imageHosts: form.imageHosts.split("\n").map(s => s.trim()).filter(Boolean) };
  return save(`/projects/${props.project.id}`, { name: form.name, remoteUrl: form.remoteUrl, description: form.description, ownerUserId: form.ownerUserId, settings: config, revision }, result => { revision = result.project.revision; baseline.value = fields(result.project); serverChanged.value = false; form.cookie = ""; form.clearCookie = false; emit("saved"); });
}
</script>
<template>
  <FormSection title="项目设置"><FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" /><FeedbackMessage :message="repositoryNotice" type="warning" /><p v-if="serverChanged" role="status" class="field-hint">服务器上的项目已更新，当前草稿仍保留。请点击“保留草稿，加载最新内容”核对并合并修改。</p><button type="button" :disabled="saving" @click="loadLatest">保留草稿，加载最新内容</button><EditConflict v-if="latest" :key="latest.revision" :base="baseline" :draft="form" :latest="latest" :people="data?.members?.map(m => ({ id: m.userId, username: m.username, displayName: m.displayName }))" @resolve="resolve" @discard="resolve(latest, true)" /><form class="project-form" @submit.prevent="submit"><label>项目名称<input v-model="form.name" required maxlength="80" /></label><label>说明<textarea v-model="form.description" rows="3" /></label><label>Git 仓库地址<input v-model="form.remoteUrl" aria-label="Git 仓库地址" required :readonly="!repositoryEditable" :disabled="saving" aria-describedby="project-settings-repository-hint" /><small id="project-settings-repository-hint" class="field-hint">{{ repositoryEditable ? "支持 HTTP(S) 或 SSH 克隆地址，请勿填写密码或令牌。" : "项目已有开发空间，Git 仓库地址已锁定，不能修改。" }}</small></label><label>负责人<select aria-label="负责人" v-model="form.ownerUserId"><option v-for="member in data?.members?.filter(m => m.status === 'active')" :key="member.userId" :value="member.userId">{{ member.displayName }}（{{ member.username }}）</option></select></label><label>初始化命令（每行一条）<textarea v-model="form.initCommands" rows="3" /></label><label>手动任务提示词<textarea v-model="form.manual" rows="4" /></label><label>TAPD 任务提示词<textarea v-model="form.tapd" rows="4" /></label><label>TAPD 项目 ID<input v-model="form.workspaceId" inputmode="numeric" /></label><label>TAPD Cookie<input v-model="form.cookie" type="password" autocomplete="new-password" /><small>{{ settings.tapd?.hasCookie ? '已配置，留空保留。' : '尚未配置。' }}</small></label><label class="permission-choice"><input v-model="form.clearCookie" type="checkbox" />清除已保存 Cookie</label><label>TAPD 图片域名（每行一个）<textarea v-model="form.imageHosts" rows="2" /></label><button type="submit" class="primary" :disabled="saving || Boolean(latest)">保存项目设置</button></form></FormSection>
</template>
