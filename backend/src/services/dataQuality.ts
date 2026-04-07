import { buildAudienceModel, RawAudienceFeedItem } from './audienceForecast.js';
import { extractRecommendationsFromMetrics } from './recommendationParsing.js';
import { decompressAndUnpack, isCompressedMsgpack } from './serialization.js';
import { buildSnapshotFingerprint } from './snapshotQuality.js';

let prismaClientPromise: Promise<any> | null = null;

async function getPrismaClient() {
    if (!prismaClientPromise) {
        prismaClientPromise = import('../lib/prisma.js').then((module) => module.prisma);
    }
    return prismaClientPromise;
}

const SESSION_GAP_MS = 25 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const DUPLICATE_OVERLAP_THRESHOLD = 0.9;

interface DiagnosticsFeedItem {
    videoId: string;
    creatorHandle: string | null;
    contentCategories: string[];
    engagementMetrics: Buffer | null;
    positionInFeed: number;
}

interface DiagnosticsSnapshot {
    id: string;
    userId: string;
    capturedAt: Date;
    sessionMetadata: Buffer | null;
    feedItems: DiagnosticsFeedItem[];
}

interface StitchingSummary {
    totalSnapshots: number;
    snapshotsAfterDedupe: number;
    dedupedSnapshots: number;
    duplicateRate: number;
    stitchedSessions: number;
    avgSnapshotsPerSession: number;
    snapshotsWithQualityFingerprint: number;
    snapshotsWithStitchedSessionKey: number;
}

interface RecommendationSummary {
    itemsWithMetrics: number;
    decodableMetricItems: number;
    itemsWithRecommendationArray: number;
    rawRecommendationRows: number;
    strictRecommendationRows: number;
    parserDropRate: number;
    itemsWithParsedRecommendations: number;
    parseCoverage: number;
    avgRecommendationsPerItem: number;
    surfaceTransitionStability: number;
    bySurface: RecommendationSurfaceDiagnostics[];
}

interface RecommendationSurfaceDiagnostics {
    surface: string;
    rawRows: number;
    strictRows: number;
    parserDropRate: number;
    parseCoverage: number;
    uniqueTransitions: number;
    transitionStabilityScore: number;
}

interface RecommendationSurfaceTrendPoint {
    surface: string;
    rawRows: number;
    strictRows: number;
    parserDropRate: number;
    parseCoverage: number;
    transitionStabilityScore: number;
}

interface CohortStabilitySummary {
    eligibleUsers: number;
    lowDataUsers: number;
    cohortCount: number;
    smallCohortCount: number;
    smallCohortUserShare: number;
    stabilityScore: number;
    networkStrength: number;
}

export interface DataQualityDiagnosticsResult {
    platform: string;
    windowHours: number;
    generatedAt: string;
    totals: {
        users: number;
        snapshots: number;
        feedItems: number;
        stitchedFeedItems: number;
        uniqueVideos: number;
    };
    stitching: StitchingSummary & {
        sessionGapMinutes: number;
        duplicateWindowSeconds: number;
    };
    recommendations: RecommendationSummary;
    cohorts: CohortStabilitySummary;
}

export interface DataQualityTrendPoint {
    windowStart: string;
    windowEnd: string;
    users: number;
    snapshots: number;
    stitchedSessions: number;
    dedupeRate: number;
    parseCoverage: number;
    parserDropRate: number;
    cohortStabilityScore: number;
    networkStrength: number;
    surfaceMetrics: RecommendationSurfaceTrendPoint[];
}

export interface DataQualityTrendResult {
    platform: string;
    windowHours: number;
    bucketHours: number;
    generatedAt: string;
    points: DataQualityTrendPoint[];
}

export class DataQualityInputError extends Error {
    statusCode: number;
    details?: Record<string, unknown>;

