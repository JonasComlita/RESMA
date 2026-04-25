import { createHmac, randomBytes } from 'node:crypto';
import type {
    AccessPackage,
    AgencyReportAuditEventType,
    AgencyReportPreset,
    AgencyReportRun,
    AgencyReportShare,
    AgencyReportType as PrismaAgencyReportType,
    ApiKey,
    Prisma,
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import {
    AudienceForecastInputError,
    computeAudienceForecastFromModel,
    generateAudienceForecast,
    type AudienceForecastResult,
    type AudienceForecastOptions,
    loadMaterializedAudienceModelContext,
} from './audienceForecast.js';
import { cohortLabel } from './audienceForecastModel.js';
import { generateDataQualityDiagnostics, type DataQualityDiagnosticsResult } from './dataQuality.js';
import { generateGoToMarketCohortBrief, type GoToMarketBriefResult } from './goToMarketBrief.js';
import { generateRecommendationMap, type RecommendationMapResult } from './recommendationTraversal.js';
import {
    type AgencyReportType,
    type FreshnessTier,
    type ReportFormat,
    getPackageEntitlements,
    isExportFormatAllowed,
    isFreshnessTierAllowed,
    isPlatformAllowed,
    isReportTypeAllowed,
    normalizeFreshnessTier,
} from './packageAccess.js';

export interface ClientReportSection {
    title: string;
    bullets?: string[];
    bodyMarkdown?: string;
    tableRows?: Array<Record<string, unknown>>;
    metrics?: Record<string, unknown>;
}

export interface ClientReportDocument {
    title: string;
    subtitle: string;
    deliverable: AgencyReportType;
    packageLabel: string;
    generatedAt: string;
    latestDataAt: string | null;
    freshnessTier: FreshnessTier;
    privacyMode: 'aggregate-only';
    summaryPoints: string[];
    caveats: string[];
    sections: ClientReportSection[];
}

export interface LlmReportEnvelope {
    kind: string;
    title: string;
    bullets: string[];
    markdown: string;
    followUpQuestions: string[];
    caveats: string[];
}

export interface StoredAgencyReportPayload {
    deliverable: AgencyReportType;
    generatedAt: string;
    latestDataAt: string | null;
    freshnessTier: FreshnessTier;
    watermarkKey: string | null;
    packageAccess: AccessPackage;
    title: string;
    subtitle: string;
    summaryPoints: string[];
    caveats: string[];
    exports: {
        markdown: string;
        llm: LlmReportEnvelope;
        clientReport: ClientReportDocument;
    };
    sourceData: Record<string, unknown>;
}

export interface PublicAgencyReportExport {
    kind: 'agency_report_export';
    deliverable: AgencyReportType;
    title: string;
    subtitle: string;
    packageLabel: string;
    generatedAt: string;
    latestDataAt: string | null;
    freshnessTier: FreshnessTier;
    privacyMode: 'aggregate-only';
    summaryPoints: string[];
    caveats: string[];
    sections: ClientReportSection[];
}

export interface AgencyReportConfig {
    platform: string;
    targetVideoId?: string;
    seedVideoId?: string;
    trackedVideoIds?: string[];
    cohortId?: string;
    topCohorts?: number;
    maxDepth?: number;
    beamWidth?: number;
    maxNodes?: number;
    maxPathsPerCohort?: number;
    pathBranchLimit?: number;
    windowHours?: number;
    freshnessTier?: FreshnessTier;
    competitorLabel?: string;
}

export interface AgencyReportRunSummary {
    id: string;
    presetId: string | null;
    reportType: PrismaAgencyReportType;
    accessPackage: AccessPackage;
    platform: string;
    reportTitle: string;
    freshnessTier: string;
    availableExportFormats: string[];
    qualityGateStatus: string | null;
    latestDataAt: Date | null;
    generatedAt: Date;
    createdAt: Date;
    shareCount?: number;
    preview: {
        deliverable: AgencyReportType;
        summaryPoints: string[];
        caveats: string[];
        privacyMode: 'aggregate-only';
    };
}

export class AgencyReportInputError extends Error {
    statusCode: number;
    details?: Record<string, unknown>;

    constructor(message: string, statusCode = 400, details?: Record<string, unknown>) {
        super(message);
        this.name = 'AgencyReportInputError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(value)));
}

function percent(value: number | null | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'unknown';
    }

    return `${Math.round(value * 100)}%`;
}

function roundTo(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function asAgencyReportType(rawValue: unknown): AgencyReportType {
    if (typeof rawValue !== 'string') {
        throw new AgencyReportInputError('reportType is required');
    }

    const normalized = rawValue.trim().toUpperCase() as AgencyReportType;
    if (
        normalized !== 'AUDIENCE_OPPORTUNITY_BRIEF'
        && normalized !== 'COMPETITOR_REACH_SNAPSHOT'
        && normalized !== 'RECOMMENDATION_GAP_REPORT'
    ) {
        throw new AgencyReportInputError('Unsupported reportType');
    }

    return normalized;
}

function normalizePlatform(rawValue: unknown) {
    if (typeof rawValue !== 'string') {
        throw new AgencyReportInputError('platform is required');
    }

    const normalized = rawValue.trim().toLowerCase();
    if (!normalized) {
        throw new AgencyReportInputError('platform is required');
    }

    return normalized;
}

function normalizeVideoId(rawValue: unknown, fieldName: string, required = true) {
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
        if (required) {
            throw new AgencyReportInputError(`${fieldName} is required`);
        }
        return undefined;
    }

    return rawValue.trim();
}

function normalizeTrackedVideoIds(rawValue: unknown, maxTrackedVideoIds: number) {
    if (!Array.isArray(rawValue)) {
        throw new AgencyReportInputError('trackedVideoIds must be an array of video ids');
    }

    const values = Array.from(new Set(
        rawValue
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean),
    ));

    if (values.length === 0) {
        throw new AgencyReportInputError('trackedVideoIds must contain at least one video id');
    }

    if (values.length > maxTrackedVideoIds) {
        throw new AgencyReportInputError(`trackedVideoIds cannot exceed ${maxTrackedVideoIds} items`);
    }

    return values;
}

