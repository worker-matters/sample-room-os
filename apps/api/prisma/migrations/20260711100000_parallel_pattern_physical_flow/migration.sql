ALTER TABLE "PatternTask"
ADD COLUMN "requirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "completedRequirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "totalWorkHours" DOUBLE PRECISION,
ADD COLUMN "completionNote" TEXT;

UPDATE "PatternTask" AS task
SET "requirements" = ARRAY(
  SELECT item
  FROM unnest(source_order."sampleRequestItems") AS item
  WHERE item = ANY(ARRAY[
    'pattern_making',
    'pattern_revision',
    'pattern_full_size',
    'quote_material_check',
    'bulk_material_check',
    'pattern_padding_amount',
    'pattern_zipper_length'
  ]::TEXT[])
)
FROM "Order" AS source_order
WHERE source_order."id" = task."orderId";

UPDATE "PatternTask"
SET "completedRequirements" = "requirements"
WHERE "status" IN ('completed', 'submitted', 'submitted_to_cutting');

-- The original V2 migration already created PatternTask_orderId_key. The
-- following repair is intentionally defensive for databases that drifted or
-- imported legacy data with more than one task per order. Keep one canonical
-- task, move every deliverable/submission to it, and archive the full duplicate
-- task row in OrderStatusLog before deleting it.
CREATE TEMP TABLE "_PatternTaskCanonical" AS
SELECT
  "id" AS "sourceTaskId",
  FIRST_VALUE("id") OVER (
    PARTITION BY "orderId"
    ORDER BY
      CASE
        WHEN "status" IN ('completed', 'submitted', 'submitted_to_cutting') THEN 0
        WHEN "status" IN ('active', 'in_progress') THEN 1
        WHEN "status" = 'paused' THEN 2
        WHEN "status" = 'pending' THEN 3
        ELSE 4
      END,
      COALESCE("completedAt", "submittedAt", "updatedAt") DESC,
      "updatedAt" DESC,
      "id" DESC
  ) AS "canonicalTaskId"
FROM "PatternTask";

INSERT INTO "OrderStatusLog" (
  "id",
  "orderId",
  "changedBy",
  "reason",
  "payload",
  "createdAt"
)
SELECT
  md5('phase1-pattern-task-dedup:' || task."id"),
  task."orderId",
  'migration',
  'pattern_task_deduplicated',
  jsonb_build_object(
    'canonicalPatternTaskId', mapping."canonicalTaskId",
    'archivedPatternTask', to_jsonb(task)
  ),
  NOW()
FROM "PatternTask" AS task
JOIN "_PatternTaskCanonical" AS mapping
  ON mapping."sourceTaskId" = task."id"
WHERE mapping."sourceTaskId" <> mapping."canonicalTaskId"
ON CONFLICT ("id") DO NOTHING;

UPDATE "PatternDeliverable" AS deliverable
SET "patternTaskId" = mapping."canonicalTaskId"
FROM "_PatternTaskCanonical" AS mapping
WHERE deliverable."patternTaskId" = mapping."sourceTaskId"
  AND mapping."sourceTaskId" <> mapping."canonicalTaskId";

UPDATE "SubmittedCuttingVersion" AS submission
SET "patternTaskId" = mapping."canonicalTaskId"
FROM "_PatternTaskCanonical" AS mapping
WHERE submission."patternTaskId" = mapping."sourceTaskId"
  AND mapping."sourceTaskId" <> mapping."canonicalTaskId";