    constructor(message: string, statusCode = 400, details?: Record<string, unknown>) {
        super(message);
        this.name = 'DataQualityInputError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function sanitizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeSurfaceLabel(value: unknown): string {
    const sanitized = sanitizeString(value);
    if (!sanitized) return 'unknown';

    const normalized = sanitized
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    return normalized.length > 0 ? normalized.slice(0, 48) : 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function decodeSessionMetadata(data: Buffer | null): Record<string, unknown> | null {
    if (!data) return null;
    try {
        const decoded = isCompressedMsgpack(data)
            ? decompressAndUnpack<unknown>(data)
            : JSON.parse(data.toString('utf-8'));
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
            return null;
        }
        return decoded as Record<string, unknown>;
    } catch {
        return null;
    }
}

function decodeMetrics(metrics: Buffer | null): unknown {
    if (!metrics) return null;
    try {
        return isCompressedMsgpack(metrics)
            ? decompressAndUnpack<unknown>(metrics)
            : JSON.parse(metrics.toString('utf-8'));
    } catch {
        return null;
    }
}

function overlapRatio(left: Set<string>, right: Set<string>) {
    if (left.size === 0 || right.size === 0) return 0;

    let intersection = 0;
    const smaller = left.size <= right.size ? left : right;
    const larger = left.size <= right.size ? right : left;

    for (const value of smaller) {
        if (larger.has(value)) {
            intersection += 1;
        }
    }

    return intersection / Math.max(left.size, right.size);
}

function deriveNetworkStrength(comparedUsers: number, comparedTransitions: number) {
    const userSignal = 1 - Math.exp(-comparedUsers / 40);
    const transitionSignal = 1 - Math.exp(-comparedTransitions / 4000);
    return roundTo(clamp(userSignal * 0.6 + transitionSignal * 0.4, 0, 1));
}

function groupSnapshotsByUser(snapshots: DiagnosticsSnapshot[]) {
    const byUser = new Map<string, DiagnosticsSnapshot[]>();

    for (const snapshot of snapshots) {
        const userId = sanitizeString(snapshot.userId);
        if (!userId) continue;

        let userSnapshots = byUser.get(userId);
        if (!userSnapshots) {
            userSnapshots = [];
            byUser.set(userId, userSnapshots);
        }
        userSnapshots.push(snapshot);
    }

    for (const userSnapshots of byUser.values()) {
        userSnapshots.sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
    }

    return byUser;
}

function stitchSnapshots(
    snapshots: DiagnosticsSnapshot[]
): {
    stitchedItems: RawAudienceFeedItem[];
    stitching: StitchingSummary;
} {
    const snapshotsByUser = groupSnapshotsByUser(snapshots);
    const stitchedItems: RawAudienceFeedItem[] = [];

    let snapshotsAfterDedupe = 0;
    let dedupedSnapshots = 0;
    let stitchedSessions = 0;
    let snapshotsWithQualityFingerprint = 0;
    let snapshotsWithStitchedSessionKey = 0;

    for (const [userId, userSnapshots] of snapshotsByUser.entries()) {
        let nextSessionNumber = 0;
        let lastSessionId: string | null = null;
        const stitchedSessionKeyToSessionId = new Map<string, string>();
        let previousKept: {
            capturedAtMs: number;
            fingerprintKey: string;
            fingerprintIds: Set<string>;
            fingerprintHash: string | null;
        } | null = null;

        for (const snapshot of userSnapshots) {
            const metadata = decodeSessionMetadata(snapshot.sessionMetadata);
            const quality = asRecord(metadata?.quality);
            const qualityFingerprintHash = sanitizeString(quality.fingerprintHash);
            const stitchedSessionKey = sanitizeString(quality.stitchedSessionKey);
            if (qualityFingerprintHash) {
                snapshotsWithQualityFingerprint += 1;
            }
            if (stitchedSessionKey) {
                snapshotsWithStitchedSessionKey += 1;
            }

            const capturedAtMs = snapshot.capturedAt.getTime();
            let sessionId: string;

            if (stitchedSessionKey) {
                const existingSessionId = stitchedSessionKeyToSessionId.get(stitchedSessionKey);
                if (existingSessionId) {
                    sessionId = existingSessionId;
                } else {
                    nextSessionNumber += 1;
                    stitchedSessions += 1;
                    sessionId = `${userId}:session-${nextSessionNumber}`;
                    stitchedSessionKeyToSessionId.set(stitchedSessionKey, sessionId);
                }
                lastSessionId = sessionId;
            } else {
                const startsNewSession = !previousKept || (capturedAtMs - previousKept.capturedAtMs > SESSION_GAP_MS);
                if (startsNewSession || !lastSessionId) {
                    nextSessionNumber += 1;
                    stitchedSessions += 1;
                    lastSessionId = `${userId}:session-${nextSessionNumber}`;
                }
                sessionId = lastSessionId;
            }

            const fingerprint = buildSnapshotFingerprint(snapshot.feedItems);
            const fingerprintIds = new Set(fingerprint.orderedVideoIds);

            const isDuplicate = previousKept
                ? (() => {
                    const gapMs = capturedAtMs - previousKept.capturedAtMs;
                    if (gapMs > DUPLICATE_WINDOW_MS) return false;
                    if (qualityFingerprintHash && previousKept.fingerprintHash && qualityFingerprintHash === previousKept.fingerprintHash) {
                        return true;
                    }
                    if (fingerprint.key === previousKept.fingerprintKey) return true;
                    return overlapRatio(fingerprintIds, previousKept.fingerprintIds) >= DUPLICATE_OVERLAP_THRESHOLD;
                })()
                : false;

            if (isDuplicate) {
                dedupedSnapshots += 1;
                continue;
            }

            snapshotsAfterDedupe += 1;
            previousKept = {
                capturedAtMs,
                fingerprintKey: fingerprint.key,
                fingerprintIds,
                fingerprintHash: qualityFingerprintHash,
            };

            for (const feedItem of snapshot.feedItems) {
                stitchedItems.push({
                    userId,
                    videoId: feedItem.videoId,
                    creatorHandle: feedItem.creatorHandle,
                    contentCategories: feedItem.contentCategories,
                    engagementMetrics: feedItem.engagementMetrics,
                    sessionId,
                });
            }
        }
    }

    const totalSnapshots = snapshots.length;
    const duplicateRate = totalSnapshots > 0 ? dedupedSnapshots / totalSnapshots : 0;
    const avgSnapshotsPerSession = stitchedSessions > 0 ? snapshotsAfterDedupe / stitchedSessions : 0;

    return {
        stitchedItems,
        stitching: {
            totalSnapshots,
            snapshotsAfterDedupe,
            dedupedSnapshots,
            duplicateRate: roundTo(duplicateRate),
            stitchedSessions,
            avgSnapshotsPerSession: roundTo(avgSnapshotsPerSession, 2),
            snapshotsWithQualityFingerprint,
            snapshotsWithStitchedSessionKey,
        },
    };
}

function summarizeRecommendations(items: RawAudienceFeedItem[], platform: string): RecommendationSummary {
    let itemsWithMetrics = 0;
    let decodableMetricItems = 0;
    let itemsWithRecommendationArray = 0;
    let rawRecommendationRows = 0;
    let strictRecommendationRows = 0;
    let itemsWithParsedRecommendations = 0;
    const rawRowsBySurface = new Map<string, number>();
    const strictRowsBySurface = new Map<string, number>();
    const transitionCountsBySurface = new Map<string, Map<string, number>>();

    for (const item of items) {
        if (!item.engagementMetrics) continue;
        itemsWithMetrics += 1;

        const decoded = decodeMetrics(item.engagementMetrics);
        if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
            decodableMetricItems += 1;
            const recommendations = (decoded as { recommendations?: unknown }).recommendations;
            if (Array.isArray(recommendations)) {
                itemsWithRecommendationArray += 1;
                rawRecommendationRows += recommendations.length;
                for (const recommendation of recommendations) {
                    if (!recommendation || typeof recommendation !== 'object') continue;
                    const rec = recommendation as Record<string, unknown>;
                    const surface = normalizeSurfaceLabel(rec.surface ?? rec.source ?? rec.placement);
                    rawRowsBySurface.set(surface, (rawRowsBySurface.get(surface) ?? 0) + 1);
                }
            }
        }

        const strictRecommendations = extractRecommendationsFromMetrics(item.engagementMetrics, {
            platform,
            sourceVideoId: item.videoId,
            maxRecommendations: 25,
        });

        if (strictRecommendations.length > 0) {
            itemsWithParsedRecommendations += 1;
            strictRecommendationRows += strictRecommendations.length;
            for (const recommendation of strictRecommendations) {
                const primarySurface = normalizeSurfaceLabel(recommendation.surface ?? recommendation.surfaces[0]);
                strictRowsBySurface.set(primarySurface, (strictRowsBySurface.get(primarySurface) ?? 0) + 1);

                const edgeKey = `${item.videoId}->${recommendation.videoId}`;
                let surfaceTransitions = transitionCountsBySurface.get(primarySurface);
                if (!surfaceTransitions) {
                    surfaceTransitions = new Map<string, number>();
                    transitionCountsBySurface.set(primarySurface, surfaceTransitions);
                }
                surfaceTransitions.set(edgeKey, (surfaceTransitions.get(edgeKey) ?? 0) + 1);
            }
        }
    }

