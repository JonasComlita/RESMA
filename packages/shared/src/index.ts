import { z } from 'zod';

export const SupportedPlatformSchema = z.enum(['youtube', 'instagram', 'tiktok', 'twitter', 'reddit']);
export type SupportedPlatform = z.infer<typeof SupportedPlatformSchema>;
export type PlatformObserverVersions = Record<SupportedPlatform, string>;
export const CURRENT_INGEST_VERSION = '1.0.0';
export const MAX_FEED_ITEMS = 500;
export const FEED_ITEM_LIMIT_ERROR_MESSAGE = `Feed payload exceeds the maximum of ${MAX_FEED_ITEMS} items`;
export const CURRENT_OBSERVER_VERSIONS: PlatformObserverVersions = {
    youtube: 'youtube-observer-v2',
    instagram: 'instagram-observer-v2',
    tiktok: 'tiktok-observer-v2',
    twitter: 'twitter-observer-v1',
    reddit: '1.0.0',
};

export const RecommendationRowSchema = z.object({
    videoId: z.string().min(1),
    position: z.number().int().min(1).optional(),
    title: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    surface: z.string().nullable().optional(),
    surfaces: z.array(z.string()).optional(),
});
export type RecommendationRow = z.infer<typeof RecommendationRowSchema>;

export const FeedEngagementSchema = z.object({
    likes: z.number().nonnegative().optional(),
    comments: z.number().nonnegative().optional(),
    shares: z.number().nonnegative().optional(),
    views: z.number().nonnegative().optional(),
    watchTime: z.number().nonnegative().optional(),
    impressionDuration: z.number().nonnegative().optional(),
    recommendationCount: z.number().int().nonnegative().optional(),
    recommendations: z.array(RecommendationRowSchema).optional(),
}).passthrough();
export type FeedEngagement = z.infer<typeof FeedEngagementSchema>;

export const CapturedFeedItemSchema = z.object({
    videoId: z.string().min(1),
    creatorHandle: z.string().nullable().optional(),
    creatorId: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    positionInFeed: z.number().int().nonnegative().optional(),
    position: z.number().int().nonnegative().optional(),
    musicTitle: z.string().nullable().optional(),
    watchDuration: z.number().nonnegative().optional(),
    interacted: z.boolean().optional(),
    interactionType: z.string().nullable().optional(),
    contentTags: z.array(z.string()).optional(),
    contentCategories: z.array(z.string()).optional(),
    engagementMetrics: FeedEngagementSchema.optional(),
    recommendations: z.array(RecommendationRowSchema).optional(),
    likesCount: z.number().nonnegative().nullable().optional(),
    commentsCount: z.number().nonnegative().nullable().optional(),
    sharesCount: z.number().nonnegative().nullable().optional(),
    savesCount: z.number().nonnegative().nullable().optional(),
}).passthrough();
export type CapturedFeedItem = z.infer<typeof CapturedFeedItemSchema>;

export const SessionMetadataSchema = z.object({
    type: z.string().optional(),
    captureSurface: z.string().optional(),
    clientSessionId: z.string().nullable().optional(),
    observerVersion: z.string().optional(),
    ingestVersion: z.string().optional(),
    uploadEvent: z.string().optional(),
    capturedAt: z.string().optional(),
}).passthrough();
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export const PlatformFeedPayloadSchema = z.object({
    platform: SupportedPlatformSchema,
    feed: z.array(CapturedFeedItemSchema).min(1).max(MAX_FEED_ITEMS),
    sessionMetadata: SessionMetadataSchema.default({}),
});
export type PlatformFeedPayload = z.infer<typeof PlatformFeedPayloadSchema>;

export const FeedSnapshotEnvelopeSchema = z.object({
    feed: z.array(CapturedFeedItemSchema).min(1).max(MAX_FEED_ITEMS),
    sessionMetadata: SessionMetadataSchema.default({}),
});
export type FeedSnapshotEnvelope = z.infer<typeof FeedSnapshotEnvelopeSchema>;

export const CreatorPlatformAccountSchema = z.object({
    id: z.string().uuid(),
    creatorId: z.string().uuid(),
    platform: SupportedPlatformSchema,
    platformAccountId: z.string().nullable().optional(),
    platformHandle: z.string().min(1),
    verified: z.boolean().optional(),
});
export type CreatorPlatformAccount = z.infer<typeof CreatorPlatformAccountSchema>;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function sanitizeString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeNullableString(value: unknown): string | null | undefined {
    if (value === null) return null;
    return sanitizeString(value);
}

