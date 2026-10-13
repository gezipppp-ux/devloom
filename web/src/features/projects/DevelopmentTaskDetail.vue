<script setup>
import { computed, nextTick, ref } from "vue";
import { ArrowLeftOutlined, ReloadOutlined } from "@antdv-next/icons";
import { statusLabel, appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import MarkdownContent from "../../shared/components/MarkdownContent.vue";
import RemoteBranchSelect from "./RemoteBranchSelect.vue";
import DevelopmentTaskConfirmation from "./DevelopmentTaskConfirmation.vue";
import { useDevelopmentTask } from "./use-development-task.js";
import {
  developmentTaskLabels,
  additionLabels,
  developmentTaskView,
} from "./development-task-view.js";

const props = defineProps({
  projectId: { type: String, required: true },
  taskId: { type: String, required: true },
  spaceReady: Boolean,
  canAssign: Boolean,
  canContinue: Boolean,
  readOnlyReason: { type: String, default: "" },
});
const emit = defineEmits([
  "back",
  "changed",
  "open-task",
  "open-workspace",
  "prepare-development",
]);
const {
  task,
  loading,
  saving,
  error,
  notice,
  reload,
  query,
  search,
  choices,
  mutate,
  start,
  append,
  send,
} = useDevelopmentTask(props.projectId, props.taskId, () => emit("changed"));
const members = useResource(() =>
  props.canAssign ? appApi(`/projects/${props.projectId}/members`) : null,
);
const editing = ref(false),
  adding = ref(false),
  title = ref(""),
  executorId = ref(""),
  editRevision = ref(0),
  baseBranch = ref(""),
  supplementaryPrompt = ref(""),
  checked = ref([]),
  confirmation = ref(null);
const titleInput = ref(),
  editButton = ref(),
  searchInput = ref(),
  addButton = ref();
const readOnly = computed(() =>
  Boolean(props.readOnlyReason || task.value?.release?.status === "archived"),
);
const busy = computed(() => loading.value || saving.value);
const canEdit = computed(() => !readOnly.value && task.value?.canEdit);
const canStart = computed(() => !readOnly.value && task.value?.canStart);
const canComplete = computed(() => !readOnly.value && task.value?.canComplete);
const canCancel = computed(() => !readOnly.value && task.value?.canCancel);
const canAppend = computed(
  () =>
    !readOnly.value &&
    props.canContinue &&
    task.value?.canOpenSession &&
    task.value.status === "started" &&
    task.value.execution?.sessionId,
);
const view = computed(() =>
  task.value ? developmentTaskView(task.value, props) : null,
);
const steps = ["准备环境", "选择起始分支", "Codex 开发", "人工确认完成"];
const eligibleMembers = computed(
  () =>
    members.data.value?.members?.filter(
      (member) =>
        member.status === "active" &&
        member.userStatus === "active" &&
        member.effectivePermissions?.includes("session.start"),
    ) || [],
);
const codexStatus = computed(() =>
  task.value.execution
    ? statusLabel(task.value.execution.status)
    : task.value.status === "planned"
      ? "尚未启动"
      : "未提供执行状态",
);
const sessionLabel = computed(() =>
  ["completed", "cancelled"].includes(task.value.status) || readOnly.value
    ? "查看历史会话"
    : view.value.step === 4
      ? "查看会话与代码"
      : "进入 Codex 会话",
);
const confirmationAllowed = computed(() =>
  confirmation.value?.action === "complete"
    ? canComplete.value
    : confirmation.value?.action === "cancel"
      ? canCancel.value
      : canEdit.value,
);
async function edit() {
  title.value = task.value.title;
  executorId.value = task.value.executorId;
  editRevision.value = task.value.revision;
  editing.value = true;
  await nextTick();
  titleInput.value?.focus();
}
async function closeEdit() {
  editing.value = false;
  await nextTick();
  editButton.value?.focus();
}
async function saveInformation() {
  if (!canEdit.value) return;
  const result = await mutate(
    "",
    {
      revision: editRevision.value,
      title: title.value,
      ...(props.canAssign ? { executorId: executorId.value } : {}),
    },
    "任务信息已保存，不会启动开发。",
  );
  if (result) await closeEdit();
}
async function toggleAdd() {
  adding.value = !adding.value;
  await nextTick();
  (adding.value ? searchInput.value : addButton.value)?.focus();
}
async function saveIssues() {
  if (!checked.value.length || search.loading.value || busy.value) return;
  const ids = [...checked.value];
  const result = canEdit.value
    ? await mutate(
        "",
        { issueIds: [...new Set([...task.value.issueIds, ...ids])] },
        "关联事项已保存，不会启动开发。",
      )
    : canAppend.value
      ? await append(ids)
      : null;
  if (result) checked.value = checked.value.filter((id) => !ids.includes(id));
}
function confirm(action, issue) {
  confirmation.value = {
    action,
    revision: task.value.revision,
    issueId: issue?.id,
    title: issue ? `#${issue.number} ${issue.title}` : task.value.title,
  };
}
async function submitConfirmation() {
  if (!confirmationAllowed.value) return;
  const current = confirmation.value;
  const result = await mutate(
    current.action === "remove" ? "" : current.action,
    {
      revision: current.revision,
      ...(current.action === "remove"
        ? {
            issueIds: task.value.issueIds.filter(
              (id) => id !== current.issueId,
            ),
          }
        : {}),
    },
    current.action === "complete"
      ? "开发任务已完成，事项验收状态保持不变。"
      : current.action === "cancel"
        ? "任务已取消，已释放关联事项认领。"
        : "事项已移出任务并释放认领。",
  );
  if (result) confirmation.value = null;
}
</script>
<template>
  <article class="development-task-detail" aria-label="开发任务详情">
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage
      :message="notice"
      type="success"
    />
    <div class="development-toolbar">
      <button
        class="development-quiet-button"
        :disabled="saving"
        @click="emit('back')"
      >
        <ArrowLeftOutlined aria-hidden="true" />返回任务列表</button
      ><button
        class="development-quiet-button"
        :disabled="busy"
        @click="reload"
      >
        <ReloadOutlined aria-hidden="true" />{{
          loading ? "正在刷新…" : "刷新状态"
        }}
      </button>
    </div>
    <p v-if="loading && !task" role="status">正在读取指定开发任务…</p>
    <p v-else-if="!task" role="alert">
      {{ error || "指定开发任务不存在或无权访问。" }}
    </p>
    <template v-if="task">
      <header class="development-heading">
        <div>
          <h2>{{ task.title }}</h2>
          <div class="development-states">
            <span class="development-task-status"
              >任务：{{
                developmentTaskLabels[task.status] || task.status
              }}</span
            ><span class="development-execution-status"
              >Codex：{{ codexStatus }}</span
            >
          </div>
          <p class="development-meta">
            开发负责人：{{ task.executor?.displayName || "未分配" }} · 版本：{{
              task.release?.name || "未排期"
            }}
          </p>
        </div>
        <button
          v-if="canEdit"
          ref="editButton"
          :disabled="busy || editing"
          @click="edit"
        >
          编辑任务信息
        </button>
      </header>
      <form
        v-if="editing && canEdit"
        class="development-panel project-form"
        aria-label="编辑任务信息"
        @submit.prevent="saveInformation"
        @keydown.esc.prevent="!saving && closeEdit()"
      >
        <h3>编辑任务信息</h3>
        <FeedbackMessage :message="members.error.value" type="error" />
        <button
          v-if="members.error.value"
          type="button"
          :disabled="members.loading.value"
          @click="members.reload"
        >
          重新读取开发负责人
        </button>
        <div class="form-columns">
          <label
            >任务标题<input
              ref="titleInput"
              v-model="title"
              required
              maxlength="200"
              :disabled="saving" /></label
          ><label v-if="canAssign"
            >开发负责人<select
              v-model="executorId"
              :disabled="
                saving || members.loading.value || Boolean(members.error.value)
              "
              required
            >
              <option
                v-if="
                  !eligibleMembers.some(
                    (member) => member.userId === executorId,
                  )
                "
                :value="executorId"
              >
                {{ task.executor?.displayName || "当前负责人" }}
              </option>
              <option
                v-for="member in eligibleMembers"
                :key="member.userId"
                :value="member.userId"
              >
                {{ member.displayName }}
              </option>
            </select></label
          >
        </div>
        <p class="field-hint">
          仅保存标题与负责人，不会启动 Codex，也不会保存下方尚未提交的关联事项。
        </p>
        <div class="actions">
          <button
            class="primary"
            :disabled="
              busy ||
              !title.trim() ||
              (canAssign &&
                (members.loading.value || Boolean(members.error.value)))
            "
          >
            {{ saving ? "正在保存…" : "保存任务信息" }}</button
          ><button type="button" :disabled="saving" @click="closeEdit">
            取消编辑
          </button>
        </div>
      </form>
      <ol v-if="view.step" class="development-steps" aria-label="开发操作顺序">
        <li
          v-for="(step, index) in steps"
          :key="step"
          :class="{ active: view.step === index + 1 }"
          :aria-current="view.step === index + 1 ? 'step' : undefined"
        >
          <span>{{ index + 1 }}</span
          >{{ step }}
        </li>
      </ol>
      <section
        class="development-panel development-next"
        aria-labelledby="development-next-title"
      >
        <p class="development-eyebrow">
          {{
            ["completed", "cancelled", "merged"].includes(task.status) ||
            readOnly
              ? "任务记录"
              : "当前步骤"
          }}
        </p>
        <h3 id="development-next-title">{{ view.title }}</h3>
        <p>{{ view.description }}</p>
        <p
          v-if="task.error || task.execution?.error"
          class="error project-text"
        >
          {{ task.error || task.execution?.error }}
        </p>
        <p
          v-if="readOnlyReason || task.release?.status === 'archived'"
          class="warning"
        >
          {{ readOnlyReason || "版本已归档，开发任务只读。" }}
        </p>
        <div v-if="task.mergedIntoTaskId" class="actions">
          <button @click="emit('open-task', { id: task.mergedIntoTaskId })">
            查看合并后的任务
          </button>
        </div>
        <template v-else-if="canStart">
          <div v-if="!spaceReady" class="actions">
            <button
              class="primary"
              :disabled="busy"
              @click="emit('prepare-development', task)"
            >
              去准备开发环境
            </button>
          </div>
          <form
            v-else
            class="project-form development-start-form"
            @submit.prevent="start(baseBranch, supplementaryPrompt)"
          >
            <RemoteBranchSelect
              :project-id="projectId"
              v-model="baseBranch"
              :disabled="busy || editing"
            />
            <label>
              补充提示词（可选）
              <textarea
                v-model="supplementaryPrompt"
                aria-label="补充提示词"
                rows="5"
                maxlength="20000"
                :disabled="busy || editing"
                placeholder="填写本次开发的额外要求、实现约束或验证重点"
              />
              <small class="field-hint">最多 20000 字，点击启动时按补充模板一并发送给 Codex。</small>
            </label>
            <button
              class="primary"
              :disabled="busy || editing || !baseBranch"
            >
              {{ saving ? "正在提交…" : "启动 Codex 开发" }}
            </button>
          </form>
          <p class="field-hint">
            {{
              !spaceReady
                ? "准备环境不会自动执行，返回后再选择分支并启动。"
                : editing
                  ? "请先保存或取消编辑，再启动开发。"
                  : "启动时获取最新代码并创建独立开发目录；所有关联事项需处于允许开发的流程节点。"
            }}
          </p>
        </template>
        <div v-else class="actions">
          <button
            v-if="task.canOpenSession && task.runKey"
            class="primary"
            :disabled="busy"
            @click="emit('open-workspace', task.workspaceId, task.runKey)"
          >
            {{ sessionLabel }}</button
          ><button
            v-if="canComplete"
            :disabled="busy"
            @click="confirm('complete')"
          >
            标记开发任务完成
          </button>
        </div>
        <p v-if="canComplete" class="field-hint">
          完成后会话转为只读。Codex 本轮结束不代表需求或 Bug 已验收。
        </p>
      </section>
      <section
        class="development-panel"
        aria-labelledby="development-scope-title"
      >
        <header class="development-panel-heading">
          <h3 id="development-scope-title">
            本次开发范围
            <span class="development-count"
              >{{ task.issueIds.length }} 条事项</span
            >
          </h3>
          <button
            v-if="canEdit || canAppend"
            ref="addButton"
            class="development-quiet-button"
            :aria-expanded="adding"
            aria-controls="development-add-issues"
            :disabled="busy"
            @click="toggleAdd"
          >
            {{
              adding
                ? "收起事项选择"
                : canEdit
                  ? "添加关联事项"
                  : "追加关联事项"
            }}
          </button>
        </header>
        <p class="field-hint">
          以下为纳入任务时保存的事项内容；后续资料按批次单独保存和发送。
        </p>
        <section
          v-if="adding && (canEdit || canAppend)"
          id="development-add-issues"
          class="development-add-issues"
        >
          <h4>{{ canEdit ? "添加同版本事项" : "追加同版本事项" }}</h4>
          <FeedbackMessage :message="search.error.value" type="error" />
          <form class="project-filter" @submit.prevent="search.reload">
            <input
              ref="searchInput"
              v-model="query"
              aria-label="搜索追加事项"
              placeholder="搜索待追加的事项"
              :disabled="saving"
            /><button :disabled="busy || search.loading.value">
              {{ search.loading.value ? "正在搜索…" : "搜索事项" }}
            </button>
          </form>
          <p
            v-if="search.data.value && !search.loading.value && !choices.length"
            class="field-hint"
          >
            没有可添加的匹配事项，请调整搜索条件。
          </p>
          <div class="development-choices">
            <label
              v-for="issue in choices"
              :key="issue.id"
              class="permission-choice"
              ><input
                v-model="checked"
                type="checkbox"
                :value="issue.id"
                :disabled="busy || search.loading.value"
              />#{{ issue.number }} {{ issue.title }}</label
            >
          </div>
          <div class="actions">
            <button
              :disabled="busy || search.loading.value || !checked.length"
              @click="saveIssues"
            >
              {{ canEdit ? "保存关联事项" : "保存追加资料（暂不发送）" }}
            </button>
          </div>
          <p class="field-hint">
            {{
              canEdit
                ? "保存后纳入开发范围，不会启动 Codex。"
                : "先保存内容副本；保存后还需单独点击「发送资料并继续 Codex」。"
            }}
          </p>
        </section>
        <article
          v-for="issue in task.issues"
          :key="issue.id"
          class="development-issue"
        >
          <header class="development-panel-heading">
            <h4>
              <span class="development-issue-type">{{
                issue.type === "bug" ? "Bug" : "需求"
              }}</span
              >#{{ issue.number }} {{ issue.title }}
            </h4>
            <button
              v-if="canEdit && task.issueIds.length > 1"
              class="development-quiet-button development-danger-text"
              :disabled="busy"
              @click="confirm('remove', issue)"
            >
              移出此任务
            </button>
          </header>
          <details>
            <summary>查看开发内容与验收标准</summary>
            <MarkdownContent
              :content="issue.description || '暂无描述。'"
            /><template
              v-for="[field, label] in [
                ['acceptanceCriteria', '验收标准'],
                ['reproductionSteps', '复现步骤'],
                ['expectedResult', '预期结果'],
                ['actualResult', '实际结果'],
              ]"
              :key="field"
              ><template v-if="issue[field]"
                ><h5>{{ label }}</h5>
                <MarkdownContent :content="issue[field]" /></template
            ></template>
          </details>
        </article>
        <section
          v-for="batch in task.additions"
          :key="batch.requestId"
          class="development-addition"
        >
          <h4>追加资料 · {{ additionLabels[batch.status] || batch.status }}</h4>
          <p v-for="issue in batch.issues" :key="issue.id">
            #{{ issue.number }} {{ issue.title }}
          </p>
          <p v-if="batch.error" class="error">{{ batch.error }}</p>
          <template v-if="batch.status === 'ready'"
            ><p class="field-hint">
              {{ canAppend ? '内容已保存，发送后才会交给 Codex 继续执行。' : '未发送的资料保留在任务记录中；当前任务或账号不允许继续发送。' }}
            </p>
            <button v-if="canAppend" :disabled="busy" @click="send(batch)">
              发送资料并继续 Codex
            </button></template
          >
          <p v-else-if="batch.status === 'unknown'" class="warning">
            发送结果待确认，请先检查原会话，避免重复发送。
          </p>
        </section>
      </section>
      <footer class="development-footer">
        <details class="development-baseline">
          <summary>起始代码与开发记录</summary>
          <dl class="project-facts">
            <dt>起始分支</dt>
            <dd>{{ task.baseBranch || "尚未选择，环境准备好后可选择。" }}</dd>
            <dt>起始提交</dt>
            <dd>
              {{ task.baseCommit || "尚未记录。启动时获取远端最新提交。" }}
            </dd>
            <template v-if="task.fetchedAt"
              ><dt>远端获取时间</dt>
              <dd>{{ task.fetchedAt }}</dd></template
            >
          </dl>
        </details>
        <button
          v-if="canCancel"
          class="development-quiet-button development-danger-text"
          :disabled="busy"
          @click="confirm('cancel')"
        >
          取消任务并释放认领
        </button>
      </footer>
      <DevelopmentTaskConfirmation
        v-if="confirmation"
        :action="confirmation.action"
        :title="confirmation.title"
        :busy="saving"
        :disabled="loading || !confirmationAllowed"
        @closed="confirmation = null"
        @confirm="submitConfirmation"
      />
    </template>
  </article>
</template>