    const parserDropRate = rawRecommendationRows > 0
        ? 1 - (strictRecommendationRows / rawRecommendationRows)
        : 0;
    const parseCoverage = itemsWithRecommendationArray > 0
        ? itemsWithParsedRecommendations / itemsWithRecommendationArray
        : 0;
    const avgRecommendationsPerItem = itemsWithParsedRecommendations > 0
        ? strictRecommendationRows / itemsWithParsedRecommendations
        : 0;

    const surfaces = new Set<string>([
        ...rawRowsBySurface.keys(),
        ...strictRowsBySurface.keys(),
        ...transitionCountsBySurface.keys(),
    ]);

    const bySurface: RecommendationSurfaceDiagnostics[] = Array.from(surfaces.values())
        .map((surface) => {
            const rawRows = rawRowsBySurface.get(surface) ?? 0;
            const strictRows = strictRowsBySurface.get(surface) ?? 0;
            const parserDropRateForSurface = rawRows > 0
                ? 1 - (strictRows / rawRows)
                : 0;
            const parseCoverageForSurface = rawRows > 0
                ? strictRows / rawRows
                : 0;

            const transitions = transitionCountsBySurface.get(surface) ?? new Map<string, number>();
            let repeatedTransitionRows = 0;
            for (const count of transitions.values()) {
                if (count > 1) {
                    repeatedTransitionRows += count;
                }
            }

            const transitionStabilityScore = strictRows > 0
                ? repeatedTransitionRows / strictRows
                : 0;

            return {
                surface,
                rawRows,
                strictRows,
                parserDropRate: roundTo(parserDropRateForSurface),
                parseCoverage: roundTo(parseCoverageForSurface),
                uniqueTransitions: transitions.size,
                transitionStabilityScore: roundTo(transitionStabilityScore),
            };
        })
        .sort((left, right) => {
            if (right.rawRows !== left.rawRows) return right.rawRows - left.rawRows;
            if (right.strictRows !== left.strictRows) return right.strictRows - left.strictRows;
            return left.surface.localeCompare(right.surface);
        })
        .slice(0, 12);

