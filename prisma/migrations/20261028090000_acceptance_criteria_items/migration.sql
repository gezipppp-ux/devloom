BEGIN;
-- Retain the exact source so an operator can audit or restore any conversion.
CREATE TABLE "acceptance_criteria_migration_backup" AS
SELECT "id" AS "issue_id", "acceptance_criteria" AS "original_text"
FROM "project_issues" WHERE "acceptance_criteria" <> '';
ALTER TABLE "acceptance_criteria_migration_backup" ADD PRIMARY KEY ("issue_id"), ALTER COLUMN "original_text" SET NOT NULL;

CREATE OR REPLACE FUNCTION pg_temp.devloom_criteria_items(original TEXT) RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  line TEXT;
  current_item TEXT := '';
  result TEXT[] := ARRAY[]::TEXT[];
  fence TEXT := '';
  fence_marker TEXT;
BEGIN
  IF btrim(original, E' \t\r\n') = '' THEN RETURN result; END IF;
  FOREACH line IN ARRAY regexp_split_to_array(original, E'\r?\n') LOOP
    fence_marker := (regexp_match(line, '^\s*(```|~~~)'))[1];
    IF fence_marker IS NOT NULL THEN
      IF fence = '' THEN fence := fence_marker; ELSIF fence_marker = fence THEN fence := ''; END IF;
    END IF;
    IF fence = '' AND line ~ '^([-*+]\s+|[0-9]+[.)]\s+)' THEN
      IF btrim(current_item, E' \t\r\n') <> '' THEN result := array_append(result, btrim(current_item, E' \t\r\n')); END IF;
      current_item := regexp_replace(line, '^([-*+]\s+|[0-9]+[.)]\s+)(\[[ xX]\]\s*)?', '');
    ELSE
      current_item := CASE WHEN current_item = '' THEN line ELSE current_item || E'\n' || line END;
    END IF;
  END LOOP;
  IF btrim(current_item, E' \t\r\n') <> '' THEN result := array_append(result, btrim(current_item, E' \t\r\n')); END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.devloom_criteria_json(value JSONB) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result JSONB;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(key, CASE WHEN key = 'acceptanceCriteria' AND jsonb_typeof(item) = 'string'
      THEN to_jsonb(pg_temp.devloom_criteria_items(item #>> '{}')) ELSE pg_temp.devloom_criteria_json(item) END), '{}'::jsonb)
      INTO result FROM jsonb_each(value) AS entries(key, item);
    RETURN result;
  ELSIF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.devloom_criteria_json(item) ORDER BY position), '[]'::jsonb)
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item, position);
    RETURN result;
  END IF;
  RETURN value;
END $$;

CREATE TABLE "acceptance_criteria_task_backup" AS SELECT "id", "snapshot" FROM "development_tasks"
WHERE "snapshot" IS DISTINCT FROM pg_temp.devloom_criteria_json("snapshot");
CREATE TABLE "acceptance_criteria_task_link_backup" AS SELECT "task_id", "issue_id", "snapshot" FROM "task_issue_links"
WHERE "snapshot" IS DISTINCT FROM pg_temp.devloom_criteria_json("snapshot");
CREATE TABLE "acceptance_criteria_mcp_receipt_backup" AS SELECT "user_id", "request_id", "result" FROM "mcp_operations"
WHERE "result" IS DISTINCT FROM pg_temp.devloom_criteria_json("result");
ALTER TABLE "acceptance_criteria_task_backup" ADD PRIMARY KEY ("id"), ALTER COLUMN "snapshot" SET NOT NULL;
ALTER TABLE "acceptance_criteria_task_link_backup" ADD PRIMARY KEY ("task_id", "issue_id"), ALTER COLUMN "snapshot" SET NOT NULL;
ALTER TABLE "acceptance_criteria_mcp_receipt_backup" ADD PRIMARY KEY ("user_id", "request_id"), ALTER COLUMN "result" SET NOT NULL;
UPDATE "development_tasks" SET "snapshot" = pg_temp.devloom_criteria_json("snapshot") WHERE "id" IN (SELECT "id" FROM "acceptance_criteria_task_backup");
UPDATE "task_issue_links" SET "snapshot" = pg_temp.devloom_criteria_json("snapshot") WHERE ("task_id", "issue_id") IN (SELECT "task_id", "issue_id" FROM "acceptance_criteria_task_link_backup");
UPDATE "mcp_operations" SET "result" = pg_temp.devloom_criteria_json("result") WHERE ("user_id", "request_id") IN (SELECT "user_id", "request_id" FROM "acceptance_criteria_mcp_receipt_backup");

ALTER TABLE "project_issues" ALTER COLUMN "acceptance_criteria" DROP DEFAULT;
ALTER TABLE "project_issues" ALTER COLUMN "acceptance_criteria" TYPE TEXT[] USING pg_temp.devloom_criteria_items("acceptance_criteria");
ALTER TABLE "project_issues" ALTER COLUMN "acceptance_criteria" SET DEFAULT ARRAY[]::TEXT[];
COMMIT;
