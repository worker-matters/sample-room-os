-- ClientUser is the stable customer-salesperson business profile.
-- Account is an optional login identity and must not be required for order attribution.
ALTER TABLE "ClientUser"
  ALTER COLUMN "accountId" DROP NOT NULL;

-- Registration-code applications keep the applicant-selected username and only
-- the password hash across restarts so approval behaves the same in Prisma and memory modes.
ALTER TABLE "BusinessUserRequest"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'supervisor_request',
  ADD COLUMN IF NOT EXISTS "requestedUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "requestedPasswordHash" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"BusinessUserRequest"'::regclass
      AND conname = 'BusinessUserRequest_source_check'
  ) THEN
    ALTER TABLE "BusinessUserRequest"
      ADD CONSTRAINT "BusinessUserRequest_source_check"
      CHECK ("source" IN ('supervisor_request', 'supervisor_registration_code'));
  END IF;
END
$$;

-- Keep the existing unique index. PostgreSQL permits multiple NULL values while
-- still preventing one Account from being linked to multiple profiles.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'ClientUser'
      AND indexname = 'ClientUser_accountId_key'
  ) THEN
    RAISE EXCEPTION 'ClientUser account uniqueness guard is missing';
  END IF;
END
$$;