function parseUrlLike(rawValue: string): URL | null {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0) {
        return null;
    }

    try {
        return new URL(trimmed);
    } catch {
        try {
            if (trimmed.startsWith('//')) {
                return new URL(`https:${trimmed}`);
            }
            if (trimmed.startsWith('/')) {
                return new URL(trimmed, 'https://placeholder.local');
            }
        } catch {
            return null;
        }
    }

    return null;
}

function looksLikeUrlOrPath(value: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
        || value.startsWith('//')
        || value.startsWith('/')
        || value.includes('/watch?')
        || value.includes('/video/')
        || value.includes('/status/')
        || value.includes('/comments/');
}

function extractVideoIdFromText(rawValue: string): string | undefined {
    const parsed = parseUrlLike(rawValue);
    if (parsed) {
        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname;

        const youtubeId = parsed.searchParams.get('v');
        if (youtubeId) {
            return sanitizeString(youtubeId);
        }

        if (hostname.includes('youtu.be')) {
            const shortId = sanitizeString(pathname.replace(/^\/+/, '').split('/')[0]);
            if (shortId) {
                return shortId;
            }
        }

        const shortsId = pathname.match(/\/shorts\/([A-Za-z0-9_-]{3,64})/i)?.[1];
        if (shortsId) {
            return shortsId;
        }

        const instagramStoryId = pathname.match(/\/stories\/[^/]+\/(\d+)/i)?.[1];
        if (instagramStoryId) {
            return instagramStoryId;
        }

        const instagramId = pathname.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{3,64})/i)?.[1];
        if (instagramId) {
            return instagramId;
        }

        const tiktokId = pathname.match(/\/video\/([0-9]{5,32})/i)?.[1];
        if (tiktokId) {
            return tiktokId;
        }

        const twitterId = pathname.match(/\/status\/([0-9]{5,32})/i)?.[1];
        if (twitterId) {
            return twitterId;
        }

        const redditId = pathname.match(/\/comments\/([A-Za-z0-9]{1,10})/)?.[1];
        if (redditId) {
            return redditId;
        }

        if (
            hostname.includes('youtube.com')
            || hostname.includes('instagram.com')
            || hostname.includes('tiktok.com')
            || hostname.includes('twitter.com')
            || hostname.includes('x.com')
            || hostname.includes('reddit.com')
        ) {
            const lastSegment = sanitizeString(pathname.split('/').filter(Boolean).pop());
            if (lastSegment) {
                return lastSegment;
            }
        }
    }

    const inlineYouTube = rawValue.match(/[?&]v=([A-Za-z0-9_-]{3,64})/i)?.[1];
    if (inlineYouTube) {
        return inlineYouTube;
    }

    const inlineShorts = rawValue.match(/\/shorts\/([A-Za-z0-9_-]{3,64})/i)?.[1];
    if (inlineShorts) {
        return inlineShorts;
    }

    const inlineInstagramStory = rawValue.match(/\/stories\/[^/]+\/(\d+)/i)?.[1];
    if (inlineInstagramStory) {
        return inlineInstagramStory;
    }

    const inlineInstagram = rawValue.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{3,64})/i)?.[1];
    if (inlineInstagram) {
        return inlineInstagram;
    }

    const inlineTikTok = rawValue.match(/\/video\/([0-9]{5,32})/i)?.[1];
    if (inlineTikTok) {
        return inlineTikTok;
    }

    const inlineTwitter = rawValue.match(/\/status\/([0-9]{5,32})/i)?.[1];
    if (inlineTwitter) {
        return inlineTwitter;
    }

    const inlineReddit = rawValue.match(/\/comments\/([A-Za-z0-9]{1,10})/)?.[1];
    if (inlineReddit) {
        return inlineReddit;
    }

    return undefined;
}

export function normalizeRedditPostId(raw: unknown): string | null {
    const value = sanitizeString(raw);
    if (!value) {
        return null;
    }

    const urlMatch = value.match(/\/comments\/([A-Za-z0-9]{1,10})/);
    if (urlMatch?.[1]) {
        return urlMatch[1];
    }

    const withoutFullname = value.startsWith('t3_') ? value.slice(3) : value;
    return /^[A-Za-z0-9]{1,10}$/.test(withoutFullname) ? withoutFullname : null;
}