    const stabilityWeightTotal = bySurface.reduce((sum, entry) => sum + entry.strictRows, 0);
    const surfaceTransitionStability = stabilityWeightTotal > 0
        ? bySurface.reduce((sum, entry) => sum + (entry.transitionStabilityScore * entry.strictRows), 0) / stabilityWeightTotal
        : 0;

    return {
        itemsWithMetrics,
        decodableMetricItems,
        itemsWithRecommendationArray,
        rawRecommendationRows,
        strictRecommendationRows,
        parserDropRate: roundTo(parserDropRate),
        itemsWithParsedRecommendations,
        parseCoverage: roundTo(parseCoverage),
        avgRecommendationsPerItem: roundTo(avgRecommendationsPerItem, 2),
        surfaceTransitionStability: roundTo(surfaceTransitionStability),
        bySurface,
    };
}

function summarizeCohorts(items: RawAudienceFeedItem[], platform: string): CohortStabilitySummary {
    const userSessionVideoSet = new Map<string, Set<string>>();

    for (const item of items) {
        const userId = sanitizeString(item.userId);
        const videoId = sanitizeString(item.videoId);
        const sessionId = sanitizeString(item.sessionId);
        if (!userId || !videoId || !sessionId) continue;

        let uniqueSessionVideos = userSessionVideoSet.get(userId);
        if (!uniqueSessionVideos) {
            uniqueSessionVideos = new Set<string>();
            userSessionVideoSet.set(userId, uniqueSessionVideos);
        }

        uniqueSessionVideos.add(`${sessionId}:${videoId}`);
    }

    let lowDataUsers = 0;
    for (const uniqueSessionVideos of userSessionVideoSet.values()) {
        if (uniqueSessionVideos.size < 3) {
            lowDataUsers += 1;
        }
    }

    const model = buildAudienceModel(items, platform);
    let smallCohortCount = 0;
    let smallCohortUsers = 0;
    for (const cohort of model.cohorts.values()) {
        if (cohort.users.length <= 2) {
            smallCohortCount += 1;
            smallCohortUsers += cohort.users.length;
        }
    }

    const eligibleUsers = model.userProfiles.size;
    const smallCohortUserShare = eligibleUsers > 0 ? smallCohortUsers / eligibleUsers : 0;
    const stabilityScore = 1 - clamp(smallCohortUserShare, 0, 1);

    return {
        eligibleUsers,
        lowDataUsers,
        cohortCount: model.cohorts.size,
        smallCohortCount,
        smallCohortUserShare: roundTo(smallCohortUserShare),
        stabilityScore: roundTo(stabilityScore),
        networkStrength: deriveNetworkStrength(eligibleUsers, model.totalTransitions),
    };
}

