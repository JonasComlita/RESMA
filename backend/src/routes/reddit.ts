import { Router } from 'express';
import {
    asRecord,
    normalizeSurface,
    parseNonNegativeInt,
    parseNonNegativeNumber,
    sanitizeString,
} from '../lib/ingestUtils.js';
import { authenticate } from '../middleware/authenticate.js';
import { createError } from '../middleware/errorHandler.js';
import { validateIngestPayload, type ValidatedFeedRequest } from '../middleware/validateIngestPayload.js';
import { packAndCompress } from '../services/serialization.js';
import { buildSessionQualityMetadata } from '../services/snapshotQuality.js';
import {
    CURRENT_INGEST_VERSION,
    normalizeRedditPostId,
    normalizeSubredditName,
} from '@resma/shared';
import { withDurableIngestIdempotency } from '../services/ingestIdempotency.js';
import { logIngestError, logIngestInfo } from '../services/ingestObservability.js';
import { getReplayKey, getUploadId, withIngestReplayGuard } from '../services/ingestReplayGuard.js';

const router: Router = Router();
const REDDIT_POST_TYPES = new Set(['text', 'link', 'image', 'gallery', 'video', 'poll', 'crosspost']);

function normalizeFlairCategory(raw: unknown): string | null {
    const value = sanitizeString(raw);
    if (!value) {
        return null;
    }

    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 48);

    return normalized.length > 0 ? normalized : null;
}

function addCategory(categories: Set<string>, raw: unknown) {
    const value = sanitizeString(raw);
    if (!value) {
        return;
    }

    const normalized = value.toLowerCase();
    if (normalized) {
        categories.add(normalized);
    }
}

function buildRedditContentCategories(item: Record<string, unknown>, subreddit: string | null): string[] {
    const categories = new Set<string>();
    const postType = sanitizeString(item.type ?? item.postType)?.toLowerCase();
    if (postType && REDDIT_POST_TYPES.has(postType)) {
        categories.add(postType);
    }

    if (subreddit) {
        categories.add(subreddit.toLowerCase());
    }

    if (item.isPromoted || item.isAd) {
        categories.add('promoted');
    }
    if (item.isNsfw || item.over18) {
        categories.add('nsfw');
    }
    if (item.isSpoiler) {
        categories.add('spoiler');
    }

    const flairCategory = normalizeFlairCategory(item.flair ?? item.linkFlair);
    if (flairCategory) {
        categories.add(flairCategory);
    }

    if (Array.isArray(item.contentCategories)) {
        for (const category of item.contentCategories) {
            addCategory(categories, category);
        }
    }

    return Array.from(categories.values());
}

