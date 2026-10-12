BEGIN;
CREATE TABLE "project_releases" (
 "id" TEXT PRIMARY KEY, "project_id" TEXT NOT NULL, "name" TEXT NOT NULL,
 "description" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'active',
 "revision" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "project_releases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "project_releases_status_check" CHECK ("status" IN ('active', 'archived'))
);
CREATE UNIQUE INDEX "project_releases_project_id_id_key" ON "project_releases"("project_id", "id");
CREATE UNIQUE INDEX "project_releases_project_id_name_key" ON "project_releases"("project_id", "name");
CREATE TABLE "project_workflows" (
 "id" TEXT PRIMARY KEY, "project_id" TEXT NOT NULL, "type" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "draft" JSONB NOT NULL, "published_version" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "project_workflows_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "project_workflows_type_check" CHECK ("type" IN ('requirement', 'bug'))
);
CREATE UNIQUE INDEX "project_workflows_project_id_id_key" ON "project_workflows"("project_id", "id");
CREATE UNIQUE INDEX "project_workflows_project_id_type_key" ON "project_workflows"("project_id", "type");
CREATE TABLE "project_workflow_versions" (
 "id" TEXT PRIMARY KEY, "project_id" TEXT NOT NULL, "workflow_id" TEXT NOT NULL, "version" INTEGER NOT NULL,
 "definition" JSONB NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "project_workflow_versions_workflow_fkey" FOREIGN KEY ("project_id", "workflow_id") REFERENCES "project_workflows"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "project_workflow_versions_project_id_id_key" ON "project_workflow_versions"("project_id", "id");
CREATE UNIQUE INDEX "project_workflow_versions_workflow_id_version_key" ON "project_workflow_versions"("workflow_id", "version");
ALTER TABLE "project_issues" ADD COLUMN "release_id" TEXT;
ALTER TABLE "project_issues" ADD COLUMN "workflow_version_id" TEXT NOT NULL;
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_release_fkey" FOREIGN KEY ("project_id", "release_id") REFERENCES "project_releases"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_workflow_version_fkey" FOREIGN KEY ("project_id", "workflow_version_id") REFERENCES "project_workflow_versions"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