WITH merged AS (
  SELECT
    mapping."canonicalTaskId",
    ARRAY(
      SELECT DISTINCT requirement
      FROM "PatternTask" AS sibling
      CROSS JOIN LATERAL unnest(sibling."requirements") AS requirement
      WHERE sibling."orderId" = canonical."orderId"
      ORDER BY requirement
    ) AS "requirements",
    ARRAY(
      SELECT DISTINCT requirement
      FROM "PatternTask" AS sibling
      CROSS JOIN LATERAL unnest(sibling."completedRequirements") AS requirement
      WHERE sibling."orderId" = canonical."orderId"
      ORDER BY requirement
    ) AS "completedRequirements",
    (
      SELECT MIN(sibling."startedAt")
      FROM "PatternTask" AS sibling
      WHERE sibling."orderId" = canonical."orderId"
    ) AS "startedAt",
    (
      SELECT MAX(sibling."completedAt")
      FROM "PatternTask" AS sibling
      WHERE sibling."orderId" = canonical."orderId"
    ) AS "completedAt",
    (
      SELECT MAX(sibling."submittedAt")
      FROM "PatternTask" AS sibling
      WHERE sibling."orderId" = canonical."orderId"
    ) AS "submittedAt",
    (
      SELECT MAX(sibling."totalWorkHours")
      FROM "PatternTask" AS sibling
      WHERE sibling."orderId" = canonical."orderId"
    ) AS "totalWorkHours",
    (
      SELECT sibling."completionNote"
      FROM "PatternTask" AS sibling
      WHERE sibling."orderId" = canonical."orderId"
        AND sibling."completionNote" IS NOT NULL
      ORDER BY
        sibling."completedAt" DESC NULLS LAST,
        sibling."submittedAt" DESC NULLS LAST,
        sibling."updatedAt" DESC,
        sibling."id" DESC
      LIMIT 1
    ) AS "completionNote",
    (
      SELECT sibling."patternMakerId"
      FROM "PatternTask" AS sibling
      WHERE sibling."orderId" = canonical."orderId"
        AND sibling."patternMakerId" IS NOT NULL
      ORDER BY
        CASE
          WHEN sibling."status" IN ('completed', 'submitted', 'submitted_to_cutting') THEN 0
          WHEN sibling."status" IN ('active', 'in_progress') THEN 1
          ELSE 2
        END,
        COALESCE(sibling."completedAt", sibling."submittedAt", sibling."updatedAt") DESC,
        sibling."updatedAt" DESC,
        sibling."id" DESC
      LIMIT 1
    ) AS "patternMakerId",
    (
      SELECT sibling."patternMakerName"
      FROM "PatternTask" AS sibling
      WHERE sibling."orderId" = canonical."orderId"
        AND sibling."patternMakerName" IS NOT NULL
      ORDER BY
        CASE
          WHEN sibling."status" IN ('completed', 'submitted', 'submitted_to_cutting') THEN 0
          WHEN sibling."status" IN ('active', 'in_progress') THEN 1
          ELSE 2
        END,
        COALESCE(sibling."completedAt", sibling."submittedAt", sibling."updatedAt") DESC,
        sibling."updatedAt" DESC,
        sibling."id" DESC
      LIMIT 1
    ) AS "patternMakerName"
  FROM "_PatternTaskCanonical" AS mapping
  JOIN "PatternTask" AS canonical ON canonical."id" = mapping."canonicalTaskId"
  GROUP BY mapping."canonicalTaskId", canonical."orderId"
)
UPDATE "PatternTask" AS canonical
SET
  "requirements" = merged."requirements",
  "completedRequirements" = ARRAY(
    SELECT completed
    FROM unnest(merged."completedRequirements") AS completed
    WHERE completed = ANY(merged."requirements")
  ),
  "startedAt" = COALESCE(merged."startedAt", canonical."startedAt"),
  "completedAt" = COALESCE(merged."completedAt", canonical."completedAt"),
  "submittedAt" = COALESCE(merged."submittedAt", canonical."submittedAt"),
  "totalWorkHours" = COALESCE(merged."totalWorkHours", canonical."totalWorkHours"),
  "completionNote" = COALESCE(merged."completionNote", canonical."completionNote"),
  "patternMakerId" = COALESCE(canonical."patternMakerId", merged."patternMakerId"),
  "patternMakerName" = COALESCE(canonical."patternMakerName", merged."patternMakerName")
FROM merged
WHERE canonical."id" = merged."canonicalTaskId";

DELETE FROM "PatternTask" AS task
USING "_PatternTaskCanonical" AS mapping
WHERE task."id" = mapping."sourceTaskId"
  AND mapping."sourceTaskId" <> mapping."canonicalTaskId";

DROP TABLE "_PatternTaskCanonical";

CREATE UNIQUE INDEX IF NOT EXISTS "PatternTask_orderId_key"
ON "PatternTask"("orderId");

-- Backfill the global pending pool for already-received orders that carry at
-- least one of the seven comprehensive pattern requirements.
INSERT INTO "PatternTask" (
  "id",
  "orderId",
  "status",
  "requirements",
  "completedRequirements",
  "createdAt",
  "updatedAt"
)
SELECT
  md5('phase1-pattern-task:' || source_order."id"),
  source_order."id",
  'pending',
  ARRAY(
    SELECT item
    FROM unnest(source_order."sampleRequestItems") AS item
    WHERE item = ANY(ARRAY[
      'pattern_making',
      'pattern_revision',
      'pattern_full_size',
      'quote_material_check',
      'bulk_material_check',
      'pattern_padding_amount',
      'pattern_zipper_length'
    ]::TEXT[])
  ),
  ARRAY[]::TEXT[],
  NOW(),
  NOW()
