import { decodeSessionMetadataResult } from './sessionMetadata.js';
import { asRecord, sanitizeString } from '../lib/ingestUtils.js';
import type { RawAudienceFeedItem } from './audienceForecast.js';
import { config } from '../config.js';

let prismaClientPromise: Promise<any> | null = null;
const audienceFeedItemsCache = new Map<string, {
    expiresAt: number;
    watermarkKey: string;
    value: LoadedAudienceFeedItems;
}>();

async function getPrismaClient() {
    if (!prismaClientPromise) {
        prismaClientPromise = import('../lib/prisma.js').then((module) => module.prisma);
    }
    return prismaClientPromise;
}

interface SnapshotFeedItem {
    videoId: string;
    creatorHandle: string | null;
    contentCategories: string[];
    engagementMetrics: Buffer | null;
    positionInFeed: number;
}

interface AudienceSnapshot {
    id: string;
    userId: string;
    capturedAt: Date;
    sessionMetadata: Buffer | null;
    feedItems: SnapshotFeedItem[];
}

export interface AudienceMetadataIntegritySummary {
    totalSnapshots: number;
    snapshotsWithMetadata: number;
    decodedMetadataSnapshots: number;
    invalidMetadataSnapshots: number;
    metadataIntegrityScore: number;
}

export interface LoadedAudienceFeedItems {
    items: RawAudienceFeedItem[];
    metadataIntegrity: AudienceMetadataIntegritySummary;
    loadStats: {
        snapshotCount: number;
        stitchedItemCount: number;
        durationMs: number;
        cacheStatus: 'hit' | 'miss';
        watermarkKey: string;
    };
}

interface AudienceDatasetWatermark {
    snapshotCount: number;
    latestCapturedAt: Date | null;
    watermarkKey: string;
}

const SESSION_GAP_MS = 25 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const SNAPSHOT_FINGERPRINT_LIMIT = 35;
const DUPLICATE_OVERLAP_THRESHOLD = 0.9;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function buildSnapshotFingerprint(items: SnapshotFeedItem[]) {
    const orderedIds = items
        .slice()
        .sort((a, b) => a.positionInFeed - b.positionInFeed)
        .map((item) => sanitizeString(item.videoId))
        .filter((videoId): videoId is string => Boolean(videoId))
        .slice(0, SNAPSHOT_FINGERPRINT_LIMIT);

    return {
        key: orderedIds.join('|'),
        ids: new Set(orderedIds),
    };
}

function overlapRatio(left: Set<string>, right: Set<string>) {
    if (left.size === 0 || right.size === 0) return 0;

    let intersection = 0;
    const smaller = left.size <= right.size ? left : right;
    const larger = left.size <= right.size ? right : left;
    for (const item of smaller) {
        if (larger.has(item)) intersection += 1;
    }

    return intersection / Math.max(left.size, right.size);
}

function stitchAndDedupeSnapshots(snapshots: AudienceSnapshot[]): RawAudienceFeedItem[] {
    const stitchedItems: RawAudienceFeedItem[] = [];
    const snapshotsByUser = new Map<string, AudienceSnapshot[]>();

    for (const snapshot of snapshots) {
        const userId = sanitizeString(snapshot.userId);
        if (!userId) continue;

        let userSnapshots = snapshotsByUser.get(userId);
        if (!userSnapshots) {
            userSnapshots = [];
            snapshotsByUser.set(userId, userSnapshots);
        }
        userSnapshots.push(snapshot);
    }

    for (const [userId, userSnapshots] of snapshotsByUser.entries()) {
        userSnapshots.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

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
            const metadataResult = decodeSessionMetadataResult(snapshot.sessionMetadata);
            const quality = asRecord(metadataResult.metadata?.quality);
            const stitchedSessionKey = sanitizeString(quality.stitchedSessionKey);
            const fingerprintHash = sanitizeString(quality.fingerprintHash);
            const capturedAtMs = snapshot.capturedAt.getTime();

            let sessionId: string;
            if (stitchedSessionKey) {
                const existingSessionId = stitchedSessionKeyToSessionId.get(stitchedSessionKey);
                if (existingSessionId) {
                    sessionId = existingSessionId;
                } else {
                    nextSessionNumber += 1;
                    sessionId = `${userId}:session-${nextSessionNumber}`;
                    stitchedSessionKeyToSessionId.set(stitchedSessionKey, sessionId);
                }
                lastSessionId = sessionId;
            } else {
                const isNewSession = !previousKept || (capturedAtMs - previousKept.capturedAtMs > SESSION_GAP_MS);
                if (isNewSession || !lastSessionId) {
                    nextSessionNumber += 1;
                    lastSessionId = `${userId}:session-${nextSessionNumber}`;
                }
                sessionId = lastSessionId;
            }

            const fingerprint = buildSnapshotFingerprint(snapshot.feedItems);
            const isDuplicate = previousKept
                ? (() => {
                    const gapMs = capturedAtMs - previousKept.capturedAtMs;
                    if (gapMs > DUPLICATE_WINDOW_MS) return false;
                    if (fingerprintHash && previousKept.fingerprintHash && fingerprintHash === previousKept.fingerprintHash) {
                        return true;
                    }
                    if (fingerprint.key === previousKept.fingerprintKey) return true;
                    return overlapRatio(fingerprint.ids, previousKept.fingerprintIds) >= DUPLICATE_OVERLAP_THRESHOLD;
                })()
                : false;

            if (isDuplicate) {
                continue;
            }

            previousKept = {
                capturedAtMs,
                fingerprintKey: fingerprint.key,
                fingerprintIds: fingerprint.ids,
                fingerprintHash,
            };

            for (const feedItem of snapshot.feedItems) {
                stitchedItems.push({
                    userId,
                    videoId: feedItem.videoId,
                    creatorHandle: feedItem.creatorHandle,
                    contentCategories: feedItem.contentCategories,
                    engagementMetrics: feedItem.engagementMetrics,
                    sessionId,
                    capturedAt: snapshot.capturedAt,
                });
            }
        }
    }

    return stitchedItems;
}

