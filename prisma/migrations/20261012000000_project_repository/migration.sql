BEGIN;

ALTER TABLE "projects" ADD COLUMN "remote_url" TEXT;

UPDATE "projects" AS project
SET "remote_url" = repository."remote_url"
FROM "repositories" AS repository
WHERE project."repository_id" = repository."id";

ALTER TABLE "projects" ALTER COLUMN "remote_url" SET NOT NULL;
ALTER TABLE "projects" DROP CONSTRAINT "projects_repository_id_fkey";
ALTER TABLE "projects" DROP COLUMN "repository_id";
DROP TABLE "repositories";

COMMIT;
