/**
 * RESMA - Twitter (X) Feed Observer
 * Captures timeline tweets, impressions, and ad exposure.
 */
import { CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS } from '@resma/shared';

interface TwitterTweet {
    id: string;
    syntheticId: boolean;
    authorHandle: string | null;
    authorName: string | null;
    text: string | null;
    timestamp: number;
    impressionStartTime: number;
    impressionDuration: number;
    isPromoted: boolean;
    replyToHandle: string | null;
    replyToStatusId: string | null;
    quotedStatusId: string | null;
    contentCategories?: string[];
    hasInteracted: boolean;
    interactionType: string | null;
    lastUploadedImpressionDuration: number;
    lastUploadedInteractionType: string | null;
}

interface TweetIdResult {
    id: string;
    syntheticId: boolean;
}

class TwitterObserver {
    private observedTweets = new Set<Element>();
    private sessionTweets: Map<string, TwitterTweet> = new Map();
    private intersectionObserver: IntersectionObserver;
    private mutationObserver: MutationObserver | null = null;
    private batchTimer: number | null = null;
    private clientSessionId = `tw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    private isCapturing = false;

    constructor() {
        console.log('[RESMA] Twitter Observer initialized');
        this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), {
            threshold: 0.6,
        });
        this.setupMessageListener();
    }

    private setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'GET_STATUS') {
                sendResponse({
                    isCapturing: this.isCapturing,
                    itemCount: this.sessionTweets.size,
                });
                return true;
            }

            if (message.type === 'START_CAPTURE') {
                this.startCapture();
                sendResponse({ success: true, data: { itemCount: this.sessionTweets.size } });
                return true;
            }

            if (message.type === 'STOP_CAPTURE') {
                sendResponse({ success: true, data: { itemCount: this.stopCapture() } });
                return true;
            }

            return false;
        });
    }

    private init() {
        const timeline = document.querySelector('div[data-testid="primaryColumn"]') || document.body;

        this.mutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof Element) {
                        this.processNode(node);
                    }
                });
            }
        });

        this.mutationObserver.observe(timeline, { childList: true, subtree: true });

        this.scanForTweets();
        this.batchTimer = window.setInterval(() => this.sendBatch(), 10000);
    }

    private startCapture() {
        if (this.isCapturing) {
            return;
        }

        this.isCapturing = true;
        this.clientSessionId = `tw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        this.observedTweets.clear();
        this.sessionTweets.clear();
        this.intersectionObserver.disconnect();
        this.init();
    }

    private stopCapture() {
        if (!this.isCapturing) {
            return this.sessionTweets.size;
        }

        this.sendBatch();
        this.isCapturing = false;

        if (this.batchTimer !== null) {
            window.clearInterval(this.batchTimer);
            this.batchTimer = null;
        }

        this.mutationObserver?.disconnect();
        this.mutationObserver = null;
        this.intersectionObserver.disconnect();

        return this.sessionTweets.size;
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
        const elements = document.querySelectorAll('article[data-testid="tweet"]');
        elements.forEach((el) => this.observeTweet(el));
    }

    private processNode(node: Element) {
        if (node.matches && node.matches('article[data-testid="tweet"]')) {
            this.observeTweet(node);
        } else {
            const tweets = node.querySelectorAll?.('article[data-testid="tweet"]');
            tweets?.forEach((el) => this.observeTweet(el));
        }
    }

    private observeTweet(element: Element) {
        if (this.observedTweets.has(element)) return;

        this.observedTweets.add(element);
        this.intersectionObserver.observe(element);

        element.querySelector('[data-testid="like"]')
            ?.addEventListener('click', () => this.recordInteraction(element, 'like'));
        element.querySelector('[data-testid="retweet"]')
            ?.addEventListener('click', () => this.recordInteraction(element, 'retweet'));
        element.querySelector('[data-testid="reply"]')
            ?.addEventListener('click', () => this.recordInteraction(element, 'reply'));
    }

    private handleIntersection(entries: IntersectionObserverEntry[]) {
        if (!this.isCapturing) {
            return;
        }

        entries.forEach((entry) => {
            const element = entry.target;
            const tweetIdResult = this.getTweetId(element);

            if (!tweetIdResult) return;
            const { id: tweetId } = tweetIdResult;

            if (entry.isIntersecting) {
                if (!this.sessionTweets.has(tweetId)) {
                    const data = this.scrapeTweetData(element, tweetIdResult);
                    if (data) this.sessionTweets.set(tweetId, data);
                }

                const tweet = this.sessionTweets.get(tweetId);
                if (tweet) {
                    tweet.impressionStartTime = Date.now();
                }
            } else {
                const tweet = this.sessionTweets.get(tweetId);
                if (tweet && tweet.impressionStartTime > 0) {
                    const duration = (Date.now() - tweet.impressionStartTime) / 1000;
                    tweet.impressionDuration += duration;
                    tweet.impressionStartTime = 0;
                }
            }
        });
    }

    private recordInteraction(element: Element, type: string) {
        if (!this.isCapturing) {
            return;
        }

        const tweetIdResult = this.getTweetId(element);
        if (tweetIdResult && this.sessionTweets.has(tweetIdResult.id)) {
            const tweet = this.sessionTweets.get(tweetIdResult.id)!;
            tweet.hasInteracted = true;
            tweet.interactionType = type;
            console.log(`[RESMA] Interaction: ${type} on ${tweetIdResult.id}`);
        }
    }

    private scrapeTweetData(element: Element, tweetIdResult: TweetIdResult): TwitterTweet | null {
        try {
            const userLink = element.querySelector('div[data-testid="User-Name"] a');
            const authorHandle = userLink?.getAttribute('href')?.replace('/', '') || null;
            const authorName = userLink?.textContent?.split('@')[0] || null;
            const text = element.querySelector('div[data-testid="tweetText"]')?.textContent || null;
            const isPromoted = this.isPromotedTweet(element);
            const replyMetadata = this.getReplyMetadata(element);
            const quotedStatusId = this.getQuotedStatusId(
                element,
                tweetIdResult.id,
                replyMetadata.replyToStatusId
            );
            const contentCategories = this.getContentCategories({
                isPromoted,
                replyToStatusId: replyMetadata.replyToStatusId,
                quotedStatusId,
            }, element);

            return {
                id: tweetIdResult.id,
                syntheticId: tweetIdResult.syntheticId,
                authorHandle,
                authorName,
                text,
                timestamp: Date.now(),
                impressionStartTime: Date.now(),
                impressionDuration: 0,
                isPromoted,
                replyToHandle: replyMetadata.replyToHandle,
                replyToStatusId: replyMetadata.replyToStatusId,
                quotedStatusId,
                contentCategories,
                hasInteracted: false,
                interactionType: null,
                lastUploadedImpressionDuration: 0,
                lastUploadedInteractionType: null,
            };
        } catch {
            return null;
        }
    }

    private isPromotedTweet(element: Element): boolean {
        const hasAdLabel = Array.from(element.querySelectorAll('span'))
            .some((span) => span.textContent?.trim() === 'Ad');
        if (hasAdLabel) {
            return true;
        }

        const hasPromotedAttributeSignal = Array.from(element.querySelectorAll('[aria-label], [data-testid]'))
            .some((candidate) => {
                const ariaLabel = candidate.getAttribute('aria-label')?.toLowerCase() ?? '';
                return ariaLabel.includes('promoted')
                    || candidate.getAttribute('data-testid') === 'placementTracking';
            });

        const hasWhyThisAdLink = Array.from(element.querySelectorAll('a'))
            .some((anchor) => {
                const text = anchor.textContent?.trim().toLowerCase() ?? '';
                return text.includes('why') && text.includes('ad');
            });

        if (hasPromotedAttributeSignal && hasWhyThisAdLink) {
            console.debug('[RESMA] Promoted tweet detected via secondary attribute signal and "Why this ad" fallback');
            return true;
        }

        return false;
    }

    private getReplyMetadata(element: Element): { replyToHandle: string | null; replyToStatusId: string | null } {
        const replyLabel = Array.from(element.querySelectorAll('span, div'))
            .find((candidate) => /Replying to\s+@/i.test(candidate.textContent?.trim() ?? ''));
        if (!replyLabel) {
            return { replyToHandle: null, replyToStatusId: null };
        }

        const labelText = replyLabel.textContent?.trim() ?? '';
        const replyToHandle = labelText.match(/Replying to\s+@([A-Za-z0-9_]+)/i)?.[1] ?? null;
        const replyContainer = replyLabel.closest('div') ?? replyLabel;
        const replyToStatusId = Array.from(replyContainer.querySelectorAll('a[href*="/status/"]'))
            .map((anchor) => this.extractStatusIdFromHref(anchor.getAttribute('href')))
            .find((statusId): statusId is string => Boolean(statusId)) ?? null;

        return {
            replyToHandle: replyToHandle ? `@${replyToHandle}` : null,
            replyToStatusId,
        };
    }

    private getQuotedStatusId(
        element: Element,
        tweetId: string,
        replyToStatusId: string | null
    ): string | null {
        const candidateCards = Array.from(element.querySelectorAll('div[role="link"], a[role="link"], div[tabindex="0"]'));
        for (const card of candidateCards) {
            if (card === element) continue;
            const statusId = this.extractStatusIdFromHref(
                card.getAttribute('href')
                ?? card.querySelector('a[href*="/status/"]')?.getAttribute('href')
            );
            if (!statusId || statusId === tweetId || statusId === replyToStatusId) {
                continue;
            }

            const cardText = card.textContent?.trim() ?? '';
            const looksLikeNestedTweet = card.querySelector('time, div[data-testid="tweetText"], div[data-testid="User-Name"]')
                || (cardText.includes('@') && cardText.length > 20);
            if (looksLikeNestedTweet) {
                return statusId;
            }
        }

        return Array.from(element.querySelectorAll('a[href*="/status/"]'))
            .map((anchor) => this.extractStatusIdFromHref(anchor.getAttribute('href')))
            .find((statusId): statusId is string => Boolean(statusId && statusId !== tweetId && statusId !== replyToStatusId))
            ?? null;
    }

    private isPartOfVisibleThread(element: Element): boolean {
        const cell = element.closest('div[data-testid="cellInnerDiv"]') ?? element;
        return Array.from(cell.querySelectorAll('div[style]'))
            .some((candidate) => {
                const style = candidate.getAttribute('style')?.toLowerCase() ?? '';
                return style.includes('width: 2px') && style.includes('background-color');
            });
    }

    private hasMediaAttachment(element: Element): boolean {
        return Boolean(
            element.querySelector('video, div[data-testid="tweetPhoto"], div[data-testid="videoPlayer"], div[data-testid="card.wrapper"], img[alt="Image"]')
        );
    }

    private getContentCategories(
        tweet: Pick<TwitterTweet, 'isPromoted' | 'replyToStatusId' | 'quotedStatusId'>,
        element: Element
    ): string[] | undefined {
        const categories = new Set<string>();
        if (tweet.isPromoted) categories.add('promoted');
        if (tweet.replyToStatusId) categories.add('reply');
        if (tweet.quotedStatusId) categories.add('quote-tweet');
        if (this.isPartOfVisibleThread(element)) categories.add('thread');
        if (this.hasMediaAttachment(element)) categories.add('media');

        return categories.size > 0 ? Array.from(categories) : undefined;
    }

    private extractStatusIdFromHref(href: string | null | undefined): string | null {
        return href?.match(/\/status\/(\d+)/)?.[1] ?? null;
    }

    private getTweetId(element: Element): TweetIdResult | null {
        const timestampStatusId = this.extractStatusIdFromHref(
            element.querySelector('time')?.closest('a')?.getAttribute('href')
        );
        if (timestampStatusId) {
            return { id: timestampStatusId, syntheticId: false };
        }

        for (const link of Array.from(element.querySelectorAll('a[href*="/status/"]'))) {
            const statusId = this.extractStatusIdFromHref(link.getAttribute('href'));
            if (statusId) {
                return { id: statusId, syntheticId: false };
            }
        }

        const dataTweetId = this.sanitizeString(
            element.getAttribute('data-tweet-id')
            ?? element.getAttribute('data-item-id')
            ?? element.querySelector('[data-tweet-id]')?.getAttribute('data-tweet-id')
            ?? element.querySelector('[data-item-id]')?.getAttribute('data-item-id')
        );
        if (dataTweetId) {
            return { id: dataTweetId, syntheticId: false };
        }

        const syntheticId = this.buildSyntheticTweetId(element);
        return syntheticId ? { id: syntheticId, syntheticId: true } : null;
    }

    private sendBatch() {
        if (!this.isCapturing) {
            return;
        }

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
                    syntheticId: boolean;
                    replyToHandle: string | null;
                    replyToStatusId: string | null;
                    quotedStatusId: string | null;
                    timestamp: number;
                };
            };
        }> = [];

        for (const [, tweet] of this.sessionTweets.entries()) {
            const currentlyVisibleDuration = tweet.impressionStartTime > 0
                ? (Date.now() - tweet.impressionStartTime) / 1000
                : 0;
            const totalImpressionDuration = tweet.impressionDuration + currentlyVisibleDuration;
            const unsentImpressionDuration = Math.max(
                0,
                totalImpressionDuration - tweet.lastUploadedImpressionDuration
            );
            const hasMeaningfulDurationDelta = unsentImpressionDuration > 1;
            const hasNewInteraction = Boolean(tweet.interactionType)
                && tweet.interactionType !== tweet.lastUploadedInteractionType;

            if (!hasMeaningfulDurationDelta && !hasNewInteraction) {
                continue;
            }

            pendingUploads.push({
                tweet,
                nextUploadedImpressionDuration: totalImpressionDuration,
                nextUploadedInteractionType: hasNewInteraction ? tweet.interactionType : tweet.lastUploadedInteractionType,
                payload: {
                    videoId: tweet.id,
                    creatorHandle: tweet.authorHandle,
                    creatorId: tweet.authorHandle ?? tweet.authorName,
                    caption: tweet.text,
                    position: pendingUploads.length,
                    interacted: hasNewInteraction,
                    interactionType: hasNewInteraction ? tweet.interactionType : null,
                    contentCategories: tweet.contentCategories,
                    engagementMetrics: {
                        impressionDuration: unsentImpressionDuration,
                        isPromoted: tweet.isPromoted,
                        syntheticId: tweet.syntheticId,
                        replyToHandle: tweet.replyToHandle,
                        replyToStatusId: tweet.replyToStatusId,
                        quotedStatusId: tweet.quotedStatusId,
                        timestamp: tweet.timestamp,
                    },
                },
            });
        }

        if (pendingUploads.length === 0) {
            return;
        }

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
                },
            },
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

    private getCaptureSurface(): string {
        const pathname = location.pathname.replace(/\/+$/, '') || '/';

        if (pathname.includes('/status/')) {
            return 'tweet-detail';
        }

        if (pathname === '/i/bookmarks') {
            return 'bookmarks';
        }

        if (/^\/i\/lists\/\d+$/.test(pathname)) {
            return 'list-timeline';
        }

        if (pathname === '/notifications') {
            return 'notifications';
        }

        if (pathname.startsWith('/following')) {
            return 'following-timeline';
        }

        if (pathname.startsWith('/search')) {
            return 'search-timeline';
        }

        if (pathname === '/home' || pathname === '/') {
            const activeTabText = Array.from(document.querySelectorAll('[aria-selected="true"]'))
                .map((tab) => tab.textContent?.trim().toLowerCase() ?? '')
                .find((text) => text.includes('for you') || text.includes('following'));

            if (activeTabText?.includes('for you')) {
                return 'home-timeline-for-you';
            }

            if (activeTabText?.includes('following')) {
                return 'home-timeline-following';
            }
        }

        const reservedPaths = new Set([
            'home',
            'explore',
            'notifications',
            'messages',
            'search',
            'following',
            'i',
            'compose',
            'settings',
        ]);
        const profileMatch = pathname.match(/^\/([A-Za-z0-9_]+)$/);
        if (profileMatch && !reservedPaths.has(profileMatch[1].toLowerCase())) {
            return 'profile-timeline';
        }

        return 'home-timeline';
    }
}

new TwitterObserver();
