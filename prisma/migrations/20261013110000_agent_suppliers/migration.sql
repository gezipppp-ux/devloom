BEGIN;
CREATE TABLE "agent_suppliers" (
  "id" TEXT PRIMARY KEY, "agent_type" TEXT NOT NULL, "mode" TEXT NOT NULL,
  "name" TEXT NOT NULL, "base_url" TEXT NOT NULL DEFAULT '', "credentials" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '', "models" JSONB NOT NULL DEFAULT '[]', "default_model" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 1,
  "runtime_revision" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "agent_suppliers_mode_check" CHECK ("mode" IN ('api-key', 'server-config')),
  CONSTRAINT "agent_suppliers_revision_check" CHECK ("revision" > 0 AND "runtime_revision" > 0)
);
CREATE UNIQUE INDEX "agent_suppliers_agent_type_name_key" ON "agent_suppliers"("agent_type", "name");
CREATE TABLE "agent_supplier_selections" (
  "agent_type" TEXT PRIMARY KEY, "supplier_id" TEXT NOT NULL REFERENCES "agent_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0)
);
CREATE TABLE "agent_supplier_uses" (
  "workspace_id" TEXT NOT NULL, "run_key" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL REFERENCES "agent_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token" TEXT NOT NULL, "status" TEXT NOT NULL CHECK ("status" IN ('reserved', 'active', 'idle', 'unknown')),
  "updated_at" TIMESTAMPTZ(3) NOT NULL, PRIMARY KEY ("workspace_id", "run_key")
);
CREATE INDEX "agent_supplier_uses_supplier_id_status_idx" ON "agent_supplier_uses"("supplier_id", "status");
INSERT INTO "agent_suppliers" ("id", "agent_type", "mode", "name", "enabled", "updated_at")
VALUES ('codex-server-config', 'codex', 'server-config', '服务器现有配置', true, CURRENT_TIMESTAMP);
INSERT INTO "agent_supplier_selections" ("agent_type", "supplier_id") VALUES ('codex', 'codex-server-config');
COMMIT;
