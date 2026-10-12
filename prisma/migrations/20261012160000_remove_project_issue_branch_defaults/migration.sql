UPDATE "projects"
SET "settings" = "settings" - 'baseBranch'
WHERE "settings" ? 'baseBranch';

UPDATE "workspace_settings"
SET "data" = jsonb_set("data", '{execution,baseBranch}', '""'::jsonb, false)
WHERE "data" #>> '{workspace,project_id}' IS NOT NULL
  AND "data" #> '{execution,baseBranch}' IS NOT NULL;

ALTER TABLE "project_issues" DROP COLUMN "base_branch";

UPDATE "task_issue_links"
SET "snapshot" = "snapshot" - 'baseBranch'
WHERE "snapshot" ? 'baseBranch';

UPDATE "issue_history"
SET "data" = jsonb_set("data", '{before}', "data"->'before' - 'baseBranch', false)
WHERE jsonb_typeof("data"->'before') = 'object'
  AND ("data"->'before') ? 'baseBranch';

UPDATE "issue_history"
SET "data" = jsonb_set("data", '{after}', "data"->'after' - 'baseBranch', false)
WHERE jsonb_typeof("data"->'after') = 'object'
  AND ("data"->'after') ? 'baseBranch';

UPDATE "development_tasks" AS task
SET "snapshot" = jsonb_set(task."snapshot", '{issues}', (
  SELECT COALESCE(jsonb_agg(issue - 'baseBranch'), '[]'::jsonb)
  FROM jsonb_array_elements(task."snapshot"->'issues') AS issues(issue)
), false)
WHERE jsonb_typeof(task."snapshot"->'issues') = 'array';

UPDATE "development_tasks" AS task
SET "snapshot" = jsonb_set(task."snapshot", '{additions}', (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN jsonb_typeof(batch->'issues') = 'array' THEN jsonb_set(batch, '{issues}', (
      SELECT COALESCE(jsonb_agg(issue - 'baseBranch'), '[]'::jsonb)
      FROM jsonb_array_elements(batch->'issues') AS issues(issue)
    ), false) ELSE batch END
  ), '[]'::jsonb)
  FROM jsonb_array_elements(task."snapshot"->'additions') AS batches(batch)
), false)
WHERE jsonb_typeof(task."snapshot"->'additions') = 'array';