export function summarizeDataQualityFromSnapshots(
    platform: string,
    snapshots: DiagnosticsSnapshot[],
    windowHours: number
): DataQualityDiagnosticsResult {
    if (snapshots.length === 0) {
        throw new DataQualityInputError(`No ${platform} snapshots found in the selected time window.`, 404, {
            platform,
            windowHours,
        });
    }

    const users = new Set<string>();
    let feedItems = 0;
    const uniqueVideos = new Set<string>();

    for (const snapshot of snapshots) {
        const userId = sanitizeString(snapshot.userId);
        if (userId) users.add(userId);
        feedItems += snapshot.feedItems.length;
        for (const item of snapshot.feedItems) {
            const videoId = sanitizeString(item.videoId);
            if (videoId) uniqueVideos.add(videoId);
        }
    }

    const { stitchedItems, stitching } = stitchSnapshots(snapshots);
    const recommendationSummary = summarizeRecommendations(stitchedItems, platform);
    const cohortSummary = summarizeCohorts(stitchedItems, platform);

    return {
        platform,
        windowHours,
        generatedAt: new Date().toISOString(),
        totals: {
            users: users.size,
            snapshots: snapshots.length,
            feedItems,
            stitchedFeedItems: stitchedItems.length,
            uniqueVideos: uniqueVideos.size,
        },
        stitching: {
            sessionGapMinutes: Math.round(SESSION_GAP_MS / 60000),
            duplicateWindowSeconds: Math.round(DUPLICATE_WINDOW_MS / 1000),
            ...stitching,
        },
        recommendations: recommendationSummary,
        cohorts: cohortSummary,
    };
}

export async function generateDataQualityDiagnostics(
    platform: string,
    windowHours = 24 * 14
): Promise<DataQualityDiagnosticsResult> {
    const normalizedPlatform = sanitizeString(platform)?.toLowerCase();
    if (!normalizedPlatform) {
        throw new DataQualityInputError('platform is required');
    }

    const boundedWindowHours = clamp(Math.round(windowHours), 1, 24 * 180);
    const since = new Date(Date.now() - boundedWindowHours * 60 * 60 * 1000);

    const prisma = await getPrismaClient();
    const snapshots = await prisma.feedSnapshot.findMany({
        where: {
            platform: normalizedPlatform,
            capturedAt: { gte: since },
        },
        select: {
            id: true,
            userId: true,
            capturedAt: true,
            sessionMetadata: true,
            feedItems: {
                select: {
                    videoId: true,
                    creatorHandle: true,
                    contentCategories: true,
                    engagementMetrics: true,
                    positionInFeed: true,
                },
            },
        },
        orderBy: [
            { userId: 'asc' },
            { capturedAt: 'asc' },
        ],
        take: 3000,
    });

    return summarizeDataQualityFromSnapshots(normalizedPlatform, snapshots, boundedWindowHours);
}

