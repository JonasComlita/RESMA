/**
 * RESMA - Twitter (X) Feed Observer
 * Captures timeline tweets, impressions, and ad exposure.
 */
import { CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS } from '@resma/shared';

interface TwitterTweet {
    id: string; // Internal ID or extracted ID (status URL part)
    authorHandle: string | null;
    authorName: string | null;
    text: string | null;
    timestamp: number;

    // Telemetry
    impressionStartTime: number;
    impressionDuration: number;
    isPromoted: boolean;

    // Interaction
    hasInteracted: boolean;
    interactionType: string | null;
    lastUploadedImpressionDuration: number;
    lastUploadedInteractionType: string | null;
}

class TwitterObserver {
    private observedTweets = new Set<Element>();
    private sessionTweets: Map<string, TwitterTweet> = new Map();
    private intersectionObserver: IntersectionObserver;
    private batchTimer: number | null = null;
    private clientSessionId = `tw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    constructor() {
        console.log('[RESMA] Twitter Observer initialized');

        // Setup Intersection Observer for impressions
        this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), {
            threshold: 0.6 // Tweet considered "viewed" if 60% visible
        });

        this.init();
    }

    private init() {
        // Watch for new tweets loaded into DOM
        const timeline = document.querySelector('div[data-testid="primaryColumn"]') || document.body;

        const mutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    if (node instanceof Element) {
                        this.processNode(node);
                    }
                });
            }
        });

        mutationObserver.observe(timeline, { childList: true, subtree: true });

        // Process initial Load
        this.scanForTweets();

        // Setup periodic batch upload
        setInterval(() => this.sendBatch(), 10000); // Every 10 seconds
    }

    private sanitizeString(value: string | null | undefined): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    private shortenText(value: string | null | undefined, maxLength = 80): string {
        if (!value) return '';
        return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    }

    private hashString(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return Math.abs(hash >>> 0).toString(36);
    }

    private buildSyntheticTweetId(element: Element): string | null {
        const authorHandle = this.sanitizeString(
            element.querySelector('div[data-testid="User-Name"] a')?.getAttribute('href')?.replace('/', '')
        );
        const text = this.sanitizeString(element.querySelector('div[data-testid="tweetText"]')?.textContent);
        const detail = this.sanitizeString(
            element.querySelector('a[role="link"][href]')?.getAttribute('href')
            ?? element.querySelector('div[lang]')?.textContent
        );
        const position = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).indexOf(element as HTMLElement);
        const fingerprint = [
            this.getCaptureSurface(),
            authorHandle ?? 'unknown-author',
            this.shortenText(text, 120) || this.shortenText(detail, 120) || 'no-text',
            String(position),
        ].join('|');

        return `synthetic-${this.hashString(fingerprint)}`;
    }

    private scanForTweets() {
        // Look for tweets
        const elements = document.querySelectorAll('article[data-testid="tweet"]');
        elements.forEach(el => this.observeTweet(el));
    }

    private processNode(node: Element) {
        // Check if node itself is tweet or contains tweets
        if (node.matches && node.matches('article[data-testid="tweet"]')) {
            this.observeTweet(node);
        } else {
            const tweets = node.querySelectorAll?.('article[data-testid="tweet"]');
            tweets?.forEach(el => this.observeTweet(el));
        }
    }

    private observeTweet(element: Element) {
        if (this.observedTweets.has(element)) return;

        this.observedTweets.add(element);
        this.intersectionObserver.observe(element);

        // Attach click listeners for interaction
        const likeBtn = element.querySelector('[data-testid="like"]');
        likeBtn?.addEventListener('click', () => this.recordInteraction(element, 'like'));

        const retweetBtn = element.querySelector('[data-testid="retweet"]');
        retweetBtn?.addEventListener('click', () => this.recordInteraction(element, 'retweet'));

        const replyBtn = element.querySelector('[data-testid="reply"]');
        replyBtn?.addEventListener('click', () => this.recordInteraction(element, 'reply'));
    }

    private handleIntersection(entries: IntersectionObserverEntry[]) {
        entries.forEach(entry => {
            const element = entry.target;
            const tweetId = this.getTweetId(element);

            if (!tweetId) return;

            if (entry.isIntersecting) {
                // START IMPRESSION
                if (!this.sessionTweets.has(tweetId)) {
                    // Initialize tweet data
                    const data = this.scrapeTweetData(element, tweetId);
                    if (data) this.sessionTweets.set(tweetId, data);
                }

                const tweet = this.sessionTweets.get(tweetId);
                if (tweet) {
                    tweet.impressionStartTime = Date.now();
                }

            } else {
                // END IMPRESSION
                const tweet = this.sessionTweets.get(tweetId);
                if (tweet && tweet.impressionStartTime > 0) {
                    const duration = (Date.now() - tweet.impressionStartTime) / 1000;
                    tweet.impressionDuration += duration;
                    tweet.impressionStartTime = 0; // Reset active timer
                }
            }
        });
    }

    private recordInteraction(element: Element, type: string) {
        const tweetId = this.getTweetId(element);
        if (tweetId && this.sessionTweets.has(tweetId)) {
            const tweet = this.sessionTweets.get(tweetId)!;
            tweet.hasInteracted = true;
            tweet.interactionType = type;
            console.log(`[RESMA] Interaction: ${type} on ${tweetId}`);
        }
    }

    private scrapeTweetData(element: Element, tweetId: string): TwitterTweet | null {
        try {
            const userLink = element.querySelector('div[data-testid="User-Name"] a');
            const authorHandle = userLink?.getAttribute('href')?.replace('/', '') || null;
            const authorName = userLink?.textContent?.split('@')[0] || null;

            const textEl = element.querySelector('div[data-testid="tweetText"]');
            const text = textEl?.textContent || null;

            // Ad detection
            // "Ad" marker is often a span with text "Ad" or specific SVG. 
            // Better heuristic: look for "Promoted" or lack of timestamp link to status
            const timeEl = element.querySelector('time');
            const isPromoted = !timeEl && !!element.querySelector('svg'); // Rough heuristic, refine later

            return {
                id: tweetId,
                authorHandle,
                authorName,
                text,
                timestamp: Date.now(),
                impressionStartTime: Date.now(),
                impressionDuration: 0,
                isPromoted,
                hasInteracted: false,
                interactionType: null,
                lastUploadedImpressionDuration: 0,
                lastUploadedInteractionType: null,
            };
        } catch (e) {
            return null;
        }
    }

    private getTweetId(element: Element): string | null {
        // Try to get status URL
        const link = element.querySelector('a[href*="/status/"]');
        if (link) {
            return link.getAttribute('href')?.split('/status/')[1]?.split('?')[0] || null;
        }
        // Fallback for promoted/system tweets that do not expose a canonical status URL.
        return this.buildSyntheticTweetId(element);
    }

    private sendBatch() {
        const pendingUploads: Array<{
            tweet: TwitterTweet;
            nextUploadedImpressionDuration: number;
            nextUploadedInteractionType: string | null;
            payload: {
                videoId: string;
                creatorHandle: string | null;
                creatorId: string | null;
                caption: string | null;
                position: number;
                interacted: boolean;
                interactionType: string | null;
                contentCategories?: string[];
                engagementMetrics: {
                    impressionDuration: number;
                    isPromoted: boolean;
                    timestamp: number;
                };
            };
        }> = [];

        // Find tweets that have accrued view time or interactions
        for (const [, tweet] of this.sessionTweets.entries()) {
            // Update active impression if still viewing
            if (tweet.impressionStartTime > 0) {
                const currentDuration = (Date.now() - tweet.impressionStartTime) / 1000;
                tweet.impressionDuration += currentDuration;
                tweet.impressionStartTime = Date.now(); // Checkpoint
            }

            const unsentImpressionDuration = Math.max(0, tweet.impressionDuration - tweet.lastUploadedImpressionDuration);
            const hasMeaningfulDurationDelta = unsentImpressionDuration > 1;
            const hasNewInteraction = Boolean(tweet.interactionType)
                && tweet.interactionType !== tweet.lastUploadedInteractionType;

            if (!hasMeaningfulDurationDelta && !hasNewInteraction) {
                continue;
            }

            pendingUploads.push({
                tweet,
                nextUploadedImpressionDuration: tweet.impressionDuration,
                nextUploadedInteractionType: hasNewInteraction ? tweet.interactionType : tweet.lastUploadedInteractionType,
                payload: {
                    videoId: tweet.id,
                    creatorHandle: tweet.authorHandle,
                    creatorId: tweet.authorHandle ?? tweet.authorName,
                    caption: tweet.text,
                    position: pendingUploads.length,
                    interacted: hasNewInteraction,
                    interactionType: hasNewInteraction ? tweet.interactionType : null,
                    contentCategories: tweet.isPromoted ? ['promoted'] : undefined,
                    engagementMetrics: {
                        impressionDuration: unsentImpressionDuration,
                        isPromoted: tweet.isPromoted,
                        timestamp: tweet.timestamp,
                    },
                },
            });
        }

        if (pendingUploads.length > 0) {
            console.log(`[RESMA] Sending batch of ${pendingUploads.length} tweets`);
            chrome.runtime.sendMessage({
                type: 'UPLOAD_PLATFORM_FEED',
                payload: {
                    platform: 'twitter',
                    feed: pendingUploads.map((entry) => entry.payload),
                    sessionMetadata: {
                        type: 'TIMELINE_BATCH',
                        captureSurface: this.getCaptureSurface(),
                        clientSessionId: this.clientSessionId,
                        observerVersion: CURRENT_OBSERVER_VERSIONS.twitter,
                        ingestVersion: CURRENT_INGEST_VERSION,
                        uploadEvent: 'TWITTER_FEED_SNAPSHOT',
                        capturedAt: new Date().toISOString(),
                    }
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[RESMA] Twitter upload callback failed:', chrome.runtime.lastError.message);
                    return;
                }

                if (!response?.success) {
                    console.warn('[RESMA] Twitter upload rejected by background pipeline');
                    return;
                }

                for (const entry of pendingUploads) {
                    entry.tweet.lastUploadedImpressionDuration = entry.nextUploadedImpressionDuration;
                    entry.tweet.lastUploadedInteractionType = entry.nextUploadedInteractionType;
                }
            });
        }
    }

    private getCaptureSurface(): string {
        if (location.pathname.startsWith('/following')) {
            return 'following-timeline';
        }

        if (location.pathname.startsWith('/search')) {
            return 'search-timeline';
        }

        if (location.pathname.includes('/status/')) {
            return 'tweet-detail';
        }

        return 'home-timeline';
    }
}

new TwitterObserver();
