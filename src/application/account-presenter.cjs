function publicAccount(row) {
  return row
    ? {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        role: row.role,
        status: row.status,
        departmentId: row.departmentId || null,
        canCreateProjects: row.role === "admin" || Boolean(row.canCreateProjects),
        mustChangePassword: Boolean(row.must_change_password),
      }
    : null;
}

module.exports = { publicAccount };