export function normalizeSubredditName(raw: unknown): string | null {
    const value = sanitizeString(raw);
    if (!value) {
        return null;
    }

    const normalized = value.replace(/^\/?r\//i, '');
    return /^[A-Za-z0-9_]{2,21}$/.test(normalized) ? normalized : null;
}

function normalizeVideoId(value: unknown, allowRawFallback = true): string | undefined {
    const rawValue = sanitizeString(value);
    if (!rawValue) {
        return undefined;
    }

    const extracted = extractVideoIdFromText(rawValue);
    if (extracted) {
        return extracted;
    }

    if (!allowRawFallback && looksLikeUrlOrPath(rawValue)) {
        return undefined;
    }

    return rawValue;
}

const ITEM_VIDEO_ID_KEYS = [
    ['videoId', true],
    ['id', true],
    ['postId', true],
    ['mediaId', true],
    ['tweetId', true],
    ['url', false],
    ['permalink', false],
    ['href', false],
    ['shareUrl', false],
    ['link', false],
] as const;

const STRICT_METRIC_STRING_REGEX = /^(\d{1,15}(?:\.\d{1,6})?)([kmb])?$/i;
const NUMERIC_STRING_FIELD_KEYS = new Set([
    'position',
    'positionInFeed',
    'watchDuration',
    'watchTime',
    'impressionDuration',
    'likes',
    'likesCount',
    'likeCount',
    'comments',
    'commentsCount',
    'commentCount',
    'shares',
    'sharesCount',
    'shareCount',
    'saves',
    'savesCount',
    'views',
    'viewCount',
    'recommendationCount',
    'loopCount',
    'seekCount',
]);

function pickVideoId(source: Record<string, unknown>): string | undefined {
    for (const [key, allowRawFallback] of ITEM_VIDEO_ID_KEYS) {
        const videoId = normalizeVideoId(source[key], allowRawFallback);
        if (videoId) {
            return videoId;
        }
    }

    return undefined;
}

function parseMetricString(value: string): number | undefined {
    const normalized = value.trim().replace(/,/g, '');
    if (normalized.length === 0) {
        return undefined;
    }

    const match = normalized.match(STRICT_METRIC_STRING_REGEX);
    if (!match) {
        return undefined;
    }

    const suffix = (match[2] ?? '').toLowerCase();
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
    const numeric = match[1];
    const parsed = Number.parseFloat(numeric);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return undefined;
    }

    return parsed * multiplier;
}

function toNonNegativeNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
    }

    if (typeof value === 'string') {
        return parseMetricString(value);
    }

    return undefined;
}

function toNonNegativeInt(value: unknown): number | undefined {
    const parsed = toNonNegativeNumber(value);
    if (parsed === undefined) {
        return undefined;
    }
    return Math.max(0, Math.round(parsed));
}

function toBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') {
            return true;
        }
        if (normalized === 'false' || normalized === '0') {
            return false;
        }
    }
    return undefined;
}

function normalizeStringArray(value: unknown, maxItems: number): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const values = value
        .map((entry) => sanitizeString(entry))
        .filter((entry): entry is string => Boolean(entry));
    if (values.length === 0) {
        return undefined;
    }

    return Array.from(new Set(values)).slice(0, maxItems);
}

function hasInvalidMetricStringField(source: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(source)) {
        if (!NUMERIC_STRING_FIELD_KEYS.has(key) || typeof value !== 'string') {
            continue;
        }

        const normalized = value.trim().replace(/,/g, '');
        if (normalized.length === 0) {
            continue;
        }

        if (!STRICT_METRIC_STRING_REGEX.test(normalized)) {
            return true;
        }
    }

    return false;
}

function hasInvalidMetricStrings(item: Record<string, unknown>): boolean {
    if (hasInvalidMetricStringField(item)) {
        return true;
    }

    const engagementMetrics = asRecord(item.engagementMetrics);
    if (engagementMetrics && hasInvalidMetricStringField(engagementMetrics)) {
        return true;
    }

    const recommendations = Array.isArray(item.recommendations)
        ? item.recommendations
        : Array.isArray(engagementMetrics?.recommendations)
            ? engagementMetrics.recommendations
            : [];

    for (const recommendation of recommendations) {
        const row = asRecord(recommendation);
        if (row && hasInvalidMetricStringField(row)) {
            return true;
        }
    }

    return false;
}

