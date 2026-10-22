const { issueDevelopmentAllowed } = require("./issue-workflows.cjs");

function executionEnded(execution) {
  return ["completed", "failed", "interrupted", "cancelled"].includes(execution?.status);
}

function completedSessionWritable(task) {
  return task.status === "completed" && task.snapshot.kind !== "manual" && task.snapshot.issues?.length > 0;
}

function reworkAvailable(task, execution) {
  return task.snapshot.kind !== "manual" && ["started", "completed", "cancelled"].includes(task.status)
    && !task.snapshot.replacedByTaskId && executionEnded(execution)
    && Boolean(execution.sessionDeleted || execution.worktreeRemoved)
    && task.issueLinks?.some(({ issue }) => issueDevelopmentAllowed(issue))
    && task.issueLinks?.some(({ issue }) => issue.deliverables?.[0]?.status === "returned");
}

function reworkPrompt(task, issues) {
  if (!task.snapshot.reworkOfTaskId) return "";
  const ids = new Set(issues.map(issue => issue.id));
  const deliveries = (task.issueLinks || []).filter(link => ids.has(link.issueId)).flatMap(link => link.issue.deliverables || []);
  return [`本次为返工，原开发任务：${task.snapshot.reworkOfTaskId}。原工作目录已清理，请先核对所选分支包含原交付代码。`,
    ...deliveries.map(delivery => [`原交付：${delivery.title}（${delivery.id}）`, `交付说明：\n${delivery.body}`,
      delivery.commit ? `原交付提交信息：${delivery.commit}` : "", delivery.reviewNote ? `验收意见：\n${delivery.reviewNote}` : ""].filter(Boolean).join("\n")),
  ].join("\n\n");
}

module.exports = { executionEnded, completedSessionWritable, reworkAvailable, reworkPrompt };
