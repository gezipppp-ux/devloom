export const issueContentFields = ["releaseId", "title", "description", "priority", "acceptanceCriteria", "reproductionSteps", "expectedResult", "actualResult", "severity", "dueDate", "tags"];
export const issueResponsibilityFields = ["reporterId", "businessOwnerId", "qaOwnerId", "acceptanceOwnerId"];
export const requiredIssueResponsibilities = ["businessOwnerId", "qaOwnerId", "acceptanceOwnerId"];
export const missingIssueResponsibilities = issue => requiredIssueResponsibilities.some(key => !issue[key]);
export const issueMarkdownFields = ["description", "reproductionSteps", "expectedResult", "actualResult"];

export function issueDetailFields(type, workflow, values = {}) {
  const fields = [["acceptanceCriteria", "验收标准"], ["reproductionSteps", "复现步骤"], ["expectedResult", "预期结果"], ["actualResult", "实际结果"]];
  const required = new Set((workflow?.transitions || []).flatMap(edge => edge.requiredFields || []));
  return fields.filter(([key]) => key === "acceptanceCriteria" || type === "bug" || required.has(key) || values[key]?.trim());
}

export function emptyIssue() {
  return { releaseId: null, title: "", description: "", priority: "normal", acceptanceCriteria: [], reproductionSteps: "", expectedResult: "", actualResult: "", severity: "normal", dueDate: null, tags: [], developerId: null, reporterId: null, businessOwnerId: null, qaOwnerId: null, acceptanceOwnerId: null, watcherIds: [] };
}

export function issueFieldsInput(form, { edit = true, assign = true } = {}) {
  const input = {};
  if (edit) for (const key of issueContentFields) input[key] = form[key];
  if (assign) { input.watcherIds = [...form.watcherIds]; for (const key of issueResponsibilityFields) if (form[key]) input[key] = form[key]; }
  return input;
}

export function removeAttachmentLinks(form, url) {
  // Generated links escape brackets in the filename, so handle escaped characters too.
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = new RegExp(`!?\\[(?:\\\\.|[^\\]\\\\])*\\]\\(${escaped}\\)`, "g");
  for (const key of issueMarkdownFields) form[key] = (form[key] || "").replace(link, "");
  form.acceptanceCriteria = form.acceptanceCriteria.map(item => item.replace(link, ""));
}
