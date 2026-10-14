const { accountError } = require("./account.cjs");
const { object, text, revision, choice } = require("./project-issues.cjs");

function deliveryChecklist(issue) {
  const criteria = (issue.acceptanceCriteria || (issue.type === "bug" ? issue.expectedResult : "")).split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*]|\d+\.)\s*(?:\[[ xX]\])?\s*/, "").trim()).filter(Boolean).slice(0, 30);
  return [...(criteria.length ? criteria : ["交付结果符合事项描述与预期"]), "相关验证已完成，结果可复核", "交付说明与提交信息完整"];
}
function deliveryReview(input, delivery) {
  object(input, ["revision", "status", "checkedItems", "reviewNote", "transitionId", "issueRevision"]);
  revision(input.revision);
  const status = choice(input.status, ["accepted", "returned"], "验收结果");
  const reviewNote = text(input.reviewNote || "", "验收说明", 4000);
  if (delivery.status !== "pending") throw accountError("该交付已完成验收，请刷新查看结果。", 409);
  if (status === "returned" && !reviewNote) throw accountError("退回交付必须填写原因。", 400);
  const checkedItems = input.checkedItems;
  if (!Array.isArray(checkedItems) || new Set(checkedItems).size !== checkedItems.length || checkedItems.some(i => !Number.isInteger(i) || i < 0 || i >= delivery.checklist.length))
    throw accountError("验收核对项无效。", 400);
  if (status === "accepted" && checkedItems.length !== delivery.checklist.length) throw accountError("请逐项核对全部验收标准。", 400);
  return { status, checkedItems, reviewNote };
}
module.exports = { deliveryChecklist, deliveryReview };