FROM "Order" AS source_order
WHERE source_order."intakeStatus" = 'received'
  AND source_order."terminated" = false
  AND source_order."sampleRequestItems" && ARRAY[
    'pattern_making',
    'pattern_revision',
    'pattern_full_size',
    'quote_material_check',
    'bulk_material_check',
    'pattern_padding_amount',
    'pattern_zipper_length'
  ]::TEXT[]
  AND NOT EXISTS (
    SELECT 1
    FROM "PatternTask" AS existing
    WHERE existing."orderId" = source_order."id"
  );

-- Normalize legacy single-threaded stages and stages contradicted by completed
-- physical scan facts. Existing scan facts win; when no physical fact exists,
-- only legacy stages are moved to the first selected physical route. Orders with
-- no physical route are done. This never fabricates scan history.
CREATE TEMP TABLE "_OrderStageRepair" AS
SELECT
  source_order."id" AS "orderId",
  source_order."stage" AS "oldStage",
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "ScanRecord" AS scan
      WHERE scan."orderId" = source_order."id" AND scan."action" = 'qc_delivery_finish'
    ) THEN 'done'::"OrderStage"
    WHEN EXISTS (
      SELECT 1 FROM "ScanRecord" AS scan
      WHERE scan."orderId" = source_order."id" AND scan."action" = 'sewing_finish'
    ) THEN 'qc_delivery_waiting'::"OrderStage"
    WHEN EXISTS (
      SELECT 1 FROM "ScanRecord" AS scan
      WHERE scan."orderId" = source_order."id" AND scan."action" = 'sewing_start'
    ) THEN 'sewing_doing'::"OrderStage"
    WHEN EXISTS (
      SELECT 1 FROM "ScanRecord" AS scan
      WHERE scan."orderId" = source_order."id" AND scan."action" = 'cutting_finish'
    ) THEN CASE
      WHEN 'sample_garment' = ANY(source_order."sampleRequestItems")
        THEN 'sewing_waiting'::"OrderStage"
      ELSE 'done'::"OrderStage"
    END
    WHEN 'cutting' = ANY(source_order."sampleRequestItems")
      THEN 'cutting_waiting'::"OrderStage"
    WHEN 'sample_garment' = ANY(source_order."sampleRequestItems")
      THEN 'sewing_waiting'::"OrderStage"
    ELSE 'done'::"OrderStage"
  END AS "newStage"
FROM "Order" AS source_order
WHERE source_order."intakeStatus" = 'received'
  AND source_order."terminated" = false
  AND (
    source_order."stage" IN ('pattern_waiting', 'pattern_doing', 'cutting_handoff_waiting')
    OR NOT (
      'cutting' = ANY(source_order."sampleRequestItems")
      OR 'sample_garment' = ANY(source_order."sampleRequestItems")
    )
    OR EXISTS (
      SELECT 1 FROM "ScanRecord" AS scan
      WHERE scan."orderId" = source_order."id"
        AND scan."action" IN ('cutting_finish', 'sewing_start', 'sewing_finish', 'qc_delivery_finish')
    )
  );

INSERT INTO "OrderStatusLog" (
  "id",
  "orderId",
  "fromStage",
  "toStage",
  "changedBy",
  "reason",
  "payload",
  "createdAt"
)
SELECT
  md5('phase1-order-stage-repair:' || repair."orderId"),
  repair."orderId",
  repair."oldStage"::TEXT,
  repair."newStage"::TEXT,
  'migration',
  'parallel_physical_route_stage_repair',
  jsonb_build_object(
    'assumption', 'existing physical scan facts win; otherwise use first selected physical route',
    'oldStage', repair."oldStage",
    'newStage', repair."newStage"
  ),
  NOW()
FROM "_OrderStageRepair" AS repair
WHERE repair."oldStage" IS DISTINCT FROM repair."newStage"
ON CONFLICT ("id") DO NOTHING;

UPDATE "Order" AS source_order
SET "stage" = repair."newStage"
FROM "_OrderStageRepair" AS repair
WHERE source_order."id" = repair."orderId"
  AND source_order."stage" IS NOT DISTINCT FROM repair."oldStage";

DROP TABLE "_OrderStageRepair";

