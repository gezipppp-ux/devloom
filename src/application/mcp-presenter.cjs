function presentMcpToken(row, user = row.user) {
  return { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes, allProjects: row.allProjects, projectIds: row.projectIds,
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() || null,
    lastUsedAt: row.lastUsedAt?.toISOString() || null,
    status: row.revokedAt ? "revoked" : row.expiresAt <= new Date() ? "expired" :
      user && row.authVersion !== user.authVersion ? "invalidated" : "active" };
}
function presentMcpIdentity(token) {
  return { user: { id: token.user.id, username: token.user.username, displayName: token.user.displayName },
    token: presentMcpToken(token), skillsPath: "/skills", skillFilePath: "/skills/SKILL.md", uploadPath: "/api/mcp/projects/{projectId}/uploads",
    upload: { method: "POST", authorization: "Bearer", tokenTool: "create_upload_token", tokenMaxAgeHours: 24,
      credential: "temporary_upload_token", requestIdHeader: "Idempotency-Key", maxBytes: 10 * 1024 * 1024,
      maxAttachments: 20, maxTotalBytes: 20 * 1024 * 1024, expiresInHours: 24, mimeTypes: ["*/*"],
      imageInputMimeTypes: ["image/png", "image/jpeg", "image/webp"], otherAttachmentInput: "local_path" } };
}
function presentMcpUploadToken(grant, secret) {
  return { uploadToken: secret, projectId: grant.projectId, expiresAt: grant.expiresAt.toISOString(),
    uploadPath: "/api/mcp/projects/" + grant.projectId + "/uploads", method: "POST", authorization: "Bearer" };
}
function presentMcpUpload(row, previewMimeType) {
  return { attachmentId: row.id, name: row.name, mimeType: row.mimeType, size: row.size, sha256: row.sha256,
    expiresAt: row.expiresAt.toISOString(), issueId: row.issueId, markdown: (previewMimeType ? "![图片附件]" : "[附件]") + "(attachment:" + row.id + ")" };
}
function presentMcpProject(row) { return { id: row.id, name: row.name, description: row.description, status: row.status, permissions: row.permissions }; }
function presentMcpMember(row) {
  return { id: row.userId, username: row.username, displayName: row.displayName, status: row.status,
    active: row.status === "active" && row.userStatus === "active",
    canAssign: row.status === "active" && row.userStatus === "active" && row.effectivePermissions.includes("session.start") };
}
function presentMcpIssue(issue) {
  const value = { ...issue };
  delete value.source; delete value.workflow;
  return { ...value, url: "/projects/" + issue.projectId + "?tab=" + (issue.type === "bug" ? "bugs" : "issues") + "&issue=" + issue.id };
}
function presentMcpIssueResult(issue, task, attachments) {
  return { issue: presentMcpIssue(issue), developmentTask: task
    ? { id: task.id, revision: task.revision, status: task.status, executorId: task.executorId } : null, attachments };
}
module.exports = { presentMcpToken, presentMcpIdentity, presentMcpUploadToken, presentMcpUpload, presentMcpProject, presentMcpMember, presentMcpIssue, presentMcpIssueResult };
