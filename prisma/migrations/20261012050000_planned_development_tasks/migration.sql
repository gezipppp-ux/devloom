ALTER TABLE "development_tasks" ALTER COLUMN "space_id" DROP NOT NULL;
ALTER TABLE "development_tasks" ALTER COLUMN "workspace_id" DROP NOT NULL;
ALTER TABLE "development_tasks" ALTER COLUMN "status" SET DEFAULT 'planned';
ALTER TABLE "development_tasks" ADD COLUMN "creator_id" TEXT;
ALTER TABLE "development_tasks" ADD COLUMN "release_id" TEXT;
UPDATE "development_tasks" SET "creator_id" = "executor_id";
ALTER TABLE "development_tasks" ALTER COLUMN "creator_id" SET NOT NULL;
DROP INDEX "development_tasks_project_id_executor_id_request_id_key";
CREATE UNIQUE INDEX "development_tasks_project_id_creator_id_request_id_key" ON "development_tasks"("project_id", "creator_id", "request_id");
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_executor_id_fkey" FOREIGN KEY ("executor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_project_id_release_id_fkey" FOREIGN KEY ("project_id", "release_id") REFERENCES "project_releases"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "issue_development_claims" (
  "issue_id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  CONSTRAINT "issue_development_claims_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "issue_development_claims_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "development_tasks"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "issue_development_claims_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "issue_development_claims_task_id_idx" ON "issue_development_claims"("task_id");
CREATE UNIQUE INDEX "issue_development_claims_project_id_issue_id_key" ON "issue_development_claims"("project_id", "issue_id");