function normalizeRecommendationRows(rows: unknown): RecommendationRow[] | undefined {
    if (!Array.isArray(rows)) {
        return undefined;
    }

    const normalizedRows: RecommendationRow[] = [];

    for (let index = 0; index < rows.length && normalizedRows.length < 40; index += 1) {
        const row = asRecord(rows[index]);
        if (!row) continue;

        const videoId = pickVideoId(row);
        if (!videoId) continue;

        const normalized: RecommendationRow = { videoId };

        const position = toNonNegativeInt(row.position);
        if (position !== undefined) {
            normalized.position = Math.max(1, position);
        }

        const title = sanitizeNullableString(row.title);
        if (title !== undefined) {
            normalized.title = title;
        }

        const channel = sanitizeNullableString(row.channel ?? row.author ?? row.username);
        if (channel !== undefined) {
            normalized.channel = channel;
        }

        const surface = sanitizeNullableString(row.surface ?? row.source ?? row.placement);
        if (surface !== undefined) {
            normalized.surface = surface;
        }

        const surfaces = normalizeStringArray(row.surfaces, 8);
        if (surfaces && surfaces.length > 0) {
            normalized.surfaces = surfaces;
        }

        const parsed = RecommendationRowSchema.safeParse(normalized);
        if (parsed.success) {
            normalizedRows.push(parsed.data);
        }
    }

    return normalizedRows.length > 0 ? normalizedRows : undefined;
}

const METRIC_PASSTHROUGH_KEYS = [
    'seekCount',
    'adEvents',
    'completed',
    'uploadDate',
    'loopCount',
    'isSponsored',
    'type',
    'timestamp',
    'analytics',
    'recommendationSurfaceCounts',
] as const;

function normalizeEngagementMetrics(
    engagement: unknown,
    sourceItem: Record<string, unknown>,
    recommendations: RecommendationRow[] | undefined
): FeedEngagement | undefined {
    const base = asRecord(engagement) ?? {};
    const normalizedMetrics: Record<string, unknown> = {
        ...base,
    };

    const likes = toNonNegativeNumber(
        base.likes ?? base.likesCount ?? sourceItem.likes ?? sourceItem.likeCount ?? sourceItem.likesCount
    );
    if (likes !== undefined) normalizedMetrics.likes = likes;

    const comments = toNonNegativeNumber(
        base.comments ?? base.commentsCount ?? sourceItem.comments ?? sourceItem.commentCount ?? sourceItem.commentsCount
    );
    if (comments !== undefined) normalizedMetrics.comments = comments;

    const shares = toNonNegativeNumber(
        base.shares ?? base.sharesCount ?? sourceItem.shares ?? sourceItem.shareCount ?? sourceItem.sharesCount
    );
    if (shares !== undefined) normalizedMetrics.shares = shares;

    const views = toNonNegativeNumber(base.views ?? sourceItem.views ?? sourceItem.viewCount);
    if (views !== undefined) normalizedMetrics.views = views;

    const watchTime = toNonNegativeNumber(base.watchTime ?? sourceItem.watchTime ?? sourceItem.watchedSeconds);
    if (watchTime !== undefined) normalizedMetrics.watchTime = watchTime;

    const impressionDuration = toNonNegativeNumber(base.impressionDuration ?? sourceItem.impressionDuration);
    if (impressionDuration !== undefined) normalizedMetrics.impressionDuration = impressionDuration;

    const normalizedRecommendations = recommendations ?? normalizeRecommendationRows(base.recommendations ?? sourceItem.recommendations);
    if (normalizedRecommendations && normalizedRecommendations.length > 0) {
        normalizedMetrics.recommendations = normalizedRecommendations;
        normalizedMetrics.recommendationCount = toNonNegativeInt(base.recommendationCount) ?? normalizedRecommendations.length;
    } else {
        const recommendationCount = toNonNegativeInt(base.recommendationCount);
        if (recommendationCount !== undefined) {
            normalizedMetrics.recommendationCount = recommendationCount;
        }
    }

    for (const key of METRIC_PASSTHROUGH_KEYS) {
        if (normalizedMetrics[key] === undefined && sourceItem[key] !== undefined) {
            normalizedMetrics[key] = sourceItem[key];
        }
    }

    if (Object.keys(normalizedMetrics).length === 0) {
        return undefined;
    }

    const parsed = FeedEngagementSchema.safeParse(normalizedMetrics);
    return parsed.success ? parsed.data : undefined;
}

