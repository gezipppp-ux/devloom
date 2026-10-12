-- Fresh installations only. Previous migration histories and data are unsupported.

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" <> '20261012200000_baseline'
      AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) THEN
    RAISE EXCEPTION 'Unsupported database history. Use a new database/schema and data directory; existing data was not modified.';
  END IF;
END $$;

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "auth_version" INTEGER NOT NULL DEFAULT 1,
    "department_id" TEXT,
    "can_create_projects" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "sid" TEXT NOT NULL,
    "session_json" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "auth_metadata" (
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "auth_metadata_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL,
    "model" TEXT,
    "reasoning_effort" TEXT,
    "permission_mode" TEXT NOT NULL DEFAULT 'ask',
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "grouping" TEXT NOT NULL DEFAULT 'type',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_settings" (
    "workspace_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id","workspace_id")
);

-- CreateTable
CREATE TABLE "runs" (
    "path" TEXT NOT NULL,
    "workspace_id" TEXT,
    "owner_user_id" TEXT,
    "run_key" TEXT NOT NULL,
    "session_id" TEXT,
    "execution_state" TEXT,
    "source_json" JSONB,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("path")
);

-- CreateTable
CREATE TABLE "run_documents" (
    "path" TEXT NOT NULL,
    "workspace_id" TEXT,
    "run_key" TEXT,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "run_documents_pkey" PRIMARY KEY ("path")
);

-- CreateTable
CREATE TABLE "documents" (
    "path" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("path")
);

-- CreateTable
CREATE TABLE "attachments" (
    "path" TEXT NOT NULL,
    "workspace_id" TEXT,
    "run_key" TEXT,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "metadata_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("path")
);

