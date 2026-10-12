BEGIN;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "can_create_projects" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "department_id" TEXT;

-- AlterTable
ALTER TABLE "user_git_accounts" ADD COLUMN     "author_email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "author_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "host" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "remote_url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "department_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "issue_sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateTable
CREATE TABLE "development_spaces" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "git_account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_credentials',
    "request_id" TEXT,
    "worker_pid" INTEGER,
    "error" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "development_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_issues" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL,
    "assignee_id" TEXT,
    "participant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptance_criteria" TEXT NOT NULL DEFAULT '',
    "reproduction_steps" TEXT NOT NULL DEFAULT '',
    "expected_result" TEXT NOT NULL DEFAULT '',
    "actual_result" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL DEFAULT 'normal',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_sources" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_comments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_deliverables" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "task_id" TEXT,
    "body" TEXT NOT NULL,
    "commit" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_history" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_assets" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "expires_at" TIMESTAMPTZ(3),
    "category" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" TEXT NOT NULL DEFAULT 'development',
    "owner_id" TEXT,
    "secret" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_history" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "secret" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_issue_links" (
    "project_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,

    CONSTRAINT "asset_issue_links_pkey" PRIMARY KEY ("asset_id","issue_id")
);

-- CreateTable
CREATE TABLE "project_files" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "issue_id" TEXT,
    "asset_id" TEXT,
    "author_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "development_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "executor_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "run_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "snapshot" JSONB NOT NULL,
    "error" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "development_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_issue_links" (
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "task_issue_links_pkey" PRIMARY KEY ("task_id","issue_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_name_key" ON "repositories"("name");

-- CreateIndex
CREATE INDEX "projects_owner_user_id_idx" ON "projects"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_department_id_name_key" ON "projects"("department_id", "name");

-- CreateIndex
CREATE INDEX "project_members_user_id_status_idx" ON "project_members"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "development_spaces_workspace_id_key" ON "development_spaces"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "development_spaces_project_id_user_id_key" ON "development_spaces"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "development_spaces_project_id_user_id_id_key" ON "development_spaces"("project_id", "user_id", "id");

-- CreateIndex
CREATE INDEX "project_issues_project_id_type_status_idx" ON "project_issues"("project_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_issues_project_id_id_key" ON "project_issues"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_issues_project_id_number_key" ON "project_issues"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "issue_sources_issue_id_key" ON "issue_sources"("issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_sources_project_id_channel_scope_type_external_id_key" ON "issue_sources"("project_id", "channel", "scope", "type", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_sources_project_id_issue_id_key" ON "issue_sources"("project_id", "issue_id");

-- CreateIndex
CREATE INDEX "issue_comments_project_id_issue_id_created_at_idx" ON "issue_comments"("project_id", "issue_id", "created_at");

-- CreateIndex
CREATE INDEX "issue_deliverables_project_id_issue_id_created_at_idx" ON "issue_deliverables"("project_id", "issue_id", "created_at");

-- CreateIndex
CREATE INDEX "issue_history_project_id_issue_id_created_at_idx" ON "issue_history"("project_id", "issue_id", "created_at");

-- CreateIndex
CREATE INDEX "project_assets_project_id_type_idx" ON "project_assets"("project_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "project_assets_project_id_id_key" ON "project_assets"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_history_asset_id_revision_key" ON "asset_history"("asset_id", "revision");

-- CreateIndex
CREATE INDEX "project_files_project_id_issue_id_idx" ON "project_files"("project_id", "issue_id");

-- CreateIndex
CREATE INDEX "project_files_project_id_asset_id_idx" ON "project_files"("project_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "development_tasks_project_id_id_key" ON "development_tasks"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "development_tasks_project_id_executor_id_request_id_key" ON "development_tasks"("project_id", "executor_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "development_tasks_workspace_id_run_key_key" ON "development_tasks"("workspace_id", "run_key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_spaces" ADD CONSTRAINT "development_spaces_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_spaces" ADD CONSTRAINT "development_spaces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_spaces" ADD CONSTRAINT "development_spaces_git_account_id_fkey" FOREIGN KEY ("git_account_id") REFERENCES "user_git_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_spaces" ADD CONSTRAINT "development_spaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_sources" ADD CONSTRAINT "issue_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_sources" ADD CONSTRAINT "issue_sources_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_deliverables" ADD CONSTRAINT "issue_deliverables_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_deliverables" ADD CONSTRAINT "issue_deliverables_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "development_tasks"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_history" ADD CONSTRAINT "issue_history_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_project_id_asset_id_fkey" FOREIGN KEY ("project_id", "asset_id") REFERENCES "project_assets"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_issue_links" ADD CONSTRAINT "asset_issue_links_project_id_asset_id_fkey" FOREIGN KEY ("project_id", "asset_id") REFERENCES "project_assets"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_issue_links" ADD CONSTRAINT "asset_issue_links_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_asset_id_fkey" FOREIGN KEY ("project_id", "asset_id") REFERENCES "project_assets"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_project_id_executor_id_space_id_fkey" FOREIGN KEY ("project_id", "executor_id", "space_id") REFERENCES "development_spaces"("project_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_issue_links" ADD CONSTRAINT "task_issue_links_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "development_tasks"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_issue_links" ADD CONSTRAINT "task_issue_links_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Structural checks supplement Prisma relations and application validation.
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_single_parent_check" CHECK (num_nonnulls(issue_id, asset_id) = 1);
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_size_check" CHECK (size >= 0 AND size = octet_length(data));
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_number_check" CHECK (number > 0);
ALTER TABLE "projects" ADD CONSTRAINT "projects_issue_sequence_check" CHECK (issue_sequence >= 0);
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_nonproduction_secret_check" CHECK (secret IS NULL OR environment <> 'production');
COMMIT;
