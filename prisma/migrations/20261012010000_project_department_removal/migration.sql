BEGIN;

ALTER TABLE "projects" DROP CONSTRAINT "projects_department_id_fkey";
DROP INDEX "projects_department_id_name_key";
ALTER TABLE "projects" DROP COLUMN "department_id";

COMMIT;