export function coerceCapturedFeedItem(rawItem: unknown, index = 0): CapturedFeedItem | null {
    const item = asRecord(rawItem);
    if (!item) {
        return null;
    }
    if (hasInvalidMetricStrings(item)) {
        return null;
    }

    const videoId = pickVideoId(item);
    if (!videoId) {
        return null;
    }

    const recommendations = normalizeRecommendationRows(item.recommendations);
    const engagementMetrics = normalizeEngagementMetrics(item.engagementMetrics, item, recommendations);
    const normalized: Record<string, unknown> = { videoId };

    const creatorHandle = sanitizeNullableString(
        item.creatorHandle ?? item.authorHandle ?? item.channelHandle ?? item.author ?? item.channel ?? item.username
    );
    if (creatorHandle !== undefined) {
        normalized.creatorHandle = creatorHandle;
    }

    const creatorId = sanitizeNullableString(
        item.creatorId ?? item.authorId ?? item.channelId ?? item.platformAccountId ?? item.author ?? item.channelName ?? item.username
    );
    if (creatorId !== undefined) {
        normalized.creatorId = creatorId;
    }

    const caption = sanitizeNullableString(item.caption ?? item.title ?? item.text);
    if (caption !== undefined) {
        normalized.caption = caption;
    }

    const positionInFeed = toNonNegativeInt(item.positionInFeed ?? item.position ?? index);
    if (positionInFeed !== undefined) {
        normalized.positionInFeed = positionInFeed;
        normalized.position = positionInFeed;
    }

    const musicTitle = sanitizeNullableString(item.musicTitle);
    if (musicTitle !== undefined) {
        normalized.musicTitle = musicTitle;
    }

    const watchDuration = toNonNegativeNumber(
        item.watchDuration
        ?? item.watchTime
        ?? item.impressionDuration
        ?? engagementMetrics?.watchTime
        ?? engagementMetrics?.impressionDuration
    );
    if (watchDuration !== undefined) {
        normalized.watchDuration = watchDuration;
    }

    const interacted = toBoolean(item.interacted ?? item.hasInteracted);
    if (interacted !== undefined) {
        normalized.interacted = interacted;
    }

    const interactionType = sanitizeNullableString(item.interactionType);
    if (interactionType !== undefined) {
        normalized.interactionType = interactionType;
    }

    const contentTags = normalizeStringArray(item.contentTags ?? item.tags, 20);
    if (contentTags !== undefined) {
        normalized.contentTags = contentTags;
    }

    const contentCategories = normalizeStringArray(item.contentCategories, 20);
    if (contentCategories !== undefined) {
        normalized.contentCategories = contentCategories;
    }

    if (engagementMetrics) {
        normalized.engagementMetrics = engagementMetrics;
    }

    const likesCount = toNonNegativeNumber(item.likesCount ?? item.likes ?? item.likeCount ?? engagementMetrics?.likes);
    if (likesCount !== undefined) {
        normalized.likesCount = likesCount;
    } else if (item.likesCount === null) {
        normalized.likesCount = null;
    }

    const commentsCount = toNonNegativeNumber(
        item.commentsCount ?? item.comments ?? item.commentCount ?? engagementMetrics?.comments
    );
    if (commentsCount !== undefined) {
        normalized.commentsCount = commentsCount;
    } else if (item.commentsCount === null) {
        normalized.commentsCount = null;
    }

    const sharesCount = toNonNegativeNumber(item.sharesCount ?? item.shares ?? item.shareCount ?? engagementMetrics?.shares);
    if (sharesCount !== undefined) {
        normalized.sharesCount = sharesCount;
    } else if (item.sharesCount === null) {
        normalized.sharesCount = null;
    }

    const savesCount = toNonNegativeNumber(item.savesCount ?? item.saves);
    if (savesCount !== undefined) {
        normalized.savesCount = savesCount;
    } else if (item.savesCount === null) {
        normalized.savesCount = null;
    }

    if (recommendations && recommendations.length > 0) {
        normalized.recommendations = recommendations;
    }

    const parsed = CapturedFeedItemSchema.safeParse(normalized);
    return parsed.success ? parsed.data : null;
}

