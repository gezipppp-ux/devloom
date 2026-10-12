export const issueContentFields = ["releaseId", "title", "description", "priority", "acceptanceCriteria", "reproductionSteps", "expectedResult", "actualResult", "severity"];
export const issueMarkdownFields = ["description", "acceptanceCriteria", "reproductionSteps", "expectedResult", "actualResult"];

export function emptyIssue() {
  return { releaseId: null, title: "", description: "", priority: "normal", acceptanceCriteria: "", reproductionSteps: "", expectedResult: "", actualResult: "", severity: "normal", assigneeId: null, participantIds: [] };
}

export function issueFieldsInput(form, { edit = true, assign = true } = {}) {
  const input = {};
  if (edit) for (const key of issueContentFields) input[key] = form[key];
  if (assign) { input.assigneeId = form.assigneeId || null; input.participantIds = [...form.participantIds]; }
  return input;
}

export function removeAttachmentLinks(form, url) {
  // Generated links escape brackets in the filename, so handle escaped characters too.
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = new RegExp(`!?\\[(?:\\\\.|[^\\]\\\\])*\\]\\(${escaped}\\)`, "g");
  for (const key of issueMarkdownFields) form[key] = (form[key] || "").replace(link, "");
}
