<script setup>
import PublishDelivery from "./PublishDelivery.vue";
import ReworkDevelopment from "./ReworkDevelopment.vue";
import { useRouter } from "vue-router";
import AppSelect from "../../shared/components/AppSelect.vue";
import { formatDate, translate } from "../../shared/i18n/index.js";
import { usePageTitle } from "../../shared/components/page-title.js";
import { computed, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import PageHeader from "../../shared/components/PageHeader.vue";
import StatusBadge from "../../shared/components/StatusBadge.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import MarkdownContent from "../../shared/components/MarkdownContent.vue";
import ModalDialog from "../../shared/components/ModalDialog.vue";

const props = defineProps({ projectId: { type: String, required: true }, deliveryId: { type: String, required: true } });
const emit = defineEmits(["back"]);
const endpoint = `/projects/${props.projectId}/deliveries/${props.deliveryId}`;
const { data, loading, saving, error, reload, save } = useResource(() => appApi(endpoint));
usePageTitle(() => [error.value ? "" : data.value?.delivery.title, translate("交付")]);
const router = useRouter(), resubmitting = ref(false), returning = ref(false);
const reviewers = useResource(() => appApi(`/projects/${props.projectId}/reviewers`));
const reviewerId = ref(""), checked = ref([]), note = ref(""), returnNote = ref("");
const canReview = computed(() => data.value?.canReview && data.value?.permissions.includes("deliverable.review") && data.value.delivery.status === "pending" && data.value.issue?.release?.status !== "archived");
const outcome = trigger => data.value?.issue?.workflowActions?.find(edge => edge.trigger === trigger);
const allowed = trigger => !data.value?.issue || Boolean(outcome(trigger)?.allowed);
const label = (trigger, fallback) => outcome(trigger)?.name || (data.value?.issue ? '' : fallback);
const returnReasonRequired = computed(() => outcome("verification.returned")?.requiresReason ?? true);
const acceptReasonRequired = computed(() => outcome("verification.accepted")?.requiresReason === true);
const allChecked = computed(() => checked.value.length === data.value?.delivery.checklist.length);
const needsStart = computed(() => data.value?.issue && !allowed("verification.accepted") && !allowed("verification.returned") && allowed("verification.started"));
watch(canReview, allowed => { if (!allowed) { checked.value = []; note.value = ""; returnNote.value = ""; returning.value = false; } });
function resubmitted(value) { resubmitting.value = false; void router.push({ name: "deliveries", query: { projectId: props.projectId, delivery: value.id } }); }
function reassign() { return save(`${endpoint}/assign`, { revision: data.value.delivery.revision, reviewerId: reviewerId.value }, () => { reviewerId.value = ""; void reload(); }); }
function begin() { return save(`${endpoint}/start`, { revision: data.value.delivery.revision }, () => { void reload(); }); }
function toggleAll() { checked.value = allChecked.value ? [] : data.value.delivery.checklist.map((_, index) => index); }
function review(status) {
  if (!canReview.value) return;
  return save(`${endpoint}/review`, { revision: data.value.delivery.revision, status, checkedItems: checked.value, reviewNote: status === "returned" ? returnNote.value : note.value }, () => { returning.value = false; void reload(); }, status === "accepted" ? "交付已通过验收。" : "已退回交付，并记录原因。");
}
</script>

<template>
  <button class="ui-back" @click="emit('back')">{{ $t("← 返回交付") }}</button>
  <FeedbackMessage :message="error" type="error" />
  <button v-if="error" @click="reload">{{ $t("重新读取") }}</button>
  <p v-if="loading && !data" role="status">{{ $t("正在读取交付…") }}</p>
  <template v-if="data">
    <PageHeader :title="data.delivery.title" :description="$t('对照事项与交付内容，记录验证结果。')">
      <StatusBadge :tone="data.delivery.status === 'accepted' ? 'success' : 'neutral'">{{ { pending: $t("待验证"), accepted: $t("已通过"), returned: $t("已退回") }[data.delivery.status] }}</StatusBadge>
    </PageHeader>
    <div class="delivery-detail-layout">
      <main class="delivery-detail-main">
        <section v-if="data.issue" class="delivery-section">
          <div class="delivery-section-heading">
            <h2>{{ $t("事项详情") }}</h2>
            <RouterLink :to="{ name: 'project', params: { projectId }, query: { tab: data.issue.type === 'bug' ? 'bugs' : 'issues', issue: data.issue.id } }">{{ $t("查看完整事项") }}</RouterLink>
          </div>
          <div class="delivery-issue-meta"><span>{{ $t(data.issue.type === "bug" ? "Bug" : "需求") }}</span><span>#{{ data.issue.number }}</span><span>{{ data.issue.statusName }}</span><span>{{ $t("业务负责人") }}：{{ data.people.find(p => p.id === data.issue.businessOwnerId)?.displayName || $t("历史成员") }}</span></div>
          <h3>{{ $t("描述") }}</h3>
          <MarkdownContent v-if="data.issue.description" :content="data.issue.description" :images="data.issue.images || []" />
          <p v-else class="field-hint">{{ $t("暂无描述。") }}</p>
          <template v-if="data.issue.type === 'bug'">
            <template v-for="field in [['reproductionSteps', '复现步骤'], ['expectedResult', '预期结果'], ['actualResult', '实际结果']]" :key="field[0]">
              <template v-if="data.issue[field[0]]"><h3>{{ $t(field[1]) }}</h3><MarkdownContent :content="data.issue[field[0]]" :images="data.issue.images || []" /></template>
            </template>
          </template>
        </section>
        <section class="delivery-section">
          <h2>{{ $t("交付说明") }}</h2>
          <MarkdownContent :content="data.delivery.body" />
        </section>
        <section class="delivery-section">
          <div class="delivery-section-heading">
            <h2>{{ $t("验收核对") }}</h2>
            <button v-if="canReview && data.delivery.checklist.length" type="button" class="delivery-select-all" :disabled="saving" @click="toggleAll">{{ $t(allChecked ? "取消全选" : "一键全选") }}</button>
          </div>
          <button v-if="canReview && needsStart" type="button" :disabled="saving" @click="begin">{{ label('verification.started', $t('开始验证')) }}</button>
          <label v-for="(item, index) in data.delivery.checklist" :key="index" class="ui-check-row delivery-check-row">
            <input v-if="canReview" v-model="checked" type="checkbox" :value="index" :disabled="saving" />
            <input v-else type="checkbox" :checked="data.delivery.checkedItems.includes(index)" disabled />
            <span>{{ item }}</span>
          </label>
          <form v-if="canReview" class="project-form delivery-review" @submit.prevent="review('accepted')">
            <label>{{ $t(acceptReasonRequired ? "验证说明（必填）" : "验证说明（选填）") }}<textarea v-model="note" :aria-label="$t('验收说明')" rows="3" maxlength="4000" :required="acceptReasonRequired" :disabled="saving" :placeholder="$t(acceptReasonRequired ? '请填写验证结果。' : '可补充验证结果，无需填写也可通过。')" /></label>
            <p v-if="data.issue" class="field-hint">{{ $t('通过后进入') }}：{{ outcome('verification.accepted')?.statusName || $t('当前流程不允许') }}；{{ $t('退回后进入') }}：{{ outcome('verification.returned')?.statusName || $t('当前流程不允许') }}</p>
            <div class="actions">
              <button v-if="allowed('verification.accepted')" type="submit" class="primary" :disabled="saving || (outcome('verification.accepted')?.requireChecklist !== false && !allChecked) || (acceptReasonRequired && !note.trim())">{{ label('verification.accepted', $t('通过验收')) }}</button>
              <button v-if="allowed('verification.returned')" type="button" :disabled="saving" @click="returning = true">{{ label('verification.returned', $t('退回修改')) }}</button>
            </div>
            <p v-if="outcome('verification.accepted')?.requireChecklist !== false" class="field-hint">{{ $t('已核对 {checked} / {total} 项。', { checked: checked.length, total: data.delivery.checklist.length }) }}</p>
          </form>
          <div v-else-if="data.delivery.reviewedAt" class="delivery-record">
            <h3>{{ $t("验收记录") }}</h3>
            <p>{{ data.people.find(p => p.id === data.delivery.reviewedById)?.displayName }} · {{ formatDate(data.delivery.reviewedAt, { hour: "2-digit", minute: "2-digit" }) }}</p>
            <p class="project-text">{{ data.delivery.reviewNote || $t("全部核对项已确认。") }}</p>
          </div>
        </section>
      </main>
      <aside class="delivery-section delivery-detail-aside">
        <h2>{{ $t("交付信息") }}</h2>
        <template v-if="data.issue"><h3>{{ $t("关联事项") }}</h3><RouterLink :to="{ name: 'project', params: { projectId }, query: { tab: data.issue.type === 'bug' ? 'bugs' : 'issues', issue: data.issue.id } }">#{{ data.issue.number }} {{ data.issue.title }}</RouterLink><p class="field-hint">{{ data.issue.statusName }}</p></template>
        <p v-else>{{ $t("独立开发交付") }}</p>
        <h3>{{ $t("交付验证人") }}</h3><p>{{ data.people.find(p => p.id === data.delivery.reviewerId)?.displayName || $t("历史成员") }}</p>
        <h3>{{ $t("发布人") }}</h3><p>{{ data.people.find(p => p.id === data.delivery.authorId)?.displayName || $t("历史成员") }}</p>
        <template v-if="data.delivery.commit"><h3>{{ $t("提交标识") }}</h3><code>{{ data.delivery.commit }}</code></template>
        <div v-if="data.delivery.supersededById || data.delivery.supersedesId || data.developmentTask || data.canResubmit" class="delivery-followup-actions">
          <RouterLink v-if="data.delivery.supersededById" :to="{ name: 'deliveries', query: { projectId, delivery: data.delivery.supersededById } }">{{ $t("查看重新提交的交付") }}</RouterLink>
          <RouterLink v-if="data.delivery.supersedesId" :to="{ name: 'deliveries', query: { projectId, delivery: data.delivery.supersedesId } }">{{ $t("查看原交付") }}</RouterLink>
          <template v-if="data.developmentTask"><ReworkDevelopment :key="data.developmentTask.id + ':' + data.developmentTask.revision" :project-id="projectId" :task="data.developmentTask" /><RouterLink :to="{ name: 'project', params: { projectId }, query: { tab: 'tasks', task: data.developmentTask.replacedByTaskId || data.developmentTask.id } }">{{ $t('查看开发任务') }}</RouterLink></template>
          <button v-if="data.canResubmit && (!data.issue || data.issue.deliverySubmission?.allowed) && data.permissions.includes('deliverable.create') && data.issue?.release?.status !== 'archived'" @click="resubmitting = true">{{ data.issue?.deliverySubmission?.label || $t('修改并重新提交') }}</button>
        </div>
        <details v-if="data.delivery.status === 'pending' && data.permissions.includes('issue.assign') && data.issue?.release?.status !== 'archived'" class="delivery-reassign">
          <summary>{{ $t("重新指定验证人") }}</summary>
          <form class="project-form" @submit.prevent="reassign">
            <FeedbackMessage :message="reviewers.error.value" type="error" />
            <label>{{ $t("重新指定验证人") }}<AppSelect search-pinyin native-events v-model="reviewerId" :aria-label="$t('重新指定验证人')" :disabled="saving || reviewers.loading.value"><option value="">{{ $t("选择明确的验证人") }}</option><option v-for="person in reviewers.data.value?.items || []" :key="person.id" :value="person.id">{{ person.displayName }}（{{ person.username }}）</option></AppSelect></label>
            <button :disabled="saving || !reviewerId">{{ $t("确认分派") }}</button>
          </form>
        </details>
      </aside>
    </div>
    <ModalDialog v-if="returning" open :title="label('verification.returned', $t('退回修改'))" @close="!saving && (returning = false)">
      <p>{{ $t('请说明需要调整的内容，退回后事项进入配置的下一步骤。') }}</p>
      <FeedbackMessage :message="error" type="error" />
      <form class="project-form" @submit.prevent="review('returned')">
        <label>{{ $t(returnReasonRequired ? '退回原因（必填）' : '退回原因（选填）') }}<textarea v-model="returnNote" :aria-label="$t('退回原因')" rows="4" maxlength="4000" :required="returnReasonRequired" :disabled="saving" /></label>
        <div class="actions"><button type="button" :disabled="saving" @click="returning = false">{{ $t("取消") }}</button><button type="submit" class="primary" :disabled="saving || (returnReasonRequired && !returnNote.trim())">{{ $t("确认退回") }}</button></div>
      </form>
    </ModalDialog>
    <PublishDelivery v-if="resubmitting" :project-id="projectId" :previous="data.delivery" @close="resubmitting = false" @published="resubmitted" />
  </template>
</template>

<style scoped>
.delivery-detail-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 22px; align-items: start; }
.delivery-detail-main { display: grid; gap: 16px; min-width: 0; }
.delivery-section { padding: 24px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); min-width: 0; overflow-wrap: anywhere; }
.delivery-section h2 { font-size: 17px; margin: 0 0 16px; }
.delivery-section h3 { font-size: 13px; margin: 20px 0 8px; }
.delivery-section p { margin: 0 0 8px; }
.delivery-section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.delivery-section-heading h2 { margin: 0 0 16px; }
.delivery-issue-meta { display: flex; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: 12px; }
.delivery-select-all { color: var(--accent); padding: 4px; border: 0; background: transparent; }
.delivery-check-row { border-bottom: 1px solid var(--line); }
.delivery-review { margin-top: 20px; }
.delivery-review textarea { width: 100%; }
.delivery-record { margin-top: 20px; }
.delivery-detail-aside h3 { color: var(--muted); font-weight: 400; font-size: 12px; margin-top: 20px; }
.delivery-followup-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; margin-top: 20px; }
.delivery-reassign { margin-top: 20px; }
.delivery-reassign summary { cursor: pointer; }
.delivery-reassign form { margin-top: 12px; }
@media (max-width: 1000px) { .delivery-detail-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) { .delivery-section { padding: 20px; } }
</style>