function coerceRedditCapturedFeedItem(rawItem: unknown, index = 0): CapturedFeedItem | null {
    const item = asRecord(rawItem);
    if (!item) {
        return null;
    }
    if (hasInvalidMetricStrings(item)) {
        return null;
    }

    const videoId = normalizeRedditPostId(item.videoId ?? item.postId ?? item.id ?? item.url);
    if (!videoId) {
        return null;
    }

    const subreddit = normalizeSubredditName(item.creatorHandle ?? item.subreddit);
    if (!subreddit) {
        return null;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
        normalized[key] = value;
    }

    normalized.videoId = videoId;
    normalized.creatorHandle = subreddit;
    normalized.subreddit = subreddit;

    const caption = sanitizeNullableString(item.caption ?? item.title);
    if (caption !== undefined) {
        normalized.caption = caption === null ? null : caption.slice(0, 500);
    }

    const positionInFeed = toNonNegativeInt(item.positionInFeed ?? item.position ?? index);
    if (positionInFeed !== undefined) {
        normalized.positionInFeed = positionInFeed;
        normalized.position = positionInFeed;
    }

    normalized.watchDuration = toNonNegativeNumber(item.watchDuration ?? item.watchTime) ?? 0;

    const interacted = toBoolean(item.interacted ?? item.hasInteracted);
    if (interacted !== undefined) {
        normalized.interacted = interacted;
    }

    const interactionType = sanitizeNullableString(item.interactionType);
    if (interactionType !== undefined) {
        normalized.interactionType = interactionType;
    }

    const likesCount = toNonNegativeInt(item.likesCount ?? item.score ?? item.upvotes);
    if (likesCount !== undefined) {
        normalized.likesCount = likesCount;
    } else if (item.likesCount === null || item.score === null || item.upvotes === null) {
        normalized.likesCount = null;
    }

    const commentsCount = toNonNegativeInt(item.commentsCount ?? item.comments ?? item.numComments);
    if (commentsCount !== undefined) {
        normalized.commentsCount = commentsCount;
    } else if (item.commentsCount === null || item.comments === null || item.numComments === null) {
        normalized.commentsCount = null;
    }

    const contentCategories = normalizeStringArray(item.contentCategories, 20);
    if (contentCategories !== undefined) {
        normalized.contentCategories = contentCategories;
    }

    const parsed = CapturedFeedItemSchema.safeParse(normalized);
    return parsed.success ? parsed.data : null;
}

export interface CoerceSessionMetadataOptions {
    defaultIngestVersion?: string;
    defaultObserverVersion?: string;
}

const KNOWN_SESSION_METADATA_KEYS = new Set([
    'type',
    'captureSurface',
    'clientSessionId',
    'observerVersion',
    'ingestVersion',
    'uploadEvent',
    'capturedAt',
    'sessionId',
    'sessionKey',
]);

export function coerceSessionMetadata(
    input: unknown,
    options: CoerceSessionMetadataOptions = {}
): SessionMetadata {
    const source = asRecord(input) ?? {};
    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(source)) {
        if (!KNOWN_SESSION_METADATA_KEYS.has(key)) {
            normalized[key] = value;
        }
    }

    const type = sanitizeString(source.type);
    if (type !== undefined) normalized.type = type;

    const captureSurface = sanitizeString(source.captureSurface);
    if (captureSurface !== undefined) normalized.captureSurface = captureSurface;

    const clientSessionId = sanitizeNullableString(source.clientSessionId ?? source.sessionId ?? source.sessionKey);
    if (clientSessionId !== undefined) normalized.clientSessionId = clientSessionId;

    const observerVersion = sanitizeString(source.observerVersion) ?? sanitizeString(options.defaultObserverVersion);
    if (observerVersion !== undefined) normalized.observerVersion = observerVersion;

    const ingestVersion =
        sanitizeString(source.ingestVersion)
        ?? sanitizeString(options.defaultIngestVersion)
        ?? CURRENT_INGEST_VERSION;
    normalized.ingestVersion = ingestVersion;

    const uploadEvent = sanitizeString(source.uploadEvent);
    if (uploadEvent !== undefined) normalized.uploadEvent = uploadEvent;

    const capturedAt = sanitizeString(source.capturedAt);
    if (capturedAt !== undefined) normalized.capturedAt = capturedAt;

    const parsed = SessionMetadataSchema.safeParse(normalized);
    if (parsed.success) {
        return parsed.data;
    }

    return { ingestVersion };
}

