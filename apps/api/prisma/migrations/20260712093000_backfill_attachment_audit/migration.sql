INSERT INTO "AttachmentAuditLog" (
  "id", "orderId", "attachmentId", "originalFileName", "action",
  "actorId", "actorName", "actorRole", "originalUploaderId",
  "originalUploaderName", "originalUploaderRole", "attachmentCategory",
  "sourceCategory", "patternTaskId", "patternTaskCategory", "createdAt"
)
SELECT
  'attachment-upload-' || attachment."id",
  attachment."orderId",
  attachment."id",
  attachment."fileName",
  'upload',
  COALESCE(attachment."uploadedBy", 'historical-unknown'),
  attachment."uploadedByName",
  COALESCE(attachment."uploadedByRole", 'receiver'::"Role"),
  COALESCE(attachment."uploadedBy", 'historical-unknown'),
  attachment."uploadedByName",
  COALESCE(attachment."uploadedByRole", 'receiver'::"Role"),
  attachment."category",
  CASE
    WHEN attachment."uploadedByRole" = 'client_user' THEN 'client_upload'
    WHEN attachment."uploadedByRole" = 'pattern_maker' THEN 'pattern_maker_upload'
    ELSE 'sample_room_upload'
  END,
  attachment."patternTaskId",
  attachment."patternTaskCategory",
  attachment."createdAt"
FROM "OrderAttachment" attachment
WHERE NOT EXISTS (
  SELECT 1 FROM "AttachmentAuditLog" log
  WHERE log."attachmentId" = attachment."id" AND log."action" = 'upload'
);

INSERT INTO "AttachmentAuditLog" (
  "id", "orderId", "attachmentId", "originalFileName", "action",
  "actorId", "actorName", "actorRole", "originalUploaderId",
  "originalUploaderName", "originalUploaderRole", "attachmentCategory",
  "sourceCategory", "patternTaskId", "patternTaskCategory", "createdAt"
)
SELECT
  'deliverable-upload-' || deliverable."id",
  deliverable."orderId",
  deliverable."id",
  COALESCE(deliverable."fileName", deliverable."version" || '-' || deliverable."type"::text),
  'upload',
  deliverable."uploadedBy",
  deliverable."uploadedByName",
  'pattern_maker'::"Role",
  deliverable."uploadedBy",
  deliverable."uploadedByName",
  'pattern_maker'::"Role",
  deliverable."type"::text,
  'pattern_maker_upload',
  deliverable."patternTaskId",
  deliverable."taskCategory",
  deliverable."createdAt"
FROM "PatternDeliverable" deliverable
WHERE deliverable."archivedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "AttachmentAuditLog" log
    WHERE log."attachmentId" = deliverable."id" AND log."action" = 'upload'
  );
