BEGIN;

ALTER TABLE "project_releases" ADD COLUMN "target_date" DATE;

CREATE TABLE "user_project_visits" (
  "user_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "last_visited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_project_visits_pkey" PRIMARY KEY ("user_id", "project_id"),
  CONSTRAINT "user_project_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_project_visits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "user_project_visits_user_id_last_visited_at_idx" ON "user_project_visits"("user_id", "last_visited_at" DESC);
CREATE INDEX "issue_history_project_created_at_idx" ON "issue_history"("project_id", "created_at" DESC);

COMMIT;
