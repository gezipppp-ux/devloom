CREATE TABLE "mcp_upload_tokens" (
  "id" TEXT NOT NULL,
  "token_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "mcp_upload_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_upload_tokens_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "mcp_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mcp_upload_tokens_token_hash_key" ON "mcp_upload_tokens"("token_hash");
CREATE INDEX "mcp_upload_tokens_token_id_idx" ON "mcp_upload_tokens"("token_id");
CREATE INDEX "mcp_upload_tokens_expires_at_idx" ON "mcp_upload_tokens"("expires_at");