// POST /reddit/feed - receive Reddit feed data batch
router.post('/feed', authenticate, validateIngestPayload({
    platform: 'reddit',
    routeLabel: '/reddit/feed',
}), async (req: ValidatedFeedRequest, res, next) => {
    try {
        const validPayload = req.validatedFeedPayload!;
        const incomingMetadata = asRecord(validPayload.sessionMetadata);
        const itemsToCreate = validPayload.feed
            .map((rawItem, index) => {
                const item = asRecord(rawItem);
                const videoId = normalizeRedditPostId(item.videoId ?? item.postId ?? item.id ?? item.url);
                if (!videoId) {
                    return null;
                }

                const normalizedSubreddit = normalizeSubredditName(item.creatorHandle ?? item.subreddit);
                const creatorHandle = normalizedSubreddit ?? sanitizeString(item.creatorHandle ?? item.subreddit);
                const likesCount = parseNonNegativeInt(item.likesCount ?? item.score ?? item.upvotes);
                const commentsCount = parseNonNegativeInt(item.commentsCount ?? item.comments ?? item.numComments);
                const watchDuration = parseNonNegativeNumber(item.watchDuration ?? item.watchTime ?? 0) ?? 0;
                const contentCategories = buildRedditContentCategories(item, normalizedSubreddit ?? creatorHandle);
                const interactionType = sanitizeString(item.interactionType);

                const engagementMetrics = packAndCompress({
                    score: likesCount,
                    upvoteRatio: parseNonNegativeNumber(item.upvoteRatio) ?? null,
                    commentCount: commentsCount,
                    awardCount: parseNonNegativeInt(item.awardCount ?? item.totalAwardsReceived) ?? 0,
                    postType: sanitizeString(item.type ?? item.postType) ?? 'unknown',
                    authorHandle: sanitizeString(item.authorHandle ?? item.author) ?? null,
                    subreddit: sanitizeString(item.creatorHandle ?? item.subreddit) ?? null,
                    flair: sanitizeString(item.flair ?? item.linkFlair) ?? null,
                    isNsfw: Boolean(item.isNsfw ?? item.over18),
                    isSpoiler: Boolean(item.isSpoiler),
                    isCrosspost: Boolean(item.isCrosspost ?? item.crosspostParentId),
                    crosspostParentId: sanitizeString(item.crosspostParentId) ?? null,
                    domain: sanitizeString(item.domain ?? item.url) ?? null,
                    watchTime: watchDuration,
                    isPromoted: Boolean(item.isPromoted ?? item.isAd),
                }).data;

                return {
                    videoId,
                    creatorHandle,
                    creatorId: creatorHandle,
                    positionInFeed: parseNonNegativeInt(item.positionInFeed ?? item.position) ?? index,
                    caption: sanitizeString(item.caption ?? item.title)?.substring(0, 500) ?? null,
                    likesCount,
                    commentsCount,
                    sharesCount: null,
                    engagementMetrics,
                    contentCategories,
                    watchDuration,
                    interacted: Boolean(item.interacted ?? item.hasInteracted),
                    interactionType,
                };
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        if (itemsToCreate.length === 0) {
            return next(createError('Invalid feed item structure', 400));
        }

        const replayKey = getReplayKey(req, req.userId);
        const uploadId = getUploadId(req);
        const replayOutcome = await withIngestReplayGuard(replayKey, async () => {
            const durableOutcome = await withDurableIngestIdempotency({
                userId: req.userId!,
                uploadId,
                createSnapshot: async (tx) => {
                    const capturedAt = new Date();
                    const enrichedSessionMetadata = buildSessionQualityMetadata({
                        userId: req.userId!,
                        platform: 'reddit',
                        capturedAt,
                        feedItems: itemsToCreate.map((item) => ({
                            videoId: item.videoId,
                            positionInFeed: item.positionInFeed,
                        })),
                        existingMetadata: {
                            ...incomingMetadata,
                            type: sanitizeString(incomingMetadata.type) ?? 'REDDIT_FEED_SNAPSHOT',
                            captureSurface: normalizeSurface(
                                incomingMetadata.captureSurface ?? 'home-feed',
                                'reddit'
                            ),
                            subreddit: sanitizeString(incomingMetadata.subreddit) ?? null,
                            feedSort: sanitizeString(incomingMetadata.feedSort) ?? null,
                            timestamp: Date.now(),
                            ingestVersion: CURRENT_INGEST_VERSION,
                        },
                    });

                    const snapshot = await tx.feedSnapshot.create({
                        data: {
                            userId: req.userId!,
                            platform: 'reddit',
                            capturedAt,
                            itemCount: itemsToCreate.length,
                            sessionMetadata: packAndCompress(enrichedSessionMetadata).data,
                            feedItems: {
                                create: itemsToCreate,
                            },
                        },
                        include: {
                            _count: { select: { feedItems: true } },
                        },
                    });

                    logIngestInfo('Reddit feed snapshot persisted', req, {
                        platform: 'reddit',
                        snapshotId: snapshot.id,
                        itemCount: itemsToCreate.length,
                    });

                    return {
                        snapshotId: snapshot.id,
                        value: {
                            statusCode: 201,
                            body: { success: true, snapshotId: snapshot.id },
                        },
                    };
                },
                onDuplicate: async (snapshotId) => ({
                    statusCode: 201,
                    body: { success: true, snapshotId },
                }),
            });

            if (durableOutcome.replayed) {
                logIngestInfo('Returned persisted /reddit/feed snapshot for duplicate upload id', req, {
                    platform: 'reddit',
                    snapshotId: durableOutcome.snapshotId,
                });
            }

            return durableOutcome.value;
        });

        if (replayOutcome.replayed) {
            logIngestInfo('Replayed prior /reddit/feed ingestion response', req, { platform: 'reddit' });
        }

        res.status(replayOutcome.response.statusCode).json(replayOutcome.response.body);
    } catch (err) {
        logIngestError('Unhandled /reddit/feed ingestion error', req, {
            error: err instanceof Error ? err.message : 'unknown-error',
        });
        console.error('Failed to save Reddit feed data:', err);
        return next(createError('Failed to save Reddit feed data', 500));
    }
});

export default router;
