/**
 * RESMA - Twitter (X) Feed Observer
 * Captures timeline tweets, impressions, and ad exposure.
 */

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
}

class TwitterObserver {
    private observedTweets = new Set<Element>();
    private sessionTweets: Map<string, TwitterTweet> = new Map();
    private intersectionObserver: IntersectionObserver;
    private batchTimer: number | null = null;

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
                interactionType: null
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
        // Fallback or Ad generated ID
        return null;
    }

    private sendBatch() {
        const batch: TwitterTweet[] = [];

        // Find tweets that have accrued view time or interactions
        for (const [id, tweet] of this.sessionTweets.entries()) {
            if (tweet.impressionDuration > 1 || tweet.hasInteracted) { // Only interesting tweets
                // Update active impression if still viewing
                if (tweet.impressionStartTime > 0) {
                    const currentDuration = (Date.now() - tweet.impressionStartTime) / 1000;
                    tweet.impressionDuration += currentDuration;
                    tweet.impressionStartTime = Date.now(); // Checkpoint
                }

                batch.push({ ...tweet });

                // If it's old and sent, maybe clear? For now, we keep accumulating duration
                // A better approach for streaming: Send delta or total and dedupe on backend?
                // For simplicity, we send total and replace on backend, or backend ignores dups.
                // Let's assume we send snapshots.
            }
        }

        if (batch.length > 0) {
            console.log(`[RESMA] Sending batch of ${batch.length} tweets`);
            chrome.runtime.sendMessage({
                type: 'TWITTER_FEED_SNAPSHOT',
                data: batch
            });
            // Clear or reset handled mechanics if seeking only deltas? 
            // We'll keep sending accumulated state for robustness.
        }
    }
}

new TwitterObserver();
