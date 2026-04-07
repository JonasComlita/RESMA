import { z } from 'zod';

export const SupportedPlatformSchema = z.enum(['youtube', 'instagram', 'tiktok', 'twitter']);
export type SupportedPlatform = z.infer<typeof SupportedPlatformSchema>;

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
    feed: z.array(CapturedFeedItemSchema).min(1),
    sessionMetadata: SessionMetadataSchema.default({}),
});
export type PlatformFeedPayload = z.infer<typeof PlatformFeedPayloadSchema>;

export const FeedSnapshotEnvelopeSchema = z.object({
    feed: z.array(CapturedFeedItemSchema).min(1),
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
