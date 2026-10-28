const { test } = require("node:test");
const assert = require("node:assert/strict");
const { deliveryChecklist, deliveryReview } = require("../../src/domain/deliverable-review.cjs");
const { issueInput } = require("../../src/domain/project-issues.cjs");
test("issue planning fields validate real dates and normalize bounded tags", () => {
  const owners = { businessOwnerId: "owner", qaOwnerId: "owner", acceptanceOwnerId: "owner" };
  const value = issueInput({ ...owners, type: "bug", title: "Issue", dueDate: "2028-02-29", tags: [" mobile ", "mobile", "UI"] });
  assert.equal(value.dueDate, "2028-02-29"); assert.deepEqual(value.tags, ["mobile", "UI"]);
  for (const dueDate of ["2026-02-29", "2026-13-01", "today", 123]) assert.throws(() => issueInput({ type: "bug", title: "Issue", dueDate }), /截止日期/);
  assert.equal(issueInput({ ...owners, type: "bug", title: "Issue", dueDate: "" }).dueDate, null);
  assert.throws(() => issueInput({ type: "bug", title: "Issue", tags: Array(13).fill("tag") }), /标签/);
});
test("acceptance requires complete distinct checks while returns require a reason", () => {
  const checklist = deliveryChecklist({ acceptanceCriteria: ["Search works\n  with nested context", "Filters persist"] });
  assert.deepEqual(checklist.slice(0, 2), ["Search works\n  with nested context", "Filters persist"]);
  const delivery = { status: "pending", checklist };
  const input = { revision: 1, status: "accepted", checkedItems: checklist.map((_, i) => i) };
  assert.equal(deliveryReview(input, delivery).status, "accepted");
  for (const checkedItems of [[], [0, 0, 1, 2], [0, 1, 2, 9], "all"]) assert.throws(() => deliveryReview({ ...input, checkedItems }, delivery));
  assert.throws(() => deliveryReview({ ...input, status: "returned" }, delivery), /原因/);
  assert.equal(deliveryReview({ ...input, status: "returned", checkedItems: [], reviewNote: "Regression" }, delivery).reviewNote, "Regression");
  assert.throws(() => deliveryReview(input, { ...delivery, status: "accepted" }), /完成验收/);
});