export function summarizeDataQualityTrendFromSnapshots(
    platform: string,
    snapshots: DiagnosticsSnapshot[],
    windowHours: number,
    bucketHours: number
): DataQualityTrendResult {
    if (snapshots.length === 0) {
        throw new DataQualityInputError(`No ${platform} snapshots found in the selected time window.`, 404, {
            platform,
            windowHours,
            bucketHours,
        });
    }

    const boundedBucketHours = clamp(Math.round(bucketHours), 1, Math.max(1, Math.round(windowHours)));
    const bucketMs = boundedBucketHours * 60 * 60 * 1000;
    const byBucket = new Map<number, DiagnosticsSnapshot[]>();

    for (const snapshot of snapshots) {
        const bucketStartMs = Math.floor(snapshot.capturedAt.getTime() / bucketMs) * bucketMs;
        let bucketSnapshots = byBucket.get(bucketStartMs);
        if (!bucketSnapshots) {
            bucketSnapshots = [];
            byBucket.set(bucketStartMs, bucketSnapshots);
        }
        bucketSnapshots.push(snapshot);
    }

    const points = Array.from(byBucket.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([bucketStartMs, bucketSnapshots]) => {
            const summary = summarizeDataQualityFromSnapshots(
                platform,
                bucketSnapshots,
                boundedBucketHours
            );

            return {
                windowStart: new Date(bucketStartMs).toISOString(),
                windowEnd: new Date(bucketStartMs + bucketMs).toISOString(),
                users: summary.totals.users,
                snapshots: summary.totals.snapshots,
                stitchedSessions: summary.stitching.stitchedSessions,
                dedupeRate: summary.stitching.duplicateRate,
                parseCoverage: summary.recommendations.parseCoverage,
                parserDropRate: summary.recommendations.parserDropRate,
                cohortStabilityScore: summary.cohorts.stabilityScore,
                networkStrength: summary.cohorts.networkStrength,
                surfaceMetrics: summary.recommendations.bySurface.map((surface) => ({
                    surface: surface.surface,
                    rawRows: surface.rawRows,
                    strictRows: surface.strictRows,
                    parserDropRate: surface.parserDropRate,
                    parseCoverage: surface.parseCoverage,
                    transitionStabilityScore: surface.transitionStabilityScore,
                })),
            };
        });

    return {
        platform,
        windowHours: Math.round(windowHours),
        bucketHours: boundedBucketHours,
        generatedAt: new Date().toISOString(),
        points,
    };
}

export async function generateDataQualityTrends(
    platform: string,
    windowHours = 24 * 14,
    bucketHours = 24
): Promise<DataQualityTrendResult> {
    const normalizedPlatform = sanitizeString(platform)?.toLowerCase();
    if (!normalizedPlatform) {
        throw new DataQualityInputError('platform is required');
    }

    const boundedWindowHours = clamp(Math.round(windowHours), 1, 24 * 180);
    const boundedBucketHours = clamp(Math.round(bucketHours), 1, boundedWindowHours);
    const since = new Date(Date.now() - boundedWindowHours * 60 * 60 * 1000);

    const prisma = await getPrismaClient();
    const snapshots = await prisma.feedSnapshot.findMany({
        where: {
            platform: normalizedPlatform,
            capturedAt: { gte: since },
        },
        select: {
            id: true,
            userId: true,
            capturedAt: true,
            sessionMetadata: true,
            feedItems: {
                select: {
                    videoId: true,
                    creatorHandle: true,
                    contentCategories: true,
                    engagementMetrics: true,
                    positionInFeed: true,
                },
            },
        },
        orderBy: [
            { userId: 'asc' },
            { capturedAt: 'asc' },
        ],
        take: 3000,
    });

    return summarizeDataQualityTrendFromSnapshots(
        normalizedPlatform,
        snapshots,
        boundedWindowHours,
        boundedBucketHours
    );
}