-- Legacy in_progress represented the same current-task concept as active. Normalize
-- every owned current task in one ranking, keep only the newest as active, and pause
-- the rest before adding a database guard that covers both spellings.
WITH ranked_current AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "patternMakerId"
      ORDER BY "updatedAt" DESC, "id" DESC
    ) AS current_rank
  FROM "PatternTask"
  WHERE "status" IN ('active', 'in_progress')
    AND "patternMakerId" IS NOT NULL
)
UPDATE "PatternTask" AS task
SET
  "status" = CASE WHEN ranked_current.current_rank = 1 THEN 'active'::"PatternTaskStatus" ELSE 'paused'::"PatternTaskStatus" END,
  "pausedAt" = CASE
    WHEN ranked_current.current_rank = 1 THEN NULL
    ELSE COALESCE(task."pausedAt", NOW())
  END,
  "pausedReason" = CASE
    WHEN ranked_current.current_rank = 1 THEN NULL
    ELSE COALESCE(
      task."pausedReason",
      'migration: duplicate historical current task normalized before unique guard'
    )
  END
FROM ranked_current
WHERE task."id" = ranked_current."id";

-- An active/in-progress row without an owner cannot appear in any maker's current
-- workbench. Return it to the global pending pool instead of leaving an orphan.
UPDATE "PatternTask"
SET
  "status" = 'pending',
  "patternMakerName" = NULL,
  "pausedAt" = NULL,
  "pausedReason" = NULL
WHERE "status" IN ('active', 'in_progress')
  AND "patternMakerId" IS NULL;

CREATE UNIQUE INDEX "PatternTask_one_active_per_pattern_maker"
ON "PatternTask"("patternMakerId")
WHERE "status" IN ('active', 'in_progress') AND "patternMakerId" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PatternTask"
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'PatternTask migration failed: duplicate orderId remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    JOIN pg_index AS index_definition ON index_definition.indexrelid = index_class.oid
    JOIN pg_class AS table_class ON table_class.oid = index_definition.indrelid
    WHERE index_class.relname = 'PatternTask_orderId_key'
      AND table_class.relname = 'PatternTask'
      AND index_definition.indisunique
      AND pg_get_indexdef(index_definition.indexrelid) LIKE '%("orderId")%'
  ) THEN
    RAISE EXCEPTION 'PatternTask migration failed: orderId unique index is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PatternTask"
    WHERE "status" = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'PatternTask migration failed: legacy in_progress status remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PatternTask"
    WHERE "patternMakerId" IS NOT NULL
      AND "status" IN ('active', 'in_progress')
    GROUP BY "patternMakerId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'PatternTask migration failed: pattern maker has multiple current tasks';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    JOIN pg_index AS index_definition ON index_definition.indexrelid = index_class.oid
    JOIN pg_class AS table_class ON table_class.oid = index_definition.indrelid
    WHERE index_class.relname = 'PatternTask_one_active_per_pattern_maker'
      AND table_class.relname = 'PatternTask'
      AND index_definition.indisunique
      AND index_definition.indpred IS NOT NULL
      AND pg_get_expr(index_definition.indpred, index_definition.indrelid) LIKE '%active%'
      AND pg_get_expr(index_definition.indpred, index_definition.indrelid) LIKE '%in_progress%'
  ) THEN
    RAISE EXCEPTION 'PatternTask migration failed: current-task unique guard is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OrderStatusLog" AS audit
    JOIN "PatternTask" AS canonical
      ON canonical."id" = audit."payload" ->> 'canonicalPatternTaskId'
    WHERE audit."reason" = 'pattern_task_deduplicated'
      AND audit."payload" -> 'archivedPatternTask' ->> 'status'
        IN ('completed', 'submitted', 'submitted_to_cutting')
      AND canonical."status" NOT IN ('completed', 'submitted', 'submitted_to_cutting')
  ) THEN
    RAISE EXCEPTION 'PatternTask migration failed: a final duplicate was replaced by a non-final task';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OrderStatusLog" AS audit
    JOIN "PatternTask" AS canonical
      ON canonical."id" = audit."payload" ->> 'canonicalPatternTaskId'
    WHERE audit."reason" = 'pattern_task_deduplicated'
      AND (
        (
          audit."payload" -> 'archivedPatternTask' ->> 'completedAt' IS NOT NULL
          AND canonical."completedAt" IS NULL
        )
        OR (
          audit."payload" -> 'archivedPatternTask' ->> 'submittedAt' IS NOT NULL
          AND canonical."submittedAt" IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'PatternTask migration failed: duplicate completion timestamps were not merged';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Order"
    WHERE "intakeStatus" = 'received'
      AND "terminated" = false
      AND "stage" IN ('pattern_waiting', 'pattern_doing', 'cutting_handoff_waiting')
  ) THEN
    RAISE EXCEPTION 'Order migration failed: legacy single-thread stage remains';
  END IF;
END $$;
