export const developmentTaskLabels = {
  planned: "待开发",
  merged: "已合并",
  completed: "已完成",
  cancelled: "已取消",
  started: "已启动",
  unknown: "执行结果待确认",
};
export const additionLabels = {
  ready: "待发送",
  sending: "发送中",
  sent: "已发送",
  unknown: "发送结果待确认",
};

export function developmentTaskView(
  task,
  { spaceReady = false, readOnlyReason = "" } = {},
) {
  if (task.replacedByTaskId) return { step: 0, title: "已转入返工任务", description: "旧任务已取消，事项认领已转入新的返工任务；原交付与验收记录保留。" };
  if (task.mergedIntoTaskId || task.status === "merged")
    return {
      step: 0,
      title: "此任务已合并",
      description: "原任务保留历史，请前往合并后的任务继续开发。",
    };
  if (readOnlyReason || task.release?.status === "archived")
    return {
      step: 0,
      title: "开发任务只读",
      description: readOnlyReason || "版本已归档，可查看任务资料与历史记录。",
    };
  if (task.sessionDeleted || task.worktreeRemoved) return { step: 0, title: task.sessionDeleted ? "会话已删除" : "工作目录已清理", description: task.canRework ? "交付已退回，可创建返工任务并选择包含原交付代码的分支。" : "事项与交付记录保留，验收继续按原流程处理。" };
  if (task.status === "completed")
    return {
      step: 4,
      title: "开发任务已完成",
      description:
        "已释放关联事项的认领，保留负责人和历史。需求与 Bug 仍按各自流程验收。",
    };
  if (task.status === "cancelled")
    return {
      step: 0,
      title: "开发任务已取消",
      description: "已释放关联事项的认领并清空开发负责人，任务历史仍保留。",
    };
  if (task.deliveryPhase === "等待验证") return { step: 4, title: "等待验证", description: "交付已送验，请等待指定验证人处理。" };
  if (task.status === "planned") {
    if (!task.canStart)
      return {
        step: 0,
        title: "等待负责人开始开发",
        description:
          "当前账号不能启动此任务，请由具备启动权限的开发负责人处理。",
      };
    return spaceReady
      ? {
          step: 2,
          title: "选择从哪个分支开始",
          description:
            "环境已就绪。选择远端起始分支后，将创建独立开发目录并启动 Codex。",
        }
      : {
          step: 1,
          title: "先准备你的开发环境",
          description:
            "前往「代码与环境」配置个人 Git 并准备开发空间，完成后返回此任务。",
        };
  }
  if (task.status === "unknown")
    return {
      step: 3,
      title: "执行结果待确认",
      description:
        "请检查原会话及错误信息，确认已接受的启动请求结果；不要重复启动。",
    };
  if (task.status !== "started")
    return {
      step: 0,
      title: "任务状态待确认",
      description: "请刷新状态，确认任务的最新记录。",
    };
  const execution = task.execution?.status;
  if (["completed", "failed", "interrupted", "cancelled"].includes(execution)) {
    const title = {
      completed: "本轮已结束，请检查结果",
      failed: "本轮执行失败，请检查会话",
      interrupted: "本轮已中断，请检查会话",
      cancelled: "本轮已停止，请检查会话",
    }[execution];
    return {
      step: 4,
      title,
      description:
        "查看代码与执行结果，需要调整时可继续会话；确认开发结束后再标记任务完成。",
    };
  }
  if (task.canComplete)
    return {
      step: 4,
      title: "等待人工确认开发结果",
      description:
        "确认负责人已完成开发后，可以结束此任务。需求与 Bug 的验收需单独进行。",
    };
  if (execution === "running")
    return {
      step: 3,
      title: "在会话中跟进开发",
      description:
        "查看实时输出、回答问题或处理审批；需要停止本轮时请进入会话。",
    };
  return {
    step: 3,
    title: "开发已启动",
    description:
      "以会话中的实际执行状态为准；状态未确认或仍在执行时，不能结束任务。",
  };
}
