<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ChangeRecord from "./ChangeRecord.vue";
import { readableTime, readableValue } from "./project-records.js";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { assetTypes } from "./project-labels.js";
import ProjectFiles from "./ProjectFiles.vue";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({ projectId: { type: String, required: true }, permissions: { type: Array, required: true } });
const route = useRoute(), router = useRouter();
const endpoint = `/projects/${props.projectId}/assets`;
const members = ref([]), issueChoices = ref([]), issueQuery = ref("");
const query = ref(String(route.query.assetQuery || "")), type = ref(String(route.query.assetType || "")), offset = ref(Number(route.query.assetOffset) || 0), editing = ref(false), revealed = ref("");
const can = p => props.permissions.includes(p);
const { data, loading, saving, error, notice, reload, save, perform } = useResource(() => appApi(`${endpoint}?query=${encodeURIComponent(query.value)}&type=${type.value}&offset=${offset.value}`));
const { data: selected, loading: detailLoading, error: detailError, reload: loadDetail } = useResource(async () => {
  const id = route.query.asset;
  if (!id) return null;
  const asset = await appApi(`${endpoint}/${encodeURIComponent(id)}`);
  const issues = can("issue.view") ? await Promise.all(asset.issueIds.map(async issueId => {
    try { return await appApi(`/projects/${props.projectId}/issues/${issueId}`); }
    catch (failure) { if ([403, 404].includes(failure.status)) return { id: issueId, title: "事项不可查看" }; throw failure; }
  })) : [];
  return { ...asset, issues };
}, { immediate: false });
const historyOffset = ref(0), historyOpen = ref(false);
const { data: history, loading: historyLoading, error: historyError, reload: loadHistory } = useResource(() => selected.value ? appApi(`${endpoint}/${selected.value.id}/history?offset=${historyOffset.value}`) : null, { immediate: false });
let retainedAssetId;
watch(() => route.query.asset, id => { if (retainedAssetId && id === retainedAssetId) { retainedAssetId = undefined; return; } editing.value = false; form.secret = ""; revealed.value = ""; selected.value = null; historyOpen.value = false; history.value = null; void loadHistory(); void loadDetail(); });
const empty = () => ({ type: "note", title: "", content: "", url: "", username: "", environment: "development", category: "", tags: "", ownerId: "", expiresAt: "", issueIds: [], secret: "", clearSecret: false });
const form = reactive(empty());
let draftVersion = 0;
watch(form, () => { draftVersion++; }, { flush: "sync" });
const secretType = computed(() => ["credential", "token"].includes(form.type));
function edit(asset) {
  if (saving.value) return;
  editing.value = true; revealed.value = ""; historyOpen.value = false; history.value = null;
  issueChoices.value = [...(asset?.issues || [])];
  Object.assign(form, empty(), asset || {}, { tags: (asset?.tags || []).join(", "), issueIds: [...(asset?.issueIds || [])], expiresAt: asset?.expiresAt?.slice(0, 10) || "", secret: "", clearSecret: false });
  void perform(() => appApi(`/projects/${props.projectId}/members`), result => { members.value = result.members.filter(m => m.status === "active" && m.userStatus === "active"); }, "");
}
function searchIssues() { return perform(() => appApi(`/projects/${props.projectId}/issues?query=${encodeURIComponent(issueQuery.value)}&limit=100`), result => { issueChoices.value = [...new Map([...issueChoices.value.filter(issue => form.issueIds.includes(issue.id)), ...result.items].map(issue => [issue.id, issue])).values()]; }, ""); }
function listQuery() { return { ...route.query, tab: "assets", assetQuery: query.value || undefined, assetType: type.value || undefined, assetOffset: offset.value || undefined }; }
function selectAsset(asset) { if (!saving.value) void router.push({ query: { ...listQuery(), asset: asset.id } }); }
function back() { void router.push({ query: { ...listQuery(), asset: undefined } }); }
function search() { void router.replace({ query: listQuery() }); void reload(); }
void loadDetail();
watch(() => props.permissions, permissions => { if (!permissions.includes("asset.secret.view")) revealed.value = ""; if (!permissions.includes("asset.secret.edit")) form.secret = ""; });
function submit() {
  const submittedVersion = draftVersion, submittedSecret = form.secret, submittedClearSecret = form.clearSecret;
  const input = { type: form.type, title: form.title, content: form.content, url: form.url, username: form.username, environment: form.environment, category: form.category, tags: form.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean), ownerId: form.ownerId || null, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null, issueIds: form.issueIds };
  if (selected.value) input.revision = selected.value.revision;
  if (can("asset.secret.edit") && (form.secret || form.clearSecret)) input.secret = form.clearSecret ? null : form.secret;
  const assetId = selected.value?.id;
  return save(`${endpoint}${selected.value ? `/${selected.value.id}` : ""}`, input, asset => {
    if ((route.query.asset || undefined) !== assetId) return;
    const changed = draftVersion !== submittedVersion;
    if (form.secret === submittedSecret) form.secret = "";
    if (form.clearSecret === submittedClearSecret) form.clearSecret = false;
    if (changed) {
      selected.value = { ...asset, issues: issueChoices.value.filter(issue => asset.issueIds.includes(issue.id)) };
      if (!assetId) retainedAssetId = asset.id;
    } else { editing.value = false; if (assetId) void loadDetail(); }
    if (!assetId) void router.push({ query: { ...listQuery(), asset: asset.id } });
    void reload();
  });
}
function reveal() { const id = selected.value.id; return save(`${endpoint}/${id}/secret`, {}, value => { if (route.query.asset === id && can("asset.secret.view")) revealed.value = value.secret || "（未设置）"; }, "本次敏感字段访问已记录。"); }
function readHistory(offset = 0) { historyOpen.value = true; historyOffset.value = offset; return loadHistory(); }
function person(id) { return selected.value?.people?.find(p => p.id === id)?.displayName || (id ? "历史成员" : "未分派"); }
</script>
<template>
  <section><header class="project-heading"><div><h2>项目资产</h2><p class="muted">备忘录、文档、环境地址及非生产凭据。资产不会发送给 Agent。</p></div><button v-if="can('asset.edit') && !route.query.asset" class="primary" :disabled="saving" @click="edit(null)">新增资产</button></header><FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="detailError" type="error" /><p v-if="detailLoading" role="status">正在读取资产详情…</p><button v-if="route.query.asset && !selected" @click="back">返回资产列表</button><FeedbackMessage :message="notice" type="success" />
    <FormSection v-if="editing" :title="selected ? '编辑资产' : '新增资产'"><form class="project-form" @submit.prevent="submit"><div class="form-columns"><label>类型<select aria-label="类型" v-model="form.type"><option v-for="(label, id) in assetTypes" :key="id" :value="id">{{ label }}</option></select></label><label>环境<select aria-label="环境" v-model="form.environment"><option value="development">开发</option><option value="test">测试</option><option value="staging">预发布</option></select></label></div><label>标题<input v-model="form.title" required maxlength="200" /></label><label>内容<textarea v-model="form.content" rows="5" maxlength="60000" /></label><label>链接<input v-model="form.url" type="url" /></label><label v-if="form.type === 'credential'">用户名<input v-model="form.username" autocomplete="off" /></label><template v-if="secretType && can('asset.secret.edit')"><label>敏感值<input v-model="form.secret" type="password" autocomplete="new-password" /><small>留空保留已有值。只存储非生产环境凭据。</small></label><label v-if="selected?.hasSecret" class="permission-choice"><input v-model="form.clearSecret" type="checkbox" />清除已保存敏感值</label></template><div class="form-columns"><label>分类<input v-model="form.category" /></label><label>标签（逗号分隔）<input v-model="form.tags" /></label></div><label>负责人<select aria-label="负责人" v-model="form.ownerId"><option value="">未分派</option><option v-if="form.ownerId && !members.some(m => m.userId === form.ownerId)" :value="form.ownerId">{{ person(form.ownerId) }}（当前不可分派）</option><option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.displayName }}（{{ member.username }}）</option></select></label><label>有效期（可选）<input v-model="form.expiresAt" type="date" /></label><section><h3>关联事项</h3><ul><li v-for="id in form.issueIds" :key="id">{{ issueChoices.find(issue => issue.id === id)?.title || '事项不可查看' }} <button type="button" @click="form.issueIds = form.issueIds.filter(value => value !== id)">移除关联</button></li></ul><template v-if="can('issue.view')"><label>关联事项<input v-model="issueQuery" placeholder="搜索标题或内容" /></label><button type="button" :disabled="saving" @click="searchIssues">查询事项</button><label v-for="issue in issueChoices" :key="issue.id" class="permission-choice"><input v-model="form.issueIds" type="checkbox" :value="issue.id" />#{{ issue.number }} {{ issue.title }}</label></template><p class="field-hint">已关联 {{ form.issueIds.length }} 条事项。</p></section><div class="actions"><button class="primary" type="submit" :disabled="saving">保存资产</button><button type="button" :disabled="saving" @click="editing = false; form.secret = ''">取消</button></div></form></FormSection>
    <FormSection v-else-if="selected" :title="selected.title"><div class="actions"><button :disabled="saving" @click="back">返回资产列表</button><button v-if="can('asset.edit')" @click="edit(selected)">编辑资产</button><button :disabled="saving" @click="readHistory(0)">修订历史</button></div><p class="muted">{{ assetTypes[selected.type] }} · {{ readableValue('environment', selected.environment) }} · {{ selected.category }} · 修订 {{ selected.revision }}</p><p>负责人：{{ person(selected.ownerId) }}</p><p>有效期：{{ selected.expiresAt?.slice(0, 10) || '未设置' }}</p><p>标签：{{ selected.tags.join('、') || '无' }}</p><section><h3>关联事项</h3><ul><li v-for="id in selected.issueIds" :key="id"><RouterLink v-if="can('issue.view') && selected.issues.find(issue => issue.id === id)?.number" :to="{ path: route.path, query: { tab: selected.issues.find(issue => issue.id === id).type === 'bug' ? 'bugs' : 'issues', issue: id } }">#{{ selected.issues.find(issue => issue.id === id).number }} {{ selected.issues.find(issue => issue.id === id).title }}</RouterLink><span v-else>事项不可查看</span></li></ul><p v-if="!selected.issueIds.length" class="muted">暂无关联事项。</p></section><p class="project-text">{{ selected.content }}</p><p v-if="selected.url"><a :href="selected.url" target="_blank" rel="noopener noreferrer">{{ selected.url }}</a></p><p v-if="selected.username">用户名：{{ selected.username }}</p><p v-if="selected.hasSecret">敏感值：{{ revealed || '••••••••' }}</p><div v-if="selected.hasSecret && can('asset.secret.view')" class="actions"><button v-if="!revealed" :disabled="saving" @click="reveal">显示敏感值</button><button v-else @click="revealed = ''">隐藏敏感值</button></div><section v-if="historyOpen" aria-label="资产修订历史"><p v-if="historyLoading" role="status">正在读取修订历史…</p><FeedbackMessage :message="historyError" type="error" /><ul v-if="history" class="project-records"><li v-for="entry in history.items" :key="entry.id"><strong>修订 {{ entry.revision }}</strong> · {{ readableTime(entry.createdAt) }} · {{ history.people?.find(p => p.id === entry.actorId)?.displayName || '历史成员' }}<ChangeRecord :entry="entry" :people="[...(selected.people || []), ...(history.people || [])]" /></li></ul><p v-if="history && !history.items.length">暂无修订记录。</p><div class="actions"><button v-if="historyOffset" :disabled="historyLoading" @click="readHistory(Math.max(0, historyOffset - 30))">较新修订</button><button v-if="history?.nextOffset != null" :disabled="historyLoading" @click="readHistory(history.nextOffset)">更早修订</button></div></section><ProjectFiles :key="selected.id" :endpoint="`${endpoint}/${selected.id}`" :can-edit="can('asset.edit')" /></FormSection>
    <template v-if="!route.query.asset && !editing"><form class="project-filter" @submit.prevent="offset = 0; search()"><input v-model="query" aria-label="搜索资产" placeholder="搜索资产" /><select v-model="type" aria-label="资产类型"><option value="">全部类型</option><option v-for="(label, id) in assetTypes" :key="id" :value="id">{{ label }}</option></select><button type="submit">查询</button></form><p v-if="loading" role="status">正在读取资产…</p><div class="project-grid"><button v-for="asset in data?.items" :key="asset.id" class="project-card" :disabled="saving" @click="selectAsset(asset)"><small>{{ assetTypes[asset.type] }} · {{ readableValue('environment', asset.environment) }}</small><strong>{{ asset.title }}</strong><span>{{ asset.category }} {{ asset.tags.join(' · ') }}</span><small v-if="asset.hasSecret">含受权限保护的敏感字段</small></button></div><p v-if="data && !data.items.length" class="project-empty">暂无资产。</p><div class="actions"><button v-if="offset" @click="offset = Math.max(0, offset - 30); search()">上一页</button><button v-if="data?.nextOffset != null" @click="offset = data.nextOffset; search()">下一页</button></div></template>
  </section>
</template>
