BEGIN;

UPDATE users SET department_id = NULL, can_create_projects = FALSE, updated_at = CURRENT_TIMESTAMP
WHERE role = 'admin' AND (department_id IS NOT NULL OR can_create_projects);

UPDATE project_members SET permissions = ARRAY[]::TEXT[], revision = revision + 1, updated_at = CURRENT_TIMESTAMP
WHERE user_id IN (SELECT id FROM users WHERE role = 'admin') AND cardinality(permissions) > 0;

ALTER TABLE users ADD CONSTRAINT users_administrator_department_check
  CHECK (role <> 'admin' OR (department_id IS NULL AND NOT can_create_projects));

COMMIT;