function summarizeAudienceMetadataIntegrity(snapshots: AudienceSnapshot[]): AudienceMetadataIntegritySummary {
    let snapshotsWithMetadata = 0;
    let decodedMetadataSnapshots = 0;
    let invalidMetadataSnapshots = 0;

    for (const snapshot of snapshots) {
        const decoded = decodeSessionMetadataResult(snapshot.sessionMetadata);
        if (decoded.status === 'missing') {
            continue;
        }

        snapshotsWithMetadata += 1;
        if (decoded.status === 'decoded') {
            decodedMetadataSnapshots += 1;
        } else {
            invalidMetadataSnapshots += 1;
        }
    }

    const metadataIntegrityScore = snapshotsWithMetadata > 0
        ? decodedMetadataSnapshots / snapshotsWithMetadata
        : 1;

    return {
        totalSnapshots: snapshots.length,
        snapshotsWithMetadata,
        decodedMetadataSnapshots,
        invalidMetadataSnapshots,
        metadataIntegrityScore: roundTo(clamp(metadataIntegrityScore, 0, 1)),
    };
}

async function loadAudienceDatasetWatermark(platform: string): Promise<AudienceDatasetWatermark> {
    const prisma = await getPrismaClient();
    const summary = await prisma.feedSnapshot.aggregate({
        where: { platform },
        _count: {
            _all: true,
        },
        _max: {
            capturedAt: true,
        },
    });

    const snapshotCount = Number(summary?._count?._all ?? 0);
    const latestCapturedAt = summary?._max?.capturedAt ?? null;
    const watermarkKey = `${platform}:${snapshotCount}:${latestCapturedAt?.getTime() ?? 0}`;

    return {
        snapshotCount,
        latestCapturedAt,
        watermarkKey,
    };
}

export function resetAudienceFeedItemsCacheForTests() {
    audienceFeedItemsCache.clear();
}

export async function loadAudienceFeedItemsDetailed(platform: string): Promise<LoadedAudienceFeedItems> {
    const startedAt = Date.now();
    const watermark = await loadAudienceDatasetWatermark(platform);
    const cached = audienceFeedItemsCache.get(platform);
    if (
        cached
        && cached.expiresAt > Date.now()
        && cached.watermarkKey === watermark.watermarkKey
    ) {
        return {
            ...cached.value,
            loadStats: {
                ...cached.value.loadStats,
                durationMs: Date.now() - startedAt,
                cacheStatus: 'hit',
            },
        };
    }

    const prisma = await getPrismaClient();
    const snapshots = await prisma.feedSnapshot.findMany({
        where: { platform },
        select: {
            id: true,
            userId: true,
            capturedAt: true,
            sessionMetadata: true,
            feedItems: {
                orderBy: {
                    positionInFeed: 'asc',
                },
                select: {
                    videoId: true,
                    creatorHandle: true,
                    contentCategories: true,
                    engagementMetrics: true,
                    positionInFeed: true,
                },
            },
        },
        take: 1200,
        orderBy: [
            { userId: 'asc' },
            { capturedAt: 'asc' },
        ],
    });

    if (snapshots.length === 0) {
        return {
            items: [],
            metadataIntegrity: summarizeAudienceMetadataIntegrity([]),
            loadStats: {
                snapshotCount: 0,
                stitchedItemCount: 0,
                durationMs: Date.now() - startedAt,
                cacheStatus: 'miss',
                watermarkKey: watermark.watermarkKey,
            },
        };
    }

    const items = stitchAndDedupeSnapshots(snapshots);
    const result: LoadedAudienceFeedItems = {
        items,
        metadataIntegrity: summarizeAudienceMetadataIntegrity(snapshots),
        loadStats: {
            snapshotCount: snapshots.length,
            stitchedItemCount: items.length,
            durationMs: Date.now() - startedAt,
            cacheStatus: 'miss',
            watermarkKey: watermark.watermarkKey,
        },
    };

    audienceFeedItemsCache.set(platform, {
        expiresAt: Date.now() + config.analytics.datasetCacheTtlMs,
        watermarkKey: watermark.watermarkKey,
        value: result,
    });

    return result;
}

export async function loadAudienceFeedItems(platform: string): Promise<RawAudienceFeedItem[]> {
    const { items } = await loadAudienceFeedItemsDetailed(platform);
    return items;
}
