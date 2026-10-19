BEGIN;
ALTER TABLE "project_issues" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
COMMIT;
