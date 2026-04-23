import { extractRecommendationsWithDiagnostics } from './recommendationParsing.js';
import { sanitizeString } from '../lib/ingestUtils.js';
import type {
    RawAudienceFeedItem,
    RecommendationQualityGate,
    RecommendationQualityGateContext,
    RecommendationQualityReasonCode,
    RecommendationQualityThresholds,
} from './audienceForecast.js';

const DEFAULT_RECOMMENDATION_QUALITY_THRESHOLDS: RecommendationQualityThresholds = {
    minimumParseCoverage: 0.2,
    maxParserDropRate: 0.8,
    minimumStrictRecommendationRows: 6,
    minimumComparedUsers: 3,
    minimumCohortStabilityScore: 0.55,
    minimumMetadataIntegrityScore: 0.8,
    minimumCohortUsersForLift: 3,
};

const PLATFORM_RECOMMENDATION_QUALITY_THRESHOLDS: Record<string, Partial<RecommendationQualityThresholds>> = {
    youtube: {
        minimumParseCoverage: 0.24,
        maxParserDropRate: 0.76,
        minimumStrictRecommendationRows: 8,
        minimumComparedUsers: 4,
        minimumCohortStabilityScore: 0.62,
        minimumMetadataIntegrityScore: 0.85,
        minimumCohortUsersForLift: 3,
    },
    instagram: {
        minimumParseCoverage: 0.2,
        maxParserDropRate: 0.8,
        minimumStrictRecommendationRows: 6,
        minimumComparedUsers: 3,
        minimumCohortStabilityScore: 0.58,
        minimumMetadataIntegrityScore: 0.8,
        minimumCohortUsersForLift: 3,
    },
    tiktok: {
        minimumParseCoverage: 0.2,
        maxParserDropRate: 0.8,
        minimumStrictRecommendationRows: 6,
        minimumComparedUsers: 3,
        minimumCohortStabilityScore: 0.58,
        minimumMetadataIntegrityScore: 0.8,
        minimumCohortUsersForLift: 3,
    },
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

export function getRecommendationQualityThresholds(platform: string): RecommendationQualityThresholds {
    const normalizedPlatform = sanitizeString(platform)?.toLowerCase() ?? '';
    const overrides = PLATFORM_RECOMMENDATION_QUALITY_THRESHOLDS[normalizedPlatform] ?? {};
    return {
        ...DEFAULT_RECOMMENDATION_QUALITY_THRESHOLDS,
        ...overrides,
    };
}

function qualityReasonText(
    code: RecommendationQualityReasonCode,
    values: {
        parseCoverage: number;
        parserDropRate: number;
        strictRecommendationRows: number;
        comparedUsers: number;
        cohortStabilityScore: number;
        metadataIntegrityScore: number;
        invalidMetadataSnapshots: number;
        snapshotsWithMetadata: number;
    },
    thresholds: RecommendationQualityThresholds
) {
    switch (code) {
    case 'parse_coverage_below_minimum':
        return `Parse coverage ${roundTo(values.parseCoverage)} is below minimum ${roundTo(thresholds.minimumParseCoverage)}.`;
    case 'parser_drop_above_maximum':
        return `Parser drop rate ${roundTo(values.parserDropRate)} exceeds max ${roundTo(thresholds.maxParserDropRate)}.`;
    case 'strict_rows_below_minimum':
        return `Strict recommendation rows ${values.strictRecommendationRows} are below minimum ${thresholds.minimumStrictRecommendationRows}.`;
    case 'compared_users_below_minimum':
        return `Compared users ${values.comparedUsers} are below minimum ${thresholds.minimumComparedUsers}.`;
    case 'cohort_stability_below_minimum':
        return `Cohort stability ${roundTo(values.cohortStabilityScore)} is below minimum ${roundTo(thresholds.minimumCohortStabilityScore)}.`;
    case 'metadata_integrity_below_minimum':
        return values.snapshotsWithMetadata > 0
            ? `Metadata integrity ${roundTo(values.metadataIntegrityScore)} is below minimum ${roundTo(thresholds.minimumMetadataIntegrityScore)} because ${values.invalidMetadataSnapshots} snapshot(s) could not be decoded.`
            : 'Session metadata coverage is too sparse to verify stitching integrity for this forecast window.';
    case 'forecast_reliability_low':
        return 'Forecast reliability is below the minimum confidence threshold.';
    case 'forecast_reliability_unavailable':
        return 'Forecast reliability could not be evaluated for this window.';
    default:
        return 'Quality signal degraded.';
    }
}

export function deriveRecommendationQualityGate(
    items: RawAudienceFeedItem[],
    platform: string,
    contextOrMinimumParseCoverage: RecommendationQualityGateContext | number = {}
): RecommendationQualityGate {
    const context: RecommendationQualityGateContext = typeof contextOrMinimumParseCoverage === 'number'
        ? { minimumParseCoverage: contextOrMinimumParseCoverage }
        : contextOrMinimumParseCoverage;
    const platformThresholds = getRecommendationQualityThresholds(platform);
    const thresholds: RecommendationQualityThresholds = {
        minimumParseCoverage: clamp(
            context.minimumParseCoverage ?? platformThresholds.minimumParseCoverage,
            0,
            1
        ),
        maxParserDropRate: clamp(
            context.maxParserDropRate ?? platformThresholds.maxParserDropRate,
            0,
            1
        ),
        minimumStrictRecommendationRows: Math.max(
            0,
            Math.round(context.minimumStrictRecommendationRows ?? platformThresholds.minimumStrictRecommendationRows)
        ),
        minimumComparedUsers: Math.max(
            1,
            Math.round(context.minimumComparedUsers ?? platformThresholds.minimumComparedUsers)
        ),
        minimumCohortStabilityScore: clamp(
            context.minimumCohortStabilityScore ?? platformThresholds.minimumCohortStabilityScore,
            0,
            1
        ),
        minimumMetadataIntegrityScore: clamp(
            context.minimumMetadataIntegrityScore ?? platformThresholds.minimumMetadataIntegrityScore,
            0,
            1
        ),
        minimumCohortUsersForLift: Math.max(
            2,
            Math.round(context.minimumCohortUsersForLift ?? platformThresholds.minimumCohortUsersForLift)
        ),
    };

    let rawRecommendationRows = 0;
    let strictRecommendationRows = 0;
    let duplicateRecommendationRows = 0;
    const comparedUserIds = new Set<string>();

    for (const item of items) {
        const userId = sanitizeString(item.userId);
        if (userId) comparedUserIds.add(userId);

        if (!item.engagementMetrics) continue;

        const parsed = extractRecommendationsWithDiagnostics(item.engagementMetrics, {
            platform,
            sourceVideoId: item.videoId,
            maxRecommendations: 40,
        });
        rawRecommendationRows += parsed.diagnostics.rawRecommendationRows;
        strictRecommendationRows += parsed.diagnostics.strictRecommendationRows;
        duplicateRecommendationRows += parsed.diagnostics.duplicateRecommendationRows;
    }

    const parseCoverage = rawRecommendationRows > 0
        ? strictRecommendationRows / rawRecommendationRows
        : 0;
    const parserDropRate = rawRecommendationRows > 0
        ? 1 - parseCoverage
        : 0;
    const dedupeImpactRate = rawRecommendationRows > 0
        ? duplicateRecommendationRows / rawRecommendationRows
        : 0;
    const comparedUsers = Math.max(
        0,
        Math.round(context.comparedUsers ?? comparedUserIds.size)
    );
    const cohortStabilityScore = clamp(
        Number.isFinite(context.cohortStabilityScore)
            ? Number(context.cohortStabilityScore)
            : 1,
        0,
        1
    );
    const metadataIntegrityScore = clamp(
        Number.isFinite(context.metadataIntegrityScore)
            ? Number(context.metadataIntegrityScore)
            : 1,
        0,
        1
    );
    const snapshotsWithMetadata = Math.max(
        0,
        Math.round(context.snapshotsWithMetadata ?? 0)
    );
    const decodedMetadataSnapshots = Math.max(
        0,
        Math.round(context.decodedMetadataSnapshots ?? snapshotsWithMetadata)
    );
    const invalidMetadataSnapshots = Math.max(
        0,
        Math.round(context.invalidMetadataSnapshots ?? Math.max(0, snapshotsWithMetadata - decodedMetadataSnapshots))
    );

    const reasonCodes: RecommendationQualityReasonCode[] = [];
    if (parseCoverage < thresholds.minimumParseCoverage) {
        reasonCodes.push('parse_coverage_below_minimum');
    }
    if (parserDropRate > thresholds.maxParserDropRate) {
        reasonCodes.push('parser_drop_above_maximum');
    }
    if (strictRecommendationRows < thresholds.minimumStrictRecommendationRows) {
        reasonCodes.push('strict_rows_below_minimum');
    }
    if (comparedUsers < thresholds.minimumComparedUsers) {
        reasonCodes.push('compared_users_below_minimum');
    }
    if (cohortStabilityScore < thresholds.minimumCohortStabilityScore) {
        reasonCodes.push('cohort_stability_below_minimum');
    }
    if (metadataIntegrityScore < thresholds.minimumMetadataIntegrityScore) {
        reasonCodes.push('metadata_integrity_below_minimum');
    }

    const parsePenalty = parseCoverage < thresholds.minimumParseCoverage
        ? (1 - (parseCoverage / Math.max(thresholds.minimumParseCoverage, 0.001))) * 0.34
        : 0;
    const parserDropPenalty = parserDropRate > thresholds.maxParserDropRate
        ? ((parserDropRate - thresholds.maxParserDropRate) / Math.max(1 - thresholds.maxParserDropRate, 0.001)) * 0.2
        : 0;
    const strictRowsPenalty = strictRecommendationRows < thresholds.minimumStrictRecommendationRows
        ? (1 - (strictRecommendationRows / Math.max(thresholds.minimumStrictRecommendationRows, 1))) * 0.2
        : 0;
    const comparedUsersPenalty = comparedUsers < thresholds.minimumComparedUsers
        ? (1 - (comparedUsers / Math.max(thresholds.minimumComparedUsers, 1))) * 0.16
        : 0;
    const cohortStabilityPenalty = cohortStabilityScore < thresholds.minimumCohortStabilityScore
        ? (1 - (cohortStabilityScore / Math.max(thresholds.minimumCohortStabilityScore, 0.001))) * 0.1
        : 0;
    const metadataIntegrityPenalty = metadataIntegrityScore < thresholds.minimumMetadataIntegrityScore
        ? (1 - (metadataIntegrityScore / Math.max(thresholds.minimumMetadataIntegrityScore, 0.001))) * 0.12
        : 0;

    const confidencePenalty = parsePenalty
        + parserDropPenalty
        + strictRowsPenalty
        + comparedUsersPenalty
        + cohortStabilityPenalty
        + metadataIntegrityPenalty;
    const confidenceMultiplier = clamp(1 - confidencePenalty, 0.35, 1);
    const status: RecommendationQualityGate['status'] = reasonCodes.length > 0 ? 'degraded' : 'ok';
    const canInterpretLift = status === 'ok'
        && comparedUsers >= thresholds.minimumComparedUsers
        && cohortStabilityScore >= thresholds.minimumCohortStabilityScore;
    const degradationReasons = reasonCodes.map((reasonCode) => qualityReasonText(
        reasonCode,
        {
            parseCoverage,
            parserDropRate,
            strictRecommendationRows,
            comparedUsers,
            cohortStabilityScore,
            metadataIntegrityScore,
            invalidMetadataSnapshots,
            snapshotsWithMetadata,
        },
        thresholds
    ));

    return {
        status,
        parseCoverage: roundTo(clamp(parseCoverage, 0, 1)),
        parserDropRate: roundTo(clamp(parserDropRate, 0, 1)),
        rawRecommendationRows,
        minimumParseCoverage: roundTo(thresholds.minimumParseCoverage),
        maxParserDropRate: roundTo(thresholds.maxParserDropRate),
        strictRecommendationRows,
        duplicateRecommendationRows,
        dedupeImpactRate: roundTo(clamp(dedupeImpactRate, 0, 1)),
        minimumStrictRecommendationRows: thresholds.minimumStrictRecommendationRows,
        comparedUsers,
        minimumComparedUsers: thresholds.minimumComparedUsers,
        cohortStabilityScore: roundTo(cohortStabilityScore),
        minimumCohortStabilityScore: roundTo(thresholds.minimumCohortStabilityScore),
        metadataIntegrityScore: roundTo(metadataIntegrityScore),
        minimumMetadataIntegrityScore: roundTo(thresholds.minimumMetadataIntegrityScore),
        snapshotsWithMetadata,
        decodedMetadataSnapshots,
        invalidMetadataSnapshots,
        minimumCohortUsersForLift: thresholds.minimumCohortUsersForLift,
        canInterpretLift,
        reasonCodes,
        degradationReasons,
        confidenceMultiplier: roundTo(confidenceMultiplier),
    };
}