function parsePlatform(value: unknown): SupportedPlatform | null {
    const raw = sanitizeString(value)?.toLowerCase();
    if (!raw) return null;

    const parsed = SupportedPlatformSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

function defaultObserverVersionFor(platform: SupportedPlatform): string | undefined {
    return CURRENT_OBSERVER_VERSIONS[platform];
}

function pickRawFeed(source: Record<string, unknown>): unknown[] | null {
    const feed = Array.isArray(source.feed) ? source.feed : null;
    const items = Array.isArray(source.items) ? source.items : null;

    if (feed && feed.length > 0) {
        return feed;
    }
    if (items && items.length > 0) {
        return items;
    }
    if (feed) {
        return feed;
    }
    if (items) {
        return items;
    }

    return null;
}

export function getFeedItemLimitError(rawPayload: unknown): string | null {
    const payload = asRecord(rawPayload);
    if (!payload) {
        return null;
    }

    const rawFeed = pickRawFeed(payload);
    if (!rawFeed || rawFeed.length <= MAX_FEED_ITEMS) {
        return null;
    }

    return FEED_ITEM_LIMIT_ERROR_MESSAGE;
}

export interface CoercePlatformFeedPayloadOptions {
    expectedPlatform?: SupportedPlatform;
    defaultPlatform?: SupportedPlatform;
    defaultIngestVersion?: string;
    defaultObserverVersion?: string;
    requireFullFeedValidity?: boolean;
}

export function coercePlatformFeedPayload(
    rawPayload: unknown,
    options: CoercePlatformFeedPayloadOptions = {}
): PlatformFeedPayload | null {
    const payload = asRecord(rawPayload);
    if (!payload) {
        return null;
    }

    const platform = options.expectedPlatform
        ?? parsePlatform(payload.platform)
        ?? options.defaultPlatform
        ?? null;
    if (!platform) {
        return null;
    }

    const rawFeed = pickRawFeed(payload);
    if (!rawFeed || rawFeed.length === 0) {
        return null;
    }

    const feed = rawFeed
        .map((item, index) => (
            platform === 'reddit'
                ? coerceRedditCapturedFeedItem(item, index)
                : coerceCapturedFeedItem(item, index)
        ))
        .filter((item): item is CapturedFeedItem => Boolean(item));
    if (feed.length === 0) {
        return null;
    }
    if (options.requireFullFeedValidity && feed.length !== rawFeed.length) {
        return null;
    }

    const sessionMetadata = coerceSessionMetadata(payload.sessionMetadata, {
        defaultIngestVersion: options.defaultIngestVersion,
        defaultObserverVersion: options.defaultObserverVersion ?? defaultObserverVersionFor(platform),
    });

    const parsed = PlatformFeedPayloadSchema.safeParse({
        platform,
        feed,
        sessionMetadata,
    });
    return parsed.success ? parsed.data : null;
}

export interface CoerceFeedSnapshotEnvelopeOptions {
    defaultIngestVersion?: string;
    defaultObserverVersion?: string;
    requireFullFeedValidity?: boolean;
}

export function coerceFeedSnapshotEnvelope(
    rawEnvelope: unknown,
    options: CoerceFeedSnapshotEnvelopeOptions = {}
): FeedSnapshotEnvelope | null {
    const envelope = asRecord(rawEnvelope);
    if (!envelope) {
        return null;
    }

    const rawFeed = pickRawFeed(envelope);
    if (!rawFeed || rawFeed.length === 0) {
        return null;
    }

    const feed = rawFeed
        .map((item, index) => coerceCapturedFeedItem(item, index))
        .filter((item): item is CapturedFeedItem => Boolean(item));
    if (feed.length === 0) {
        return null;
    }
    if (options.requireFullFeedValidity && feed.length !== rawFeed.length) {
        return null;
    }

    const sessionMetadata = coerceSessionMetadata(envelope.sessionMetadata, options);

    const parsed = FeedSnapshotEnvelopeSchema.safeParse({
        feed,
        sessionMetadata,
    });
    return parsed.success ? parsed.data : null;
}
