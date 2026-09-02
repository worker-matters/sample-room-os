-- Historical whole-statement returns predate item-level return timestamps.
-- This changes no active business fact; it only aligns existing returned rows.
UPDATE "ReconciliationStatementItem" AS item
SET
  "returnedAt" = COALESCE(statement."returnedAt", statement."generatedAt"),
  "returnedBy" = statement."returnedBy"
FROM "ReconciliationStatement" AS statement
WHERE item."statementId" = statement."id"
  AND statement."status" = 'returned'
  AND item."returnedAt" IS NULL;

-- Never guess which statement is authoritative if historical data already has duplicates.
-- Stop the deployment with a readable diagnostic so the data can be reviewed first.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ReconciliationStatementItem"
    WHERE "returnedAt" IS NULL
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate active reconciliation items exist; review them before applying the concurrency guard';
  END IF;
END;
$migration$;

-- An order may belong to at most one currently effective reconciliation item.
CREATE UNIQUE INDEX "ReconciliationStatementItem_active_orderId_key"
ON "ReconciliationStatementItem" ("orderId")
WHERE "returnedAt" IS NULL;