export function normalizeAgencyReportConfig(
    reportType: AgencyReportType,
    rawConfig: unknown,
    accessPackage: AccessPackage,
): AgencyReportConfig {
    const entitlements = getPackageEntitlements(accessPackage);
    const source = (rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig))
        ? rawConfig as Record<string, unknown>
        : {};
    const platform = normalizePlatform(source.platform);

    if (!isPlatformAllowed(accessPackage, platform)) {
        throw new AgencyReportInputError(`Package ${accessPackage} does not allow ${platform} reports`, 403);
    }

    const freshnessTier = normalizeFreshnessTier(source.freshnessTier);
    if (!isFreshnessTierAllowed(accessPackage, freshnessTier)) {
        throw new AgencyReportInputError(`Package ${accessPackage} does not allow ${freshnessTier} freshness`, 403);
    }

    const base: AgencyReportConfig = {
        platform,
        freshnessTier,
        topCohorts: clampNumber(source.topCohorts as number | undefined, 1, 12, 5),
        maxDepth: clampNumber(source.maxDepth as number | undefined, 1, 6, 3),
        beamWidth: clampNumber(source.beamWidth as number | undefined, 5, 120, 30),
        maxNodes: clampNumber(source.maxNodes as number | undefined, 1, 300, 40),
        maxPathsPerCohort: clampNumber(source.maxPathsPerCohort as number | undefined, 1, 10, 3),
        pathBranchLimit: clampNumber(source.pathBranchLimit as number | undefined, 1, 25, 6),
        windowHours: clampNumber(source.windowHours as number | undefined, 1, 24 * 180, 24 * 14),
        competitorLabel: typeof source.competitorLabel === 'string' ? source.competitorLabel.trim() || undefined : undefined,
        cohortId: typeof source.cohortId === 'string' ? source.cohortId.trim() || undefined : undefined,
    };

    if (reportType === 'AUDIENCE_OPPORTUNITY_BRIEF') {
        return {
            ...base,
            targetVideoId: normalizeVideoId(source.targetVideoId, 'targetVideoId'),
            seedVideoId: normalizeVideoId(source.seedVideoId, 'seedVideoId', false),
        };
    }

    if (reportType === 'RECOMMENDATION_GAP_REPORT') {
        return {
            ...base,
            targetVideoId: normalizeVideoId(source.targetVideoId, 'targetVideoId'),
            seedVideoId: normalizeVideoId(source.seedVideoId, 'seedVideoId', false),
        };
    }

    return {
        ...base,
        trackedVideoIds: normalizeTrackedVideoIds(source.trackedVideoIds, entitlements.maxTrackedVideoIds),
    };
}

