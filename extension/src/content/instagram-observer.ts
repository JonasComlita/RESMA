/**
 * RESMA - Instagram Feed/Reels Observer v2
 * Hybrid mode: lightweight automatic snapshots + manual deep-capture session controls.
 */

type InstagramCaptureSurface = 'instagram-feed' | 'instagram-reels' | 'unknown';

interface RecommendationRow {
    videoId: string;
    position: number;
    title: string | null;
    channel: string | null;
    surface: string;
    surfaces: string[];
}

interface InstagramCapturedItem {
    videoId: string;
    id: string;
    type: 'image' | 'video' | 'carousel' | 'reel';
    author: string | null;
    caption: string | null;
    timestamp: number;
    impressionDuration: number;
    watchTime: number;
    loopCount: number;
    isSponsored: boolean;
    hasInteracted: boolean;
    interactionType: string | null;
    recommendations: RecommendationRow[];
    position: number;
}

class InstagramObserver {
    private capturedPosts = new Map<string, InstagramCapturedItem>();
    private manualCaptureBuffer = new Map<string, InstagramCapturedItem>();
    private intersectionObserver: IntersectionObserver;
    private isCapturing = false;
    private clientSessionId = `ig-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    private activeReelId: string | null = null;
    private activeVideoElement: HTMLVideoElement | null = null;
    private activeReelStartTime = 0;
    private activeReelMaxTime = 0;

    constructor() {
        this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), {
            threshold: 0.6,
        });

        this.setupMessageListener();
        this.initObservers();
        this.startPeriodicFlush();
        console.log('[RESMA] Instagram observer v2 initialized');
    }

    private setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'GET_STATUS') {
                sendResponse({
                    isCapturing: this.isCapturing,
                    itemCount: this.manualCaptureBuffer.size,
                });
                return true;
            }

            if (message.type === 'START_CAPTURE') {
                this.isCapturing = true;
                this.manualCaptureBuffer.clear();
                this.clientSessionId = `ig-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                sendResponse({ success: true, data: { itemCount: 0 } });
                return true;
            }

            if (message.type === 'STOP_CAPTURE') {
                this.finalizeReel();
                const itemCount = this.flushManualCaptureSession();
                this.isCapturing = false;
                sendResponse({ success: true, data: { itemCount } });
                return true;
            }

            return false;
        });
    }

    private initObservers() {
        this.observeFeedArticles();
        this.observeDynamicDom();
        this.observeReels();

        window.addEventListener('beforeunload', () => {
            this.finalizeReel();
            this.sendLightweightBatch();
        });
    }

    private startPeriodicFlush() {
        setInterval(() => {
            this.sendLightweightBatch();
            this.checkActiveReel();
        }, 12000);
    }

    private getCaptureSurface(): InstagramCaptureSurface {
        if (location.pathname.includes('/reels/')) {
            return 'instagram-reels';
        }
        if (location.pathname === '/' || location.pathname.startsWith('/explore')) {
            return 'instagram-feed';
        }
        return 'unknown';
    }

    private observeFeedArticles() {
        document.querySelectorAll('article').forEach((article) => this.observePost(article));
    }

    private observeDynamicDom() {
        const target = document.querySelector('main') || document.body;
        const mutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (!(node instanceof Element)) return;
                    if (node.matches('article')) {
                        this.observePost(node);
                    }
                    node.querySelectorAll('article').forEach((article) => this.observePost(article));
                });
            }
        });

        mutationObserver.observe(target, { childList: true, subtree: true });
    }

    private observePost(element: Element) {
        const id = this.extractPostId(element);
        if (!id) return;

        element.setAttribute('data-resma-id', id);
        this.intersectionObserver.observe(element);

        const likeButtons = element.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]');
        likeButtons.forEach((button) => {
            button.closest('div[role="button"]')?.addEventListener('click', () => {
                this.recordInteraction(id, 'like');
            });
        });
    }

    private handleIntersection(entries: IntersectionObserverEntry[]) {
        entries.forEach((entry) => {
            const id = entry.target.getAttribute('data-resma-id');
            if (!id) return;

            if (entry.isIntersecting) {
                if (!this.capturedPosts.has(id)) {
                    const captured = this.scrapePost(entry.target as Element, id);
                    if (captured) {
                        this.capturedPosts.set(id, captured);
                    }
                }
                const item = this.capturedPosts.get(id);
                if (item) {
                    item.timestamp = Date.now();
                }
                return;
            }

            const item = this.capturedPosts.get(id);
            if (item) {
                item.impressionDuration += 1;
            }
        });
    }

    private extractPostId(element: Element): string | null {
        const reelHref = element.querySelector('a[href*="/reel/"]')?.getAttribute('href');
        if (reelHref) {
            const match = reelHref.match(/\/reel\/([A-Za-z0-9_-]{5,64})/);
            if (match?.[1]) {
                return match[1];
            }
        }

        const postHref = element.querySelector('a[href*="/p/"]')?.getAttribute('href');
        if (postHref) {
            const match = postHref.match(/\/p\/([A-Za-z0-9_-]{5,64})/);
            if (match?.[1]) {
                return match[1];
            }
        }

        return null;
    }

    private scrapePost(element: Element, id: string): InstagramCapturedItem | null {
        try {
            const author = element.querySelector('header a')?.textContent?.trim() || null;
            const caption = element.querySelector('h1, h2, span[dir="auto"]')?.textContent?.trim() || null;
            const hasVideo = Boolean(element.querySelector('video'));
            const hasCarousel = Boolean(element.querySelector('ul li'));
            const type: InstagramCapturedItem['type'] = hasVideo
                ? (location.pathname.includes('/reels/') ? 'reel' : 'video')
                : (hasCarousel ? 'carousel' : 'image');
            const isSponsored = Array.from(element.querySelectorAll('span'))
                .some((span) => span.textContent?.trim() === 'Sponsored');

            return {
                videoId: id,
                id,
                type,
                author,
                caption,
                timestamp: Date.now(),
                impressionDuration: 0,
                watchTime: 0,
                loopCount: 0,
                isSponsored,
                hasInteracted: false,
                interactionType: null,
                recommendations: [],
                position: this.capturedPosts.size,
            };
        } catch (error) {
            console.warn('[RESMA] Failed to scrape Instagram post:', error);
            return null;
        }
    }

    private recordInteraction(id: string, interactionType: string) {
        const item = this.capturedPosts.get(id);
        if (!item) return;
        item.hasInteracted = true;
        item.interactionType = interactionType;
        if (this.isCapturing) {
            this.manualCaptureBuffer.set(id, { ...item });
        }
    }

    private observeReels() {
        new MutationObserver(() => {
            this.checkActiveReel();
        }).observe(document.body, { childList: true, subtree: true });
    }

    private checkActiveReel() {
        if (!location.pathname.includes('/reels/')) return;

        const videos = Array.from(document.querySelectorAll('video'));
        const activeVideo = videos.find((video) => !video.paused && this.isElementVisible(video));
        if (!activeVideo) return;

        const reelId = this.currentReelId();
        if (!reelId) return;

        if (this.activeReelId !== reelId) {
            this.finalizeReel();
            this.activeReelId = reelId;
            this.activeVideoElement = activeVideo;
            this.activeReelStartTime = Date.now();
            this.activeReelMaxTime = 0;
            activeVideo.addEventListener('timeupdate', this.onReelTimeUpdate);
        }
    }

    private currentReelId(): string | null {
        const pathMatch = location.pathname.match(/\/reels?\/([A-Za-z0-9_-]{5,64})/);
        if (pathMatch?.[1]) {
            return pathMatch[1];
        }
        return null;
    }

    private onReelTimeUpdate = () => {
        if (!this.activeVideoElement) return;
        this.activeReelMaxTime = Math.max(this.activeReelMaxTime, this.activeVideoElement.currentTime);
    };

    private scrapeReelRecommendations(currentReelId: string): RecommendationRow[] {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/reel/"], a[href*="/p/"]'));
        const deduped = new Map<string, RecommendationRow>();

        for (const anchor of anchors) {
            const href = anchor.getAttribute('href') || '';
            const match = href.match(/\/(?:reel|p)\/([A-Za-z0-9_-]{5,64})/);
            const videoId = match?.[1];
            if (!videoId || videoId === currentReelId) continue;

            const title = anchor.getAttribute('title') || anchor.getAttribute('aria-label') || null;
            const row: RecommendationRow = {
                videoId,
                position: deduped.size + 1,
                title,
                channel: null,
                surface: 'reels-up-next',
                surfaces: ['reels-up-next'],
            };

            if (!deduped.has(videoId)) {
                deduped.set(videoId, row);
            }

            if (deduped.size >= 25) {
                break;
            }
        }

        return Array.from(deduped.values());
    }

    private finalizeReel() {
        if (!this.activeReelId) return;

        const reelId = this.activeReelId;
        const item: InstagramCapturedItem = {
            videoId: reelId,
            id: reelId,
            type: 'reel',
            author: null,
            caption: null,
            timestamp: Date.now(),
            impressionDuration: 0,
            watchTime: this.activeReelMaxTime || Math.max(0, (Date.now() - this.activeReelStartTime) / 1000),
            loopCount: 0,
            isSponsored: false,
            hasInteracted: false,
            interactionType: null,
            recommendations: this.scrapeReelRecommendations(reelId),
            position: this.capturedPosts.size,
        };

        this.capturedPosts.set(reelId, item);
        if (this.isCapturing) {
            this.manualCaptureBuffer.set(reelId, item);
        }

        this.uploadFeed([item], {
            type: 'REEL_WATCH',
            captureSurface: 'instagram-reels',
            uploadEvent: 'INSTAGRAM_REEL_COMPLETE',
        });

        if (this.activeVideoElement) {
            this.activeVideoElement.removeEventListener('timeupdate', this.onReelTimeUpdate);
        }
        this.activeVideoElement = null;
        this.activeReelId = null;
        this.activeReelStartTime = 0;
        this.activeReelMaxTime = 0;
    }

    private sendLightweightBatch() {
        const batch = Array.from(this.capturedPosts.values())
            .filter((item) => item.impressionDuration >= 1 || item.hasInteracted || item.type === 'reel')
            .map((item, index) => ({
                ...item,
                position: index,
            }));

        if (batch.length === 0) return;

        this.uploadFeed(batch, {
            type: 'INSTAGRAM_LIGHT_SNAPSHOT',
            captureSurface: this.getCaptureSurface(),
            uploadEvent: 'INSTAGRAM_FEED_SNAPSHOT',
        });

        if (this.isCapturing) {
            for (const item of batch) {
                this.manualCaptureBuffer.set(item.videoId, item);
            }
        }
    }

    private flushManualCaptureSession() {
        const feed = Array.from(this.manualCaptureBuffer.values());
        if (feed.length === 0) {
            return 0;
        }

        this.uploadFeed(feed, {
            type: 'MANUAL_CAPTURE_SESSION',
            captureSurface: this.getCaptureSurface(),
            uploadEvent: 'INSTAGRAM_MANUAL_CAPTURE',
        });
        this.manualCaptureBuffer.clear();
        return feed.length;
    }

    private uploadFeed(feed: InstagramCapturedItem[], metadata: Record<string, unknown>) {
        chrome.runtime.sendMessage({
            type: 'UPLOAD_PLATFORM_FEED',
            payload: {
                platform: 'instagram',
                feed,
                sessionMetadata: {
                    ...metadata,
                    clientSessionId: this.clientSessionId,
                    observerVersion: 'instagram-observer-v2',
                    ingestVersion: 'cross-platform-v1',
                    capturedAt: new Date().toISOString(),
                },
            },
        });
    }

    private isElementVisible(element: HTMLElement): boolean {
        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

        const centerY = rect.top + rect.height / 2;
        const centerX = rect.left + rect.width / 2;

        return centerY >= 0
            && centerY <= viewportHeight
            && centerX >= 0
            && centerX <= viewportWidth;
    }
}

new InstagramObserver();
