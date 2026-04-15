-- Multi-platform creator normalization and analytics extraction columns
-- NOTE: This migration performs a best-effort backfill from legacy TikTok-only fields.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Create platform_accounts table
CREATE TABLE IF NOT EXISTS "platform_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "platform_account_id" TEXT,
    "platform_handle" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);

-- 2) Backfill platform accounts from legacy creators.tiktokHandle/tiktokId
INSERT INTO "platform_accounts" (
    "creator_id",
    "platform",
    "platform_account_id",
    "platform_handle",
    "verified"
)
SELECT
    c."id",
    'tiktok',
    c."tiktokId",
    c."tiktokHandle",
    c."verified"
FROM "creators" c
WHERE c."tiktokHandle" IS NOT NULL
ON CONFLICT ("platform", "platform_handle") DO NOTHING;

-- 3) Add indexes/constraints
CREATE INDEX IF NOT EXISTS "platform_accounts_creator_id_idx" ON "platform_accounts"("creator_id");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_accounts_platform_platform_handle_key" ON "platform_accounts"("platform", "platform_handle");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_accounts_platform_platform_account_id_key" ON "platform_accounts"("platform", "platform_account_id");

ALTER TABLE "platform_accounts"
    ADD CONSTRAINT "platform_accounts_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "creators"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- 4) Add extracted analytics columns
ALTER TABLE "feed_items"
    ADD COLUMN IF NOT EXISTS "likesCount" INTEGER,
    ADD COLUMN IF NOT EXISTS "commentsCount" INTEGER,
    ADD COLUMN IF NOT EXISTS "sharesCount" INTEGER;

CREATE INDEX IF NOT EXISTS "feed_items_likesCount_idx" ON "feed_items"("likesCount");
CREATE INDEX IF NOT EXISTS "feed_items_commentsCount_idx" ON "feed_items"("commentsCount");
CREATE INDEX IF NOT EXISTS "feed_items_sharesCount_idx" ON "feed_items"("sharesCount");

ALTER TABLE "creator_reach"
    ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'tiktok',
    ADD COLUMN IF NOT EXISTS "likesCount" INTEGER,
    ADD COLUMN IF NOT EXISTS "commentsCount" INTEGER,
    ADD COLUMN IF NOT EXISTS "sharesCount" INTEGER;

DROP INDEX IF EXISTS "creator_reach_creatorId_date_key";
CREATE UNIQUE INDEX IF NOT EXISTS "creator_reach_creatorId_platform_date_key" ON "creator_reach"("creatorId", "platform", "date");
DROP INDEX IF EXISTS "creator_reach_creatorId_idx";
CREATE INDEX IF NOT EXISTS "creator_reach_creatorId_platform_idx" ON "creator_reach"("creatorId", "platform");

-- 5) Remove legacy TikTok-hardcoded creator columns
ALTER TABLE "creators" DROP COLUMN IF EXISTS "tiktokHandle";
ALTER TABLE "creators" DROP COLUMN IF EXISTS "tiktokId";
