CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "ingest_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "uploadId" TEXT NOT NULL,
    "snapshotId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ingest_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ingest_events_userId_uploadId_key" ON "ingest_events"("userId", "uploadId");
CREATE UNIQUE INDEX "ingest_events_snapshotId_key" ON "ingest_events"("snapshotId");
CREATE INDEX "ingest_events_userId_idx" ON "ingest_events"("userId");

ALTER TABLE "ingest_events"
    ADD CONSTRAINT "ingest_events_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "ingest_events"
    ADD CONSTRAINT "ingest_events_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "feed_snapshots"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
