function issueDeletionReason(issue) {
  if (issue.release?.status === "archived") return "发布版本已归档，事项只读；请先恢复版本。";
  if (issue.developmentClaim || issue._count?.taskLinks || issue._count?.deliverables)
    return "事项已关联开发任务或交付记录，不能删除。";
  return "";
}

module.exports = { issueDeletionReason };
