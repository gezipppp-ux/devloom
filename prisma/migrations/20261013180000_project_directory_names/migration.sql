BEGIN;

-- This layout is for fresh project data only. Never move or relabel old worktrees.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "projects") OR EXISTS (SELECT 1 FROM "workspaces")
    OR EXISTS (SELECT 1 FROM "runs") THEN
    RAISE EXCEPTION 'Repository-name directories require fresh project data; historical projects, workspaces and runs are unsupported. Use a fresh database; existing files are not migrated.';
  END IF;
END $$;

ALTER TABLE "projects" ADD COLUMN "directory_name" TEXT NOT NULL,
  ADD COLUMN "directory_key" TEXT NOT NULL;
CREATE UNIQUE INDEX "projects_directory_key_key" ON "projects"("directory_key");
ALTER TABLE "projects" ADD CONSTRAINT "projects_directory_key_check"
  CHECK ("directory_key" = lower("directory_name") AND length("directory_name") BETWEEN 1 AND 120);

COMMIT;
