ALTER TABLE "Order" ADD COLUMN "folderCode" TEXT;

WITH ordered AS (
  SELECT
    id,
    "createdAt",
    row_number() OVER (
      PARTITION BY to_char("createdAt", 'YYYYMMDD')
      ORDER BY "createdAt", id
    ) AS sequence_number
  FROM "Order"
)
UPDATE "Order" AS target
SET "folderCode" =
  'SR' ||
  to_char(ordered."createdAt", 'YYYYMMDD') ||
  lpad(ordered.sequence_number::text, 3, '0')
FROM ordered
WHERE target.id = ordered.id;

ALTER TABLE "Order" ALTER COLUMN "folderCode" SET NOT NULL;

CREATE UNIQUE INDEX "Order_folderCode_key" ON "Order"("folderCode");
