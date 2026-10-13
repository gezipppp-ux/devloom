BEGIN;

CREATE TABLE "mcp_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "scopes" TEXT[],
    "all_projects" BOOLEAN NOT NULL DEFAULT false,
    "project_ids" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mcp_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mcp_tokens_token_hash_key" ON "mcp_tokens"("token_hash");
CREATE INDEX "mcp_tokens_user_id_created_at_idx" ON "mcp_tokens"("user_id", "created_at");

CREATE TABLE "mcp_uploads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA,
    "issue_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "mcp_uploads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mcp_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "mcp_uploads_user_id_project_id_idx" ON "mcp_uploads"("user_id", "project_id");
CREATE INDEX "mcp_uploads_expires_at_idx" ON "mcp_uploads"("expires_at");

CREATE TABLE "mcp_operations" (
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_operations_pkey" PRIMARY KEY ("user_id", "request_id"),
    CONSTRAINT "mcp_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

COMMIT;