function buildMarkdownFromSections(title: string, subtitle: string, summaryPoints: string[], sections: ClientReportSection[], caveats: string[]) {
    const lines: string[] = [`# ${title}`, '', subtitle, ''];

    if (summaryPoints.length > 0) {
        lines.push('## Executive Summary', '');
        for (const point of summaryPoints) {
            lines.push(`- ${point}`);
        }
        lines.push('');
    }

    for (const section of sections) {
        lines.push(`## ${section.title}`, '');
        if (section.bodyMarkdown) {
            lines.push(section.bodyMarkdown, '');
        }
        if (section.bullets?.length) {
            for (const bullet of section.bullets) {
                lines.push(`- ${bullet}`);
            }
            lines.push('');
        }
        if (section.metrics) {
            for (const [key, value] of Object.entries(section.metrics)) {
                lines.push(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
            }
            lines.push('');
        }
        if (section.tableRows?.length) {
            for (const row of section.tableRows) {
                lines.push(`- ${Object.entries(row).map(([key, value]) => `${key}: ${String(value)}`).join(' | ')}`);
            }
            lines.push('');
        }
    }

    if (caveats.length > 0) {
        lines.push('## Caveats', '');
        for (const caveat of caveats) {
            lines.push(`- ${caveat}`);
        }
        lines.push('');
    }

    return lines.join('\n').trim();
}

function buildLlmEnvelope(
    kind: string,
    title: string,
    summaryPoints: string[],
    markdown: string,
    caveats: string[],
    followUpQuestions: string[],
): LlmReportEnvelope {
    return {
        kind,
        title,
        bullets: summaryPoints,
        markdown,
        followUpQuestions,
        caveats,
    };
}

async function resolvePlatformWatermark(platform: string) {
    const summary = await prisma.feedSnapshot.aggregate({
        where: { platform },
        _count: { _all: true },
        _max: { capturedAt: true },
    });

    const snapshotCount = Number(summary?._count?._all ?? 0);
    const latestDataAt = summary?._max?.capturedAt ?? null;

    return {
        latestDataAt,
        watermarkKey: `${platform}:${snapshotCount}:${latestDataAt?.getTime() ?? 0}`,
    };
}

function buildClientReportDocument(input: {
    title: string;
    subtitle: string;
    summaryPoints: string[];
    caveats: string[];
    sections: ClientReportSection[];
    generatedAt: string;
    latestDataAt: string | null;
    packageAccess: AccessPackage;
    freshnessTier: FreshnessTier;
    deliverable: AgencyReportType;
}): ClientReportDocument {
    return {
        title: input.title,
        subtitle: input.subtitle,
        deliverable: input.deliverable,
        packageLabel: getPackageEntitlements(input.packageAccess).label,
        generatedAt: input.generatedAt,
        latestDataAt: input.latestDataAt,
        freshnessTier: input.freshnessTier,
        privacyMode: 'aggregate-only',
        summaryPoints: input.summaryPoints,
        caveats: input.caveats,
        sections: input.sections,
    };
}

function extractQualityCaveats(
    qualityGate: { status: string; degradationReasons?: string[] } | undefined,
    additionalCaveats: string[] = [],
) {
    const caveats = Array.from(new Set([
        ...(qualityGate?.degradationReasons ?? []),
        ...additionalCaveats,
    ]));

    if (caveats.length === 0 && qualityGate?.status === 'degraded') {
        caveats.push('Quality gates are degraded. Treat this report as directional, not definitive.');
    }

    return caveats;
}

async function buildAudienceOpportunityBrief(
    userId: string,
    accessPackage: AccessPackage,
    configInput: AgencyReportConfig,
) {
    const config: AudienceForecastOptions & { topCohorts: number; maxPathsPerCohort: number; pathBranchLimit: number } = {
        targetVideoId: normalizeVideoId(configInput.targetVideoId, 'targetVideoId')!,
        seedVideoId: configInput.seedVideoId,
        platform: configInput.platform,
        maxDepth: configInput.maxDepth ?? 3,
        beamWidth: configInput.beamWidth ?? 30,
        topCohorts: configInput.topCohorts ?? 5,
        maxPathsPerCohort: configInput.maxPathsPerCohort ?? 3,
        pathBranchLimit: configInput.pathBranchLimit ?? 6,
    };

    const [brief, diagnostics, watermark] = await Promise.all([
        generateGoToMarketCohortBrief(userId, config),
        generateDataQualityDiagnostics(config.platform, configInput.windowHours ?? 24 * 14),
        resolvePlatformWatermark(config.platform),
    ]);

    const summaryPoints = [
        brief.keyTakeaways[0] ?? `Top cohort count: ${brief.topCohorts.length}.`,
        `Forecast reliability: ${brief.forecastReliability.available ? brief.forecastReliability.globalGateStatus : 'unavailable'}.`,
        `Data quality gate: ${diagnostics.qualityGate.status}, parse coverage ${percent(diagnostics.recommendations.parseCoverage)}.`,
    ];
    const caveats = extractQualityCaveats(brief.qualityGate, diagnostics.qualityGate.degradationReasons);
    const sections: ClientReportSection[] = [
        {
            title: 'Top Cohorts',
            tableRows: brief.topCohorts.slice(0, config.topCohorts).map((cohort) => ({
                cohort: cohort.cohortLabel,
                users: cohort.users,
                exposure: percent(cohort.targetExposureRate),
                liftVsGlobal: cohort.relativeLiftVsGlobalExposure === null
                    ? 'n/a'
                    : `${Math.round(cohort.relativeLiftVsGlobalExposure * 100)}%`,
                fitScore: roundTo(cohort.fitScore, 2),
            })),
        },
        {
            title: 'Forecast Reliability',
            metrics: {
                qualityGate: brief.qualityGate.status,
                reliabilityAvailable: brief.forecastReliability.available,
                globalReliabilityScore: brief.forecastReliability.globalReliabilityScore,
                comparedUsers: brief.topCohorts.reduce((total, cohort) => total + cohort.users, 0),
            },
        },
        {
            title: 'Data Quality',
            bullets: [
                `Parse coverage: ${percent(diagnostics.recommendations.parseCoverage)}`,
                `Strict recommendation rows: ${diagnostics.recommendations.strictRecommendationRows}`,
                `Cohort stability score: ${roundTo(diagnostics.cohorts.stabilityScore, 2)}`,
                `Stitched sessions: ${diagnostics.stitching.stitchedSessions}`,
            ],
        },
    ];
    const title = 'Audience Opportunity Brief';
    const subtitle = `Independent aggregate observatory intelligence for ${config.targetVideoId} on ${config.platform}.`;
    const generatedAt = new Date().toISOString();
    const latestDataAt = watermark.latestDataAt?.toISOString() ?? null;
    const clientReport = buildClientReportDocument({
        title,
        subtitle,
        summaryPoints,
        caveats,
        sections,
        generatedAt,
        latestDataAt,
        packageAccess: accessPackage,
        freshnessTier: configInput.freshnessTier ?? 'standard',
        deliverable: 'AUDIENCE_OPPORTUNITY_BRIEF',
    });
    const markdown = buildMarkdownFromSections(title, subtitle, summaryPoints, sections, caveats);

    return {
        title,
        generatedAt,
        latestDataAt,
        watermarkKey: watermark.watermarkKey,
        qualityGateStatus: brief.qualityGate.status,
        resultPayload: {
            deliverable: 'AUDIENCE_OPPORTUNITY_BRIEF' as AgencyReportType,
            generatedAt,
            latestDataAt,
            freshnessTier: configInput.freshnessTier ?? 'standard',
            watermarkKey: watermark.watermarkKey,
            packageAccess: accessPackage,
            title,
            subtitle,
            summaryPoints,
            caveats,
            exports: {
                markdown,
                llm: buildLlmEnvelope(
                    'agency_audience_opportunity_brief',
                    title,
                    summaryPoints,
                    markdown,
                    caveats,
                    [
                        'Which cohort should an agency prioritize first?',
                        'Which quality caveats should appear in client-facing language?',
                    ],
                ),
                clientReport,
            },
            sourceData: {
                brief,
                diagnostics,
            },
        } satisfies StoredAgencyReportPayload,
    };
}

async function buildCompetitorReachSnapshot(
    accessPackage: AccessPackage,
    configInput: AgencyReportConfig,
) {
    const platform = configInput.platform;
    const trackedVideoIds = configInput.trackedVideoIds ?? [];
    const { model, qualityGate, loaded } = await loadMaterializedAudienceModelContext(platform);
    const watermark = await resolvePlatformWatermark(platform);
    const cohortRows = Array.from(model.cohorts.values()).map((cohort) => {
        const matchedUsers = cohort.users.filter((userId) => {
            const profile = model.userProfiles.get(userId);
            if (!profile) return false;
            return trackedVideoIds.some((videoId) => profile.seenVideos.has(videoId));
        });

        return {
            cohortId: cohort.cohortId,
            cohortLabel: cohortLabel(cohort.cohortId),
            users: cohort.users.length,
            matchedUsers: matchedUsers.length,
            exposureRate: cohort.users.length > 0 ? matchedUsers.length / cohort.users.length : 0,
            dominantCategory: cohort.dominantCategory,
        };
    })
        .sort((left, right) => right.exposureRate - left.exposureRate || right.matchedUsers - left.matchedUsers)
        .slice(0, configInput.topCohorts ?? 5);

    const globalMatchedUsers = Array.from(model.userProfiles.values()).filter((profile) =>
        trackedVideoIds.some((videoId) => profile.seenVideos.has(videoId))
    ).length;
    const summaryPoints = [
        `${configInput.competitorLabel ?? 'Tracked content'} reached ${globalMatchedUsers} observed users across ${model.userProfiles.size} user profiles.`,
        cohortRows[0]
            ? `Highest apparent exposure cohort: ${cohortRows[0].cohortLabel} at ${percent(cohortRows[0].exposureRate)}.`
            : 'No stable cohort exposure was available for the tracked content set.',
        `Quality gate: ${qualityGate.status}, based on ${loaded.loadStats.snapshotCount} stitched snapshots.`,
    ];
    const caveats = extractQualityCaveats(qualityGate, [
        'Competitor reach is inferred from aggregate observatory exposure, not platform-reported impressions.',
    ]);
    const sections: ClientReportSection[] = [
        {
            title: 'Tracked Content Set',
            bullets: trackedVideoIds.map((videoId) => `Tracked video: ${videoId}`),
        },
        {
            title: 'Highest Exposure Cohorts',
            tableRows: cohortRows.map((row) => ({
                cohort: row.cohortLabel,
                users: row.users,
                matchedUsers: row.matchedUsers,
                exposureRate: percent(row.exposureRate),
                dominantCategory: row.dominantCategory,
            })),
        },
        {
            title: 'Observatory Reliability',
            metrics: {
                qualityGate: qualityGate.status,
                comparedUsers: model.userProfiles.size,
                stitchedItems: loaded.loadStats.stitchedItemCount,
                parseCoverage: qualityGate.parseCoverage,
            },
        },
    ];
    const title = 'Competitor Reach Snapshot';
    const subtitle = `Independent aggregate observatory intelligence for ${configInput.competitorLabel ?? 'tracked competitor content'} on ${platform}.`;
    const generatedAt = new Date().toISOString();
    const latestDataAt = watermark.latestDataAt?.toISOString() ?? null;
    const clientReport = buildClientReportDocument({
        title,
        subtitle,
        summaryPoints,
        caveats,
        sections,
        generatedAt,
        latestDataAt,
        packageAccess: accessPackage,
        freshnessTier: configInput.freshnessTier ?? 'standard',
        deliverable: 'COMPETITOR_REACH_SNAPSHOT',
    });
    const markdown = buildMarkdownFromSections(title, subtitle, summaryPoints, sections, caveats);

    return {
        title,
        generatedAt,
        latestDataAt,
        watermarkKey: watermark.watermarkKey,
        qualityGateStatus: qualityGate.status,
        resultPayload: {
            deliverable: 'COMPETITOR_REACH_SNAPSHOT' as AgencyReportType,
            generatedAt,
            latestDataAt,
            freshnessTier: configInput.freshnessTier ?? 'standard',
            watermarkKey: watermark.watermarkKey,
            packageAccess: accessPackage,
            title,
            subtitle,
            summaryPoints,
            caveats,
            exports: {
                markdown,
                llm: buildLlmEnvelope(
                    'agency_competitor_reach_snapshot',
                    title,
                    summaryPoints,
                    markdown,
                    caveats,
                    [
                        'Which cohorts appear over-exposed to this competitor content?',
                        'What caveats matter before using this as agency positioning?',
                    ],
                ),
                clientReport,
            },
            sourceData: {
                trackedVideoIds,
                cohortRows,
                globalMatchedUsers,
                qualityGate,
            },
        } satisfies StoredAgencyReportPayload,
    };
}

async function buildRecommendationGapReport(
    userId: string,
    accessPackage: AccessPackage,
    configInput: AgencyReportConfig,
) {
    const targetVideoId = normalizeVideoId(configInput.targetVideoId, 'targetVideoId')!;
    const seedVideoId = configInput.seedVideoId;
    const [forecast, recommendationMap, watermark] = await Promise.all([
        generateAudienceForecast(userId, {
            targetVideoId,
            seedVideoId,
            platform: configInput.platform,
            maxDepth: configInput.maxDepth ?? 3,
            beamWidth: configInput.beamWidth ?? 30,
        }),
        seedVideoId
            ? generateRecommendationMap(userId, {
                seedVideoId,
                maxDepth: configInput.maxDepth ?? 3,
                maxNodes: configInput.maxNodes ?? 40,
                platform: configInput.platform,
            })
            : Promise.resolve(null),
        resolvePlatformWatermark(configInput.platform),
    ]);

    const underServedCohorts = forecast.cohorts
        .filter((cohort) =>
            (typeof cohort.relativeLiftVsGlobalExposure === 'number' && cohort.relativeLiftVsGlobalExposure < 0)
            || (cohort.relativeLiftVsGlobalExposure === null && cohort.fitScore >= 0.5),
        )
        .sort((left, right) => right.fitScore - left.fitScore || left.targetExposureRate - right.targetExposureRate)
        .slice(0, configInput.topCohorts ?? 5);

    const bridgeCandidates = recommendationMap
        ? recommendationMap.combinedNodes
            .filter((node) => node.discoveredBy === 'both')
            .slice(0, 8)
            .map((node) => ({
                videoId: node.videoId,
                discoveredBy: node.discoveredBy,
                bfsDepth: node.bfsDepth,
                dfsDepth: node.dfsDepth,
            }))
        : [];

    const summaryPoints = [
        underServedCohorts[0]
            ? `Most under-served cohort: ${underServedCohorts[0].cohortLabel} at ${percent(underServedCohorts[0].targetExposureRate)} observed exposure.`
            : 'No under-served cohort exceeded the report threshold.',
        bridgeCandidates[0]
            ? `Bridge opportunity: ${bridgeCandidates[0].videoId} appears in both traversal strategies.`
            : 'No bridge candidate was available without a seed-path map.',
        `Quality gate: ${forecast.qualityGate.status}, compared users ${forecast.networkEffect.comparedUsers}.`,
    ];
    const caveats = extractQualityCaveats(forecast.qualityGate, [
        'Gap reports reflect observatory pathing and cohort exposure, not paid reach forecasts.',
    ]);
    const sections: ClientReportSection[] = [
        {
            title: 'Under-served Cohorts',
            tableRows: underServedCohorts.map((cohort) => ({
                cohort: cohort.cohortLabel,
                users: cohort.users,
                exposure: percent(cohort.targetExposureRate),
                liftVsGlobal: cohort.relativeLiftVsGlobalExposure === null
                    ? 'n/a'
                    : `${Math.round(cohort.relativeLiftVsGlobalExposure * 100)}%`,
                fitScore: roundTo(cohort.fitScore, 2),
            })),
        },
        {
            title: 'Bridge Opportunities',
            tableRows: bridgeCandidates,
        },
        {
            title: 'Observatory Quality Notes',
            bullets: [
                `Parse coverage: ${percent(forecast.qualityGate.parseCoverage)}`,
                `Cohort stability score: ${roundTo(forecast.qualityGate.cohortStabilityScore, 2)}`,
                `Compared users: ${forecast.networkEffect.comparedUsers}`,
            ],
        },
    ];
    const title = 'Recommendation Gap Report';
    const subtitle = `Independent aggregate observatory intelligence for reach gaps around ${targetVideoId} on ${configInput.platform}.`;
    const generatedAt = new Date().toISOString();
    const latestDataAt = watermark.latestDataAt?.toISOString() ?? null;
    const clientReport = buildClientReportDocument({
        title,
        subtitle,
        summaryPoints,
        caveats,
        sections,
        generatedAt,
        latestDataAt,
        packageAccess: accessPackage,
        freshnessTier: configInput.freshnessTier ?? 'standard',
        deliverable: 'RECOMMENDATION_GAP_REPORT',
    });
    const markdown = buildMarkdownFromSections(title, subtitle, summaryPoints, sections, caveats);

    return {
        title,
        generatedAt,
        latestDataAt,
        watermarkKey: watermark.watermarkKey,
        qualityGateStatus: forecast.qualityGate.status,
        resultPayload: {
            deliverable: 'RECOMMENDATION_GAP_REPORT' as AgencyReportType,
            generatedAt,
            latestDataAt,
            freshnessTier: configInput.freshnessTier ?? 'standard',
            watermarkKey: watermark.watermarkKey,
            packageAccess: accessPackage,
            title,
            subtitle,
            summaryPoints,
            caveats,
            exports: {
                markdown,
                llm: buildLlmEnvelope(
                    'agency_recommendation_gap_report',
                    title,
                    summaryPoints,
                    markdown,
                    caveats,
                    [
                        'Which cohort gap should an agency address first?',
                        'Which bridge paths are stable enough to mention in a client deck?',
                    ],
                ),
                clientReport,
            },
            sourceData: {
                forecast,
                recommendationMap,
                underServedCohorts,
                bridgeCandidates,
            },
        } satisfies StoredAgencyReportPayload,
    };
}

export async function generateAgencyReportPayload(args: {
    userId: string;
    accessPackage: AccessPackage;
    reportType: AgencyReportType;
    reportConfig: AgencyReportConfig;
}) {
    const entitlements = getPackageEntitlements(args.accessPackage);
    if (!isReportTypeAllowed(args.accessPackage, args.reportType)) {
        throw new AgencyReportInputError(`Package ${args.accessPackage} cannot generate ${args.reportType}`, 403);
    }

    if (!isPlatformAllowed(args.accessPackage, args.reportConfig.platform)) {
        throw new AgencyReportInputError(`Package ${args.accessPackage} does not allow ${args.reportConfig.platform}`, 403);
    }

    if (!isFreshnessTierAllowed(args.accessPackage, args.reportConfig.freshnessTier ?? 'standard')) {
        throw new AgencyReportInputError(`Package ${args.accessPackage} does not allow ${args.reportConfig.freshnessTier}`, 403);
    }

    if (args.reportType === 'AUDIENCE_OPPORTUNITY_BRIEF') {
        return buildAudienceOpportunityBrief(args.userId, args.accessPackage, args.reportConfig);
    }

    if (args.reportType === 'COMPETITOR_REACH_SNAPSHOT') {
        return buildCompetitorReachSnapshot(args.accessPackage, args.reportConfig);
    }

    return buildRecommendationGapReport(args.userId, args.accessPackage, args.reportConfig);
}

export async function createAgencyAuditEvent(input: {
    eventType: AgencyReportAuditEventType;
    userId?: string | null;
    apiKeyId?: string | null;
    presetId?: string | null;
    reportRunId?: string | null;
    reportShareId?: string | null;
    metadata?: Prisma.InputJsonValue;
}) {
    return prisma.agencyReportAuditEvent.create({
        data: {
            eventType: input.eventType,
            userId: input.userId ?? null,
            apiKeyId: input.apiKeyId ?? null,
            presetId: input.presetId ?? null,
            reportRunId: input.reportRunId ?? null,
            reportShareId: input.reportShareId ?? null,
            metadata: input.metadata ?? undefined,
        },
    });
}

function hashShareToken(rawToken: string) {
    return createHmac('sha256', `${config.apiKeys.pepper}:agency-reports`)
        .update(rawToken)
        .digest('hex');
}

export function createAgencyReportShareSecret() {
    const rawToken = `resma_share_${randomBytes(18).toString('base64url')}`;
    return {
        rawToken,
        tokenHash: hashShareToken(rawToken),
        tokenPrefix: rawToken.slice(0, 18),
    };
}

export function normalizeAgencyReportExportFormats(
    rawFormats: unknown,
    accessPackage: AccessPackage,
): ReportFormat[] {
    const entitlements = getPackageEntitlements(accessPackage);
    const requested = Array.isArray(rawFormats)
        ? rawFormats
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim().toLowerCase())
        : [];
    const normalized = Array.from(new Set(
        (requested.length > 0 ? requested : entitlements.allowedExportFormats)
            .filter((value): value is ReportFormat => isExportFormatAllowed(accessPackage, value as ReportFormat)),
    ));

    if (normalized.length === 0) {
        throw new AgencyReportInputError(`Package ${accessPackage} does not allow any export formats`, 403);
    }

    return normalized;
}

