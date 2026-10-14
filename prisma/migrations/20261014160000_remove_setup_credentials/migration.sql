BEGIN;

ALTER TABLE "system_setup"
    DROP COLUMN "token_hash",
    DROP COLUMN "token_expires_at";

COMMIT;
