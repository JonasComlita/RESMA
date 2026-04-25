-- CreateEnum
CREATE TYPE "AccessPackage" AS ENUM ('CONTRIBUTOR_FREE', 'CREATOR_PRO', 'AGENCY_PILOT', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "AgencyReportType" AS ENUM ('AUDIENCE_OPPORTUNITY_BRIEF', 'COMPETITOR_REACH_SNAPSHOT', 'RECOMMENDATION_GAP_REPORT');

-- CreateEnum
CREATE TYPE "AgencyReportShareStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AgencyReportAuditEventType" AS ENUM (
    'PRESET_CREATED',
    'PRESET_UPDATED',
    'PRESET_ARCHIVED',
    'RUN_GENERATED',
    'EXPORT_ACCESSED',
    'SHARE_CREATED',
    'SHARE_VIEWED',
    'SHARE_REVOKED'
);

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "accessPackage" "AccessPackage" NOT NULL DEFAULT 'CONTRIBUTOR_FREE';

-- AlterTable
ALTER TABLE "api_keys"
ADD COLUMN "accessPackage" "AccessPackage" NOT NULL DEFAULT 'CONTRIBUTOR_FREE';

-- Backfill from current creator/premium state
UPDATE "users"
SET "accessPackage" = CASE
    WHEN "subscriptionTier" = 'PREMIUM' AND "userType" = 'CREATOR' THEN 'CREATOR_PRO'::"AccessPackage"
    WHEN "subscriptionTier" = 'PREMIUM' THEN 'CREATOR_PRO'::"AccessPackage"
    ELSE 'CONTRIBUTOR_FREE'::"AccessPackage"
END;

UPDATE "api_keys" ak
SET "accessPackage" = u."accessPackage"
FROM "users" u
WHERE ak."userId" = u."id";

-- CreateTable
CREATE TABLE "agency_report_presets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportType" "AgencyReportType" NOT NULL,
    "accessPackage" "AccessPackage" NOT NULL,
    "platform" TEXT NOT NULL,
    "reportConfig" JSONB NOT NULL,
    "freshnessTier" TEXT NOT NULL DEFAULT 'standard',
    "allowedExportFormats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastRunAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_report_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_report_runs" (
    "id" TEXT NOT NULL,
    "presetId" TEXT,
    "userId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "reportType" "AgencyReportType" NOT NULL,
    "accessPackage" "AccessPackage" NOT NULL,
    "platform" TEXT NOT NULL,
    "reportTitle" TEXT NOT NULL,
    "reportConfig" JSONB NOT NULL,
    "resultPayload" JSONB NOT NULL,
    "freshnessTier" TEXT NOT NULL DEFAULT 'standard',
    "availableExportFormats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "watermarkKey" TEXT,
    "latestDataAt" TIMESTAMP(3),
    "qualityGateStatus" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_report_shares" (
    "id" TEXT NOT NULL,
    "reportRunId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "status" "AgencyReportShareStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "agency_report_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_report_audit_events" (
    "id" TEXT NOT NULL,
    "eventType" "AgencyReportAuditEventType" NOT NULL,
    "presetId" TEXT,
    "reportRunId" TEXT,
    "reportShareId" TEXT,
    "userId" TEXT,
    "apiKeyId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_report_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_report_presets_userId_archivedAt_idx" ON "agency_report_presets"("userId", "archivedAt");
CREATE INDEX "agency_report_presets_reportType_platform_idx" ON "agency_report_presets"("reportType", "platform");
CREATE INDEX "agency_report_runs_userId_generatedAt_idx" ON "agency_report_runs"("userId", "generatedAt");
CREATE INDEX "agency_report_runs_presetId_generatedAt_idx" ON "agency_report_runs"("presetId", "generatedAt");
CREATE INDEX "agency_report_runs_reportType_platform_idx" ON "agency_report_runs"("reportType", "platform");
CREATE UNIQUE INDEX "agency_report_shares_tokenHash_key" ON "agency_report_shares"("tokenHash");
CREATE INDEX "agency_report_shares_reportRunId_status_idx" ON "agency_report_shares"("reportRunId", "status");
CREATE INDEX "agency_report_audit_events_createdAt_eventType_idx" ON "agency_report_audit_events"("createdAt", "eventType");
CREATE INDEX "agency_report_audit_events_reportRunId_createdAt_idx" ON "agency_report_audit_events"("reportRunId", "createdAt");
CREATE INDEX "agency_report_audit_events_presetId_createdAt_idx" ON "agency_report_audit_events"("presetId", "createdAt");

-- AddForeignKey
ALTER TABLE "agency_report_presets"
ADD CONSTRAINT "agency_report_presets_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_report_runs"
ADD CONSTRAINT "agency_report_runs_presetId_fkey"
FOREIGN KEY ("presetId") REFERENCES "agency_report_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agency_report_runs"
ADD CONSTRAINT "agency_report_runs_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_report_runs"
ADD CONSTRAINT "agency_report_runs_apiKeyId_fkey"
FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agency_report_shares"
ADD CONSTRAINT "agency_report_shares_reportRunId_fkey"
FOREIGN KEY ("reportRunId") REFERENCES "agency_report_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_report_audit_events"
ADD CONSTRAINT "agency_report_audit_events_presetId_fkey"
FOREIGN KEY ("presetId") REFERENCES "agency_report_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agency_report_audit_events"
ADD CONSTRAINT "agency_report_audit_events_reportRunId_fkey"
FOREIGN KEY ("reportRunId") REFERENCES "agency_report_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agency_report_audit_events"
ADD CONSTRAINT "agency_report_audit_events_reportShareId_fkey"
FOREIGN KEY ("reportShareId") REFERENCES "agency_report_shares"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agency_report_audit_events"
ADD CONSTRAINT "agency_report_audit_events_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agency_report_audit_events"
ADD CONSTRAINT "agency_report_audit_events_apiKeyId_fkey"
FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