function buildPublicAgencyReportExport(payload: StoredAgencyReportPayload): PublicAgencyReportExport {
    return {
        kind: 'agency_report_export',
        deliverable: payload.deliverable,
        title: payload.title,
        subtitle: payload.subtitle,
        packageLabel: getPackageEntitlements(payload.packageAccess).label,
        generatedAt: payload.generatedAt,
        latestDataAt: payload.latestDataAt,
        freshnessTier: payload.freshnessTier,
        privacyMode: 'aggregate-only',
        summaryPoints: payload.summaryPoints,
        caveats: payload.caveats,
        sections: payload.exports.clientReport.sections,
    };
}

export function summarizeStoredAgencyReport(payload: StoredAgencyReportPayload) {
    return {
        deliverable: payload.deliverable,
        title: payload.title,
        subtitle: payload.subtitle,
        summaryPoints: payload.summaryPoints,
        caveats: payload.caveats,
        privacyMode: 'aggregate-only' as const,
    };
}

export async function createAgencyReportShare(args: {
    reportRunId: string;
    userId: string;
    accessPackage: AccessPackage;
    description?: string;
    expiresAt?: Date | null;
}) {
    const entitlements = getPackageEntitlements(args.accessPackage);
    if (!entitlements.canCreateShares) {
        throw new AgencyReportInputError(`Package ${args.accessPackage} cannot create share links`, 403);
    }

    const existingShareCount = await prisma.agencyReportShare.count({
        where: {
            reportRunId: args.reportRunId,
            status: 'ACTIVE',
        },
    });
    if (existingShareCount >= entitlements.maxShareLinksPerRun) {
        throw new AgencyReportInputError(`Package ${args.accessPackage} cannot exceed ${entitlements.maxShareLinksPerRun} active shares per report`, 403);
    }

    const token = createAgencyReportShareSecret();
    const share = await prisma.agencyReportShare.create({
        data: {
            reportRunId: args.reportRunId,
            tokenHash: token.tokenHash,
            tokenPrefix: token.tokenPrefix,
            description: args.description ?? null,
            expiresAt: args.expiresAt ?? null,
        },
    });

    await createAgencyAuditEvent({
        eventType: 'SHARE_CREATED',
        userId: args.userId,
        reportRunId: args.reportRunId,
        reportShareId: share.id,
        metadata: {
            expiresAt: args.expiresAt?.toISOString() ?? null,
        },
    });

    return {
        share,
        token: token.rawToken,
    };
}

