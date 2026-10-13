BEGIN;

CREATE TABLE "system_setup" (
    "id" TEXT NOT NULL DEFAULT 'installation',
    "status" TEXT NOT NULL DEFAULT 'awaiting_admin',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "initial_admin_id" TEXT,
    "steps" JSONB NOT NULL DEFAULT '{}',
    "drafts" JSONB NOT NULL DEFAULT '{}',
    "token_hash" TEXT,
    "token_expires_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "system_setup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "system_setup_status_check" CHECK ("status" IN ('awaiting_admin', 'pending', 'completed', 'not_required')),
    CONSTRAINT "system_setup_singleton_check" CHECK ("id" = 'installation' AND "revision" > 0)
);

CREATE TABLE "setup_operations" (
    "request_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "setup_operations_pkey" PRIMARY KEY ("request_id")
);

-- Classify the deployment once. Later account/project removal never reopens setup.
INSERT INTO "system_setup" ("id", "status", "initial_admin_id", "steps", "updated_at")
SELECT 'installation',
  CASE WHEN EXISTS (SELECT 1 FROM "departments") OR EXISTS (SELECT 1 FROM "projects")
    OR EXISTS (SELECT 1 FROM "workspaces") OR EXISTS (SELECT 1 FROM "runs")
    OR (SELECT COUNT(*) FROM "users") > 1
    OR EXISTS (SELECT 1 FROM "users" WHERE "role" <> 'admin' OR "status" <> 'active')
    THEN 'not_required'
    WHEN EXISTS (SELECT 1 FROM "users") THEN 'pending' ELSE 'awaiting_admin' END,
  (SELECT "id" FROM "users" WHERE "role" = 'admin' AND "status" = 'active' ORDER BY "created_at" LIMIT 1),
  CASE WHEN EXISTS (SELECT 1 FROM "users" WHERE "role" = 'admin' AND "status" = 'active')
    THEN '{"admin":{"status":"completed"}}'::jsonb ELSE '{}'::jsonb END,
  CURRENT_TIMESTAMP;

COMMIT;
