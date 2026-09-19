function publicAccount(row) {
  return row
    ? {
        id: row.id,
        username: row.username,
        role: row.role,
        status: row.status,
        mustChangePassword: Boolean(row.must_change_password),
      }
    : null;
}

module.exports = { publicAccount };