export async function resolveAgencyReportShare(rawToken: string) {
    return prisma.agencyReportShare.findUnique({
        where: {
            tokenHash: hashShareToken(rawToken),
        },
        include: {
            reportRun: true,
        },
    });
}

export function serializeStoredAgencyReport(payload: StoredAgencyReportPayload, format: ReportFormat) {
    if (format === 'markdown') {
        return {
            format,
            content: payload.exports.markdown,
        };
    }

    if (format === 'client-report') {
        return {
            format,
            content: payload.exports.clientReport,
        };
    }

    if (format === 'llm') {
        return {
            format,
            content: payload.exports.llm,
        };
    }

    return {
        format: 'json' as const,
        content: buildPublicAgencyReportExport(payload),
    };
}

export async function loadAgencyReportRunForUser(runId: string, userId: string) {
    const run = await prisma.agencyReportRun.findFirst({
        where: {
            id: runId,
            userId,
        },
        include: {
            preset: true,
            shares: {
                where: {
                    status: 'ACTIVE',
                },
                orderBy: {
                    createdAt: 'desc',
                },
            },
        },
    });

    return run;
}

export function ensureStoredPayload(payload: unknown): StoredAgencyReportPayload {
    if (!payload || typeof payload !== 'object') {
        throw new AgencyReportInputError('Stored report payload is invalid', 500);
    }

    return payload as StoredAgencyReportPayload;
}

