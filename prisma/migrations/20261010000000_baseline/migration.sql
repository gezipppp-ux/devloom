BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "auth_version" INTEGER NOT NULL DEFAULT 1,
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
    "revision" INTEGER NOT NULL DEFAULT 1,
    "credentials" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_git_accounts_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "git_key_drafts_user_id_idx" ON "git_key_drafts"("user_id");

-- CreateIndex
CREATE INDEX "git_key_drafts_expires_at_idx" ON "git_key_drafts"("expires_at");

-- CreateIndex
CREATE INDEX "workspace_clones_owner_user_id_dismissed_at_idx" ON "workspace_clones"("owner_user_id", "dismissed_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_clones_owner_user_id_request_id_key" ON "workspace_clones"("owner_user_id", "request_id");

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
ALTER TABLE "git_key_drafts" ADD CONSTRAINT "git_key_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_clones" ADD CONSTRAINT "workspace_clones_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('admin', 'member'));
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'disabled'));
ALTER TABLE "user_git_accounts" ADD CONSTRAINT "user_git_accounts_auth_type_check" CHECK ("auth_type" IN ('http', 'ssh'));

COMMIT;
