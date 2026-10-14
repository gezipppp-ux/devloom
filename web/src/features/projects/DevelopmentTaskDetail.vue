<script setup>
import { formatDate } from "../../shared/i18n/index.js";
import { computed, nextTick, reactive, ref } from "vue";
import { ArrowLeftOutlined, ReloadOutlined } from "@antdv-next/icons";
import { statusLabel, appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import MarkdownContent from "../../shared/components/MarkdownContent.vue";
import AgentModelSettings from "../../shared/components/AgentModelSettings.vue";
import { accountSession } from "../../shared/api/account-session.js";
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
  workspaceId: { type: String, default: "" },
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
    task.value?.kind !== "manual" &&
    task.value?.canOpenSession &&
    task.value.status === "started" &&
    task.value.execution?.sessionId,
);
const view = computed(() =>
  task.value ? developmentTaskView(task.value, props) : null,
);
const steps = ["准备环境", "选择起始分支", "Codex 开发", "人工确认完成"];
const selection = reactive({ model: accountSession.settings.model || "", reasoningEffort: accountSession.settings.reasoningEffort || "", permissionMode: accountSession.settings.permissionMode || "ask" });
const permissionsReady = ref(false);
function startDevelopment() {
  if (!permissionsReady.value || !props.workspaceId || !canStart.value || busy.value || editing.value || !baseBranch.value) return;
  return start(baseBranch.value, supplementaryPrompt.value, { ...selection });
}
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
  <article class="development-task-detail" :aria-label="$t(&quot;开发任务详情&quot;)">
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
        <ArrowLeftOutlined aria-hidden="true" />{{ $t("返回任务列表") }}</button
      ><button
        class="development-quiet-button"
        :disabled="busy"
        @click="reload"
      >
        <ReloadOutlined aria-hidden="true" />{{
          loading ? $t("正在刷新…") : $t("刷新状态")
        }}
      </button>
    </div>
    <p v-if="loading && !task" role="status">{{ $t("正在读取指定开发任务…") }}</p>
    <p v-else-if="!task" role="alert">
      {{ error || $t("指定开发任务不存在或无权访问。") }}
    </p>
    <template v-if="task">
      <header class="development-heading">
        <div>
          <h2>{{ task.title }}</h2>
          <div class="development-states">
            <span class="development-task-status"
              >{{ $t("任务：") }}{{
                $t(developmentTaskLabels[task.status] || task.status)
              }}</span
            ><span class="development-execution-status"
              >Codex：{{ $t(codexStatus) }}</span
            >
          </div>
          <p class="development-meta">
            {{ $t("开发负责人：") }}{{ task.executor?.displayName || $t("未分配") }} {{ $t("· 版本：") }}{{
              task.release?.name || $t("未排期")
            }}
          </p>
        </div>
        <button
          v-if="canEdit"
          ref="editButton"
          :disabled="busy || editing"
          @click="edit"
        >
          {{ $t("编辑任务信息") }}
        </button>
      </header>
      <form
        v-if="editing && canEdit"
        class="development-panel project-form"
        :aria-label="$t(&quot;编辑任务信息&quot;)"
        @submit.prevent="saveInformation"
        @keydown.esc.prevent="!saving && closeEdit()"
      >
        <h3>{{ $t("编辑任务信息") }}</h3>
        <FeedbackMessage :message="members.error.value" type="error" />
        <button
          v-if="members.error.value"
          type="button"
          :disabled="members.loading.value"
          @click="members.reload"
        >
          {{ $t("重新读取开发负责人") }}
        </button>
        <div class="form-columns">
          <label
            >{{ $t("任务标题") }}<input
              ref="titleInput"
              v-model="title"
              required
              maxlength="200"
              :disabled="saving" /></label
          ><label v-if="canAssign"
            >{{ $t("开发负责人") }}<select
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
                {{ task.executor?.displayName || $t("当前负责人") }}
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
          {{ $t("仅保存标题与负责人，不会启动 Codex，也不会保存下方尚未提交的关联事项。") }}
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
            {{ saving ? $t("正在保存…") : $t("保存任务信息") }}</button
          ><button type="button" :disabled="saving" @click="closeEdit">
            {{ $t("取消编辑") }}
          </button>
        </div>
      </form>
      <ol v-if="view.step" class="development-steps" :aria-label="$t(&quot;开发操作顺序&quot;)">
        <li
          v-for="(step, index) in steps"
          :key="step"
          :class="{ active: view.step === index + 1 }"
          :aria-current="view.step === index + 1 ? 'step' : undefined"
        >
          <span>{{ index + 1 }}</span
          >{{ $t(step) }}
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
              ? $t("任务记录")
              : $t("当前步骤")
          }}
        </p>
        <h3 id="development-next-title">{{ $t(view.title) }}</h3>
        <p>{{ $t(view.description) }}</p>
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
          {{ readOnlyReason || $t("版本已归档，开发任务只读。") }}
        </p>
        <div v-if="task.mergedIntoTaskId" class="actions">
          <button @click="emit('open-task', { id: task.mergedIntoTaskId })">
            {{ $t("查看合并后的任务") }}
          </button>
        </div>
        <template v-else-if="canStart">
          <div v-if="!spaceReady" class="actions">
            <button
              class="primary"
              :disabled="busy"
              @click="emit('prepare-development', task)"
            >
              {{ $t("去准备开发环境") }}
            </button>
          </div>
          <form
            v-else
            class="project-form development-start-form"
            @submit.prevent="startDevelopment"
          >
            <RemoteBranchSelect
              :project-id="projectId"
              v-model="baseBranch"
              :disabled="busy || editing"
            />
            <label>
              {{ $t("补充提示词（可选）") }}
              <textarea
                v-model="supplementaryPrompt"
                :aria-label="$t(&quot;补充提示词&quot;)"
                rows="5"
                maxlength="20000"
                :disabled="busy || editing"
                :placeholder="$t(&quot;填写本次开发的额外要求、实现约束或验证重点&quot;)"
              />
              <small class="field-hint">{{ $t("最多 20000 字，点击启动时按补充模板一并发送给 Codex。") }}</small>
            </label>
            <AgentModelSettings :key="workspaceId" :workspace-id="workspaceId"
              v-model:model="selection.model" v-model:reasoning-effort="selection.reasoningEffort"
              v-model:permission-mode="selection.permissionMode" :disabled="busy || editing"
              @validity-change="permissionsReady = $event" />
            <button
              class="primary"
              :disabled="busy || editing || !baseBranch || !workspaceId || !permissionsReady"
            >
              {{ saving ? $t("正在提交…") : $t("启动 Codex 开发") }}
            </button>
          </form>
          <p class="field-hint">
            {{
              !spaceReady
                ? $t("准备环境不会自动执行，返回后再选择分支并启动。")
                : editing
                  ? $t("请先保存或取消编辑，再启动开发。")
                  : $t("启动时获取最新代码并创建独立开发目录；所有关联事项需处于允许开发的流程节点。")
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
            {{ $t(sessionLabel) }}</button
          ><button
            v-if="canComplete"
            :disabled="busy"
            @click="confirm('complete')"
          >
            {{ $t("标记开发任务完成") }}
          </button>
        </div>
        <p v-if="canComplete" class="field-hint">
          {{ $t("完成后会话转为只读。Codex 本轮结束不代表需求或 Bug 已验收。") }}
        </p>
      </section>
      <section
        class="development-panel"
        aria-labelledby="development-scope-title"
      >
        <header class="development-panel-heading">
          <h3 id="development-scope-title">
            {{ $t("本次开发范围") }}
            <span class="development-count"
              >{{ task.kind === 'manual' ? $t("独立开发") : $t("{p0} 条事项", { p0: task.issueIds.length }) }}</span
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
                ? $t("收起事项选择")
                : canEdit
                  ? $t("添加关联事项")
                  : $t("追加关联事项")
            }}
          </button>
        </header>
        <p v-if="task.kind !== 'manual'" class="field-hint">
          {{ $t("以下为纳入任务时保存的事项内容；后续资料按批次单独保存和发送。") }}
        </p>
        <template v-else><p class="field-hint">{{ $t("此任务独立开发，不关联项目事项。后续目标在原会话中补充。") }}</p><MarkdownContent :content="task.manualContent || '开发目标见原会话参考图片。'" /></template>
        <section
          v-if="adding && (canEdit || canAppend)"
          id="development-add-issues"
          class="development-add-issues"
        >
          <h4>{{ canEdit ? $t("添加同版本事项") : $t("追加同版本事项") }}</h4>
          <FeedbackMessage :message="search.error.value" type="error" />
          <form class="project-filter" @submit.prevent="search.reload">
            <input
              ref="searchInput"
              v-model="query"
              :aria-label="$t(&quot;搜索追加事项&quot;)"
              :placeholder="$t(&quot;搜索待追加的事项&quot;)"
              :disabled="saving"
            /><button :disabled="busy || search.loading.value">
              {{ search.loading.value ? $t("正在搜索…") : $t("搜索事项") }}
            </button>
          </form>
          <p
            v-if="search.data.value && !search.loading.value && !choices.length"
            class="field-hint"
          >
            {{ $t("没有可添加的匹配事项，请调整搜索条件。") }}
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
              {{ canEdit ? $t("保存关联事项") : $t("保存追加资料（暂不发送）") }}
            </button>
          </div>
          <p class="field-hint">
            {{
              canEdit
                ? $t("保存后纳入开发范围，不会启动 Codex。")
                : $t("先保存内容副本；保存后还需单独点击「发送资料并继续 Codex」。")
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
                issue.type === "bug" ? "Bug" : $t("需求")
              }}</span
              >#{{ issue.number }} {{ issue.title }}
            </h4>
            <button
              v-if="canEdit && task.issueIds.length > 1"
              class="development-quiet-button development-danger-text"
              :disabled="busy"
              @click="confirm('remove', issue)"
            >
              {{ $t("移出此任务") }}
            </button>
          </header>
          <details>
            <summary>{{ $t("查看开发内容与验收标准") }}</summary>
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
                ><h5>{{ $t(label) }}</h5>
                <MarkdownContent :content="issue[field]" /></template
            ></template>
          </details>
        </article>
        <section
          v-for="batch in task.additions"
          :key="batch.requestId"
          class="development-addition"
        >
          <h4>{{ $t("追加资料 ·") }} {{ $t(additionLabels[batch.status] || batch.status) }}</h4>
          <p v-for="issue in batch.issues" :key="issue.id">
            #{{ issue.number }} {{ issue.title }}
          </p>
          <p v-if="batch.error" class="error">{{ batch.error }}</p>
          <template v-if="batch.status === 'ready'"
            ><p class="field-hint">
              {{ canAppend ? $t("内容已保存，发送后才会交给 Codex 继续执行。") : $t("未发送的资料保留在任务记录中；当前任务或账号不允许继续发送。") }}
            </p>
            <button v-if="canAppend" :disabled="busy" @click="send(batch)">
              {{ $t("发送资料并继续 Codex") }}
            </button></template
          >
          <p v-else-if="batch.status === 'unknown'" class="warning">
            {{ $t("发送结果待确认，请先检查原会话，避免重复发送。") }}
          </p>
        </section>
      </section>
      <footer class="development-footer">
        <details class="development-baseline">
          <summary>{{ $t("起始代码与开发记录") }}</summary>
          <dl class="project-facts">
            <dt>{{ $t("起始分支") }}</dt>
            <dd>{{ task.baseBranch || $t("尚未选择，环境准备好后可选择。") }}</dd>
            <dt>{{ $t("起始提交") }}</dt>
            <dd>
              {{ task.baseCommit || $t("尚未记录。启动时获取远端最新提交。") }}
            </dd>
            <template v-if="task.fetchedAt"
              ><dt>{{ $t("远端获取时间") }}</dt>
              <dd>{{ formatDate(task.fetchedAt, { hour: "2-digit", minute: "2-digit" }) }}</dd></template
            >
          </dl>
        </details>
        <button
          v-if="canCancel"
          class="development-quiet-button development-danger-text"
          :disabled="busy"
          @click="confirm('cancel')"
        >
          {{ $t("取消任务并释放认领") }}
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