export async function revokeAgencyReportShare(args: {
    shareId: string;
    userId: string;
}) {
    const share = await prisma.agencyReportShare.findFirst({
        where: {
            id: args.shareId,
            reportRun: {
                userId: args.userId,
            },
        },
    });

    if (!share) {
        throw new AgencyReportInputError('Report share not found', 404);
    }

    if (share.status === 'REVOKED') {
        return share;
    }

    const revoked = await prisma.agencyReportShare.update({
        where: { id: share.id },
        data: {
            status: 'REVOKED',
            revokedAt: new Date(),
        },
    });

    await createAgencyAuditEvent({
        eventType: 'SHARE_REVOKED',
        userId: args.userId,
        reportRunId: revoked.reportRunId,
        reportShareId: revoked.id,
    });

    return revoked;
}

export async function listAgencyReportPresetsForUser(userId: string) {
    return prisma.agencyReportPreset.findMany({
        where: {
            userId,
            archivedAt: null,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
}

export async function createAgencyReportPreset(args: {
    userId: string;
    accessPackage: AccessPackage;
    name: string;
    reportType: AgencyReportType;
    reportConfig: unknown;
    allowedExportFormats?: unknown;
}) {
    const entitlements = getPackageEntitlements(args.accessPackage);
    if (entitlements.maxSavedPresets <= 0) {
        throw new AgencyReportInputError(`Package ${args.accessPackage} cannot create saved report presets`, 403);
    }

    if (!isReportTypeAllowed(args.accessPackage, args.reportType)) {
        throw new AgencyReportInputError(`Package ${args.accessPackage} cannot create ${args.reportType}`, 403);
    }

    const existingPresetCount = await prisma.agencyReportPreset.count({
        where: {
            userId: args.userId,
            archivedAt: null,
        },
    });
    if (existingPresetCount >= entitlements.maxSavedPresets) {
        throw new AgencyReportInputError(`Package ${args.accessPackage} cannot exceed ${entitlements.maxSavedPresets} saved presets`, 403);
    }

    const normalizedConfig = normalizeAgencyReportConfig(args.reportType, args.reportConfig, args.accessPackage);
    const allowedExportFormats = normalizeAgencyReportExportFormats(args.allowedExportFormats, args.accessPackage);
    const preset = await prisma.agencyReportPreset.create({
        data: {
            userId: args.userId,
            name: args.name,
            reportType: args.reportType,
            accessPackage: args.accessPackage,
            platform: normalizedConfig.platform,
            reportConfig: normalizedConfig as unknown as Prisma.InputJsonValue,
            freshnessTier: normalizedConfig.freshnessTier ?? 'standard',
            allowedExportFormats,
        },
    });

    await createAgencyAuditEvent({
        eventType: 'PRESET_CREATED',
        userId: args.userId,
        presetId: preset.id,
        metadata: {
            reportType: args.reportType,
            platform: normalizedConfig.platform,
            exportFormats: allowedExportFormats,
        },
    });

    return preset;
}

export async function runAgencyReportPreset(args: {
    presetId: string;
    userId: string;
    accessPackage: AccessPackage;
    apiKeyId?: string | null;
}) {
    const preset = await prisma.agencyReportPreset.findFirst({
        where: {
            id: args.presetId,
            userId: args.userId,
            archivedAt: null,
        },
    });

    if (!preset) {
        throw new AgencyReportInputError('Report preset not found', 404);
    }

    const reportType = preset.reportType as AgencyReportType;
    const normalizedConfig = normalizeAgencyReportConfig(reportType, preset.reportConfig, args.accessPackage);
    const payload = await generateAgencyReportPayload({
        userId: args.userId,
        accessPackage: args.accessPackage,
        reportType,
        reportConfig: normalizedConfig,
    });
    const availableExportFormats = normalizeAgencyReportExportFormats(preset.allowedExportFormats, args.accessPackage);
    const generatedAt = new Date(payload.generatedAt);
    const latestDataAt = payload.latestDataAt ? new Date(payload.latestDataAt) : null;

    const reportRun = await prisma.agencyReportRun.create({
        data: {
            presetId: preset.id,
            userId: args.userId,
            apiKeyId: args.apiKeyId ?? null,
            reportType,
            accessPackage: args.accessPackage,
            platform: normalizedConfig.platform,
            reportTitle: payload.title,
            reportConfig: normalizedConfig as unknown as Prisma.InputJsonValue,
            resultPayload: payload.resultPayload as unknown as Prisma.InputJsonValue,
            freshnessTier: normalizedConfig.freshnessTier ?? 'standard',
            availableExportFormats,
            watermarkKey: payload.watermarkKey,
            latestDataAt,
            qualityGateStatus: payload.qualityGateStatus,
            generatedAt,
        },
    });

    await prisma.agencyReportPreset.update({
        where: { id: preset.id },
        data: {
            lastRunAt: generatedAt,
        },
    });

    await createAgencyAuditEvent({
        eventType: 'RUN_GENERATED',
        userId: args.userId,
        apiKeyId: args.apiKeyId ?? null,
        presetId: preset.id,
        reportRunId: reportRun.id,
        metadata: {
            reportType,
            exportFormats: availableExportFormats,
            qualityGateStatus: payload.qualityGateStatus,
        },
    });

    return reportRun;
}

export async function listAgencyReportRunsForUser(userId: string, limit = 20): Promise<AgencyReportRunSummary[]> {
    const runs = await prisma.agencyReportRun.findMany({
        where: {
            userId,
        },
        include: {
            shares: {
                where: {
                    status: 'ACTIVE',
                },
                select: {
                    id: true,
                },
            },
        },
        orderBy: {
            generatedAt: 'desc',
        },
        take: Math.max(1, Math.min(limit, 50)),
    });

    return runs.map((run) => {
        const payload = ensureStoredPayload(run.resultPayload);
        return {
            id: run.id,
            presetId: run.presetId,
            reportType: run.reportType,
            accessPackage: run.accessPackage,
            platform: run.platform,
            reportTitle: run.reportTitle,
            freshnessTier: run.freshnessTier,
            availableExportFormats: run.availableExportFormats,
            qualityGateStatus: run.qualityGateStatus,
            latestDataAt: run.latestDataAt,
            generatedAt: run.generatedAt,
            createdAt: run.createdAt,
            shareCount: run.shares.length,
            preview: summarizeStoredAgencyReport(payload),
        };
    });
}

export async function markAgencyReportExportAccess(args: {
    userId?: string | null;
    apiKeyId?: string | null;
    reportRunId: string;
    format: ReportFormat;
    reportShareId?: string | null;
}) {
    await createAgencyAuditEvent({
        eventType: 'EXPORT_ACCESSED',
        userId: args.userId ?? null,
        apiKeyId: args.apiKeyId ?? null,
        reportRunId: args.reportRunId,
        reportShareId: args.reportShareId ?? null,
        metadata: {
            format: args.format,
        },
    });
}

export async function markAgencyReportShareViewed(args: {
    shareId: string;
    reportRunId: string;
}) {
    await prisma.agencyReportShare.update({
        where: {
            id: args.shareId,
        },
        data: {
            lastAccessedAt: new Date(),
        },
    });

    await createAgencyAuditEvent({
        eventType: 'SHARE_VIEWED',
        reportRunId: args.reportRunId,
        reportShareId: args.shareId,
    });
}

export type AgencyReportPresetRecord = AgencyReportPreset;
export type AgencyReportRunRecord = AgencyReportRun;
export type AgencyReportShareRecord = AgencyReportShare;
export type PrismaAgencyReportTypeName = PrismaAgencyReportType;