-- CreateTable
CREATE TABLE "session_items" (
    "id" SERIAL NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "run_path" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "turn_id" TEXT,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_chunks" (
    "id" SERIAL NOT NULL,
    "path" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "workspace_id" TEXT,
    "details_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_git_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "auth_type" TEXT NOT NULL,
    "remote_url" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT '',
    "author_name" TEXT NOT NULL DEFAULT '',
    "author_email" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "credentials" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_git_accounts_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "owner_user_id" TEXT NOT NULL,
    "remote_url" TEXT NOT NULL,
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
    "prompts" JSONB NOT NULL DEFAULT '{}',
    "prompt_revision" INTEGER NOT NULL DEFAULT 1,
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
    "release_id" TEXT,
    "workflow_version_id" TEXT NOT NULL,
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
    "space_id" TEXT,
    "executor_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "release_id" TEXT,
    "request_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "run_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
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

-- CreateTable
CREATE TABLE "issue_development_claims" (
    "issue_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,

    CONSTRAINT "issue_development_claims_pkey" PRIMARY KEY ("issue_id")
);

-- CreateTable
CREATE TABLE "git_key_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "git_key_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_clones" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "input_json" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "progress_json" JSONB NOT NULL,
    "workspace_json" JSONB,
    "error" TEXT,
    "worker_pid" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "dismissed_at" TIMESTAMPTZ(3),

    CONSTRAINT "workspace_clones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_releases" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_workflows" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "draft" JSONB NOT NULL,
    "published_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "system_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_workflow_versions" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_owner_user_id_name_key" ON "workspaces"("owner_user_id", "name");

-- CreateIndex
CREATE INDEX "runs_session_id_idx" ON "runs"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "runs_workspace_id_run_key_key" ON "runs"("workspace_id", "run_key");

-- CreateIndex
CREATE INDEX "run_documents_workspace_id_idx" ON "run_documents"("workspace_id");

-- CreateIndex
CREATE INDEX "attachments_workspace_id_idx" ON "attachments"("workspace_id");

-- CreateIndex
CREATE INDEX "attachments_expires_at_idx" ON "attachments"("expires_at");

-- CreateIndex
CREATE INDEX "session_items_run_path_sort_order_id_idx" ON "session_items"("run_path", "sort_order", "id");

-- CreateIndex
CREATE UNIQUE INDEX "session_items_run_path_item_id_key" ON "session_items"("run_path", "item_id");

-- CreateIndex
CREATE INDEX "log_chunks_path_id_idx" ON "log_chunks"("path", "id");

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_git_accounts_user_id_name_key" ON "user_git_accounts"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE INDEX "projects_owner_user_id_idx" ON "projects"("owner_user_id");

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
CREATE UNIQUE INDEX "development_tasks_project_id_creator_id_request_id_key" ON "development_tasks"("project_id", "creator_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "development_tasks_workspace_id_run_key_key" ON "development_tasks"("workspace_id", "run_key");

-- CreateIndex
CREATE INDEX "issue_development_claims_task_id_idx" ON "issue_development_claims"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_development_claims_project_id_issue_id_key" ON "issue_development_claims"("project_id", "issue_id");

-- CreateIndex
CREATE INDEX "git_key_drafts_user_id_idx" ON "git_key_drafts"("user_id");

-- CreateIndex
CREATE INDEX "git_key_drafts_expires_at_idx" ON "git_key_drafts"("expires_at");

-- CreateIndex
CREATE INDEX "workspace_clones_owner_user_id_dismissed_at_idx" ON "workspace_clones"("owner_user_id", "dismissed_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_clones_owner_user_id_request_id_key" ON "workspace_clones"("owner_user_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_releases_project_id_id_key" ON "project_releases"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_releases_project_id_name_key" ON "project_releases"("project_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "system_workflows_type_key" ON "system_workflows"("type");

-- CreateIndex
CREATE UNIQUE INDEX "system_workflow_versions_workflow_id_version_key" ON "system_workflow_versions"("workflow_id", "version");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_documents" ADD CONSTRAINT "run_documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_git_accounts" ADD CONSTRAINT "user_git_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_project_id_release_id_fkey" FOREIGN KEY ("project_id", "release_id") REFERENCES "project_releases"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "system_workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_executor_id_fkey" FOREIGN KEY ("executor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_project_id_release_id_fkey" FOREIGN KEY ("project_id", "release_id") REFERENCES "project_releases"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_issue_links" ADD CONSTRAINT "task_issue_links_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "development_tasks"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_issue_links" ADD CONSTRAINT "task_issue_links_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_development_claims" ADD CONSTRAINT "issue_development_claims_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_development_claims" ADD CONSTRAINT "issue_development_claims_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "development_tasks"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_development_claims" ADD CONSTRAINT "issue_development_claims_project_id_issue_id_fkey" FOREIGN KEY ("project_id", "issue_id") REFERENCES "project_issues"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_key_drafts" ADD CONSTRAINT "git_key_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_clones" ADD CONSTRAINT "workspace_clones_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_releases" ADD CONSTRAINT "project_releases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_workflow_versions" ADD CONSTRAINT "system_workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "system_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints not represented by the Prisma datamodel.

ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('admin', 'member'));

ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'disabled'));

ALTER TABLE "user_git_accounts" ADD CONSTRAINT "user_git_accounts_auth_type_check" CHECK ("auth_type" IN ('http', 'ssh'));

ALTER TABLE "project_files" ADD CONSTRAINT "project_files_single_parent_check" CHECK (num_nonnulls(issue_id, asset_id) = 1);

ALTER TABLE "project_files" ADD CONSTRAINT "project_files_size_check" CHECK (size >= 0 AND size = octet_length(data));

ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_number_check" CHECK (number > 0);

ALTER TABLE "projects" ADD CONSTRAINT "projects_issue_sequence_check" CHECK (issue_sequence >= 0);

ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_nonproduction_secret_check" CHECK (secret IS NULL OR environment <> 'production');

ALTER TABLE "project_releases" ADD CONSTRAINT "project_releases_status_check" CHECK ("status" IN ('active', 'archived'));

ALTER TABLE "system_workflows" ADD CONSTRAINT "system_workflows_type_check" CHECK ("type" IN ('requirement', 'bug'));

-- Publish the two initial system workflows with identical draft/version definitions.

INSERT INTO "system_workflows" ("id", "type", "draft") VALUES ('system-requirement', 'requirement', '{"nodes":[{"id":"planned","name":"规划中","kind":"initial","allowDevelopment":true,"x":40,"y":40},{"id":"developing","name":"开发中","kind":"normal","allowDevelopment":true,"x":280,"y":40},{"id":"pending_verification","name":"待验证","kind":"normal","allowDevelopment":false,"x":520,"y":40},{"id":"verifying","name":"验证中","kind":"normal","allowDevelopment":false,"x":760,"y":40},{"id":"implemented","name":"已实现","kind":"completed","allowDevelopment":false,"x":1000,"y":40},{"id":"rejected","name":"已拒绝","kind":"cancelled","allowDevelopment":false,"x":520,"y":240}],"transitions":[{"id":"planned_developing","from":"planned","to":"developing","name":"开始开发","permission":"issue.transition","requiresReason":false},{"id":"developing_pending_verification","from":"developing","to":"pending_verification","name":"提交验证","permission":"issue.transition","requiresReason":false},{"id":"pending_verification_verifying","from":"pending_verification","to":"verifying","name":"开始验证","permission":"issue.accept","requiresReason":false},{"id":"verifying_implemented","from":"verifying","to":"implemented","name":"验证通过","permission":"issue.accept","requiresReason":false},{"id":"developing_planned","from":"developing","to":"planned","name":"退回规划","permission":"issue.transition","requiresReason":true},{"id":"pending_verification_developing","from":"pending_verification","to":"developing","name":"退回开发","permission":"issue.accept","requiresReason":true},{"id":"verifying_developing","from":"verifying","to":"developing","name":"验证失败","permission":"issue.accept","requiresReason":true},{"id":"implemented_planned","from":"implemented","to":"planned","name":"重新打开","permission":"issue.transition","requiresReason":true},{"id":"rejected_planned","from":"rejected","to":"planned","name":"重新规划","permission":"issue.transition","requiresReason":true},{"id":"planned_rejected","from":"planned","to":"rejected","name":"拒绝","permission":"issue.transition","requiresReason":true},{"id":"developing_rejected","from":"developing","to":"rejected","name":"拒绝","permission":"issue.transition","requiresReason":true},{"id":"pending_verification_rejected","from":"pending_verification","to":"rejected","name":"拒绝","permission":"issue.accept","requiresReason":true},{"id":"verifying_rejected","from":"verifying","to":"rejected","name":"拒绝","permission":"issue.accept","requiresReason":true}]}'::jsonb);

INSERT INTO "system_workflows" ("id", "type", "draft") VALUES ('system-bug', 'bug', '{"nodes":[{"id":"pending","name":"待处理","kind":"initial","allowDevelopment":true,"x":40,"y":40},{"id":"processing","name":"处理中","kind":"normal","allowDevelopment":true,"x":280,"y":40},{"id":"resolved","name":"已解决待验证","kind":"normal","allowDevelopment":false,"x":520,"y":40},{"id":"verified","name":"已验证待关闭","kind":"normal","allowDevelopment":false,"x":760,"y":40},{"id":"closed","name":"已关闭","kind":"completed","allowDevelopment":false,"x":1000,"y":40},{"id":"failed","name":"失败待处理","kind":"normal","allowDevelopment":true,"x":280,"y":240},{"id":"cancelled","name":"已取消","kind":"cancelled","allowDevelopment":false,"x":760,"y":240}],"transitions":[{"id":"pending_processing","from":"pending","to":"processing","name":"开始处理","permission":"issue.transition","requiresReason":false},{"id":"processing_resolved","from":"processing","to":"resolved","name":"提交验证","permission":"issue.transition","requiresReason":false},{"id":"resolved_verified","from":"resolved","to":"verified","name":"验证通过","permission":"issue.accept","requiresReason":false},{"id":"verified_closed","from":"verified","to":"closed","name":"关闭缺陷","permission":"issue.accept","requiresReason":false},{"id":"resolved_failed","from":"resolved","to":"failed","name":"验证失败","permission":"issue.accept","requiresReason":true},{"id":"verified_failed","from":"verified","to":"failed","name":"退回处理","permission":"issue.accept","requiresReason":true},{"id":"failed_processing","from":"failed","to":"processing","name":"重新处理","permission":"issue.transition","requiresReason":false},{"id":"processing_pending","from":"processing","to":"pending","name":"退回待处理","permission":"issue.transition","requiresReason":true},{"id":"closed_pending","from":"closed","to":"pending","name":"重新打开","permission":"issue.transition","requiresReason":true},{"id":"cancelled_pending","from":"cancelled","to":"pending","name":"恢复处理","permission":"issue.transition","requiresReason":true},{"id":"pending_cancelled","from":"pending","to":"cancelled","name":"取消","permission":"issue.transition","requiresReason":true},{"id":"processing_cancelled","from":"processing","to":"cancelled","name":"取消","permission":"issue.transition","requiresReason":true},{"id":"resolved_cancelled","from":"resolved","to":"cancelled","name":"取消","permission":"issue.accept","requiresReason":true},{"id":"verified_cancelled","from":"verified","to":"cancelled","name":"取消","permission":"issue.accept","requiresReason":true},{"id":"failed_cancelled","from":"failed","to":"cancelled","name":"取消","permission":"issue.transition","requiresReason":true}]}'::jsonb);

INSERT INTO "system_workflow_versions" ("id", "workflow_id", "version", "definition")
SELECT "id" || '-v1', "id", 1, "draft" FROM "system_workflows";

COMMIT;
