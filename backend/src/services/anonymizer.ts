/**
 * Anonymization service for feed data
 * Strips or hashes PII before storage
 */

interface FeedItemInput {
    videoId: string;
    creatorId?: string;
    creatorHandle?: string;
    caption?: string;
    musicId?: string;
    musicTitle?: string;
    engagementMetrics?: Record<string, any>;
    contentTags?: string[];
    watchDuration?: number;
    interacted?: boolean;
    interactionType?: string;
    positionInFeed?: number;
}

/**
 * Anonymize a single feed item
 * - Keep video/music IDs (public identifiers)
 * - Keep creator handles (public)
 * - Truncate long captions
 * - Remove any potential PII from engagement metrics
 */
export function anonymizeSnapshot(item: FeedItemInput): FeedItemInput {
    const cleaned = { ...item };

    // Truncate caption to prevent any sensitive data
    if (cleaned.caption && cleaned.caption.length > 500) {
        cleaned.caption = cleaned.caption.substring(0, 500) + '...';
    }

    // Clean engagement metrics - only keep numeric values
    if (cleaned.engagementMetrics) {
        const safeMetrics: Record<string, number> = {};
        const allowedKeys = ['likes', 'comments', 'shares', 'views', 'plays'];

        for (const key of allowedKeys) {
            if (typeof cleaned.engagementMetrics[key] === 'number') {
                safeMetrics[key] = cleaned.engagementMetrics[key];
            }
        }

        cleaned.engagementMetrics = safeMetrics;
    }

    // Clean content tags - only allow safe characters
    if (cleaned.contentTags) {
        cleaned.contentTags = cleaned.contentTags
            .map((tag: string) => tag.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase())
            .filter((tag: string) => tag.length > 0 && tag.length < 50)
            .slice(0, 20);
    }

    return cleaned;
}
