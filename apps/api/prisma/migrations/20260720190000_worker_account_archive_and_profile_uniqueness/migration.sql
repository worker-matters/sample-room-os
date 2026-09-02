-- Worker Account deletion is a logical archive so historical production attribution
-- remains attached to the same Account and WorkerProfile identities.
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'archived';

-- One Account keeps at most one stable profile identity for each production stage.
-- Direct stage changes reactivate that row instead of creating duplicate histories.
CREATE UNIQUE INDEX "WorkerProfile_accountId_workerType_key"
ON "WorkerProfile"("accountId", "workerType");
