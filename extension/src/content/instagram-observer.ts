/**
 * RESMA - Instagram Feed/Reels Observer v2
 * Hybrid mode: lightweight automatic snapshots + manual deep-capture session controls.
 */
import { CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS } from '@resma/shared';

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
    private lightweightUploadedIds = new Set<string>();
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
                this.lightweightUploadedIds.clear();
                this.clientSessionId = `ig-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                sendResponse({ success: true, data: { itemCount: 0 } });
                return true;
            }

            if (message.type === 'STOP_CAPTURE') {
                (async () => {
                    await this.finalizeReel();
                    const flushResult = await this.flushManualCaptureSession();
                    if (flushResult.success) {
                        this.isCapturing = false;
                        sendResponse({ success: true, data: { itemCount: flushResult.itemCount } });
                        return;
                    }

                    sendResponse({
                        success: false,
                        error: 'Upload failed. Please retry stop capture when connected.',
                        data: { itemCount: flushResult.itemCount },
                    });
                })().catch((error) => {
                    console.warn('[RESMA] Failed to stop Instagram capture cleanly:', error);
                    sendResponse({
                        success: false,
                        error: 'Failed to finalize capture session.',
                    });
                });
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
            void this.finalizeReel();
            void this.sendLightweightBatch();
        });
    }

    private startPeriodicFlush() {
        setInterval(() => {
            void this.sendLightweightBatch();
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
            void this.finalizeReel();
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

    private async finalizeReel() {
        if (!this.activeReelId) return;

        const reelId = this.activeReelId;
        const activeVideoElement = this.activeVideoElement;
        const activeReelStartTime = this.activeReelStartTime;
        const activeReelMaxTime = this.activeReelMaxTime;
        this.activeVideoElement = null;
        this.activeReelId = null;
        this.activeReelStartTime = 0;
        this.activeReelMaxTime = 0;

        if (activeVideoElement) {
            activeVideoElement.removeEventListener('timeupdate', this.onReelTimeUpdate);
        }

        const item: InstagramCapturedItem = {
            videoId: reelId,
            id: reelId,
            type: 'reel',
            author: null,
            caption: null,
            timestamp: Date.now(),
            impressionDuration: 0,
            watchTime: activeReelMaxTime || Math.max(0, (Date.now() - activeReelStartTime) / 1000),
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
            if (!this.lightweightUploadedIds.has(reelId)) {
                const uploadSucceeded = await this.uploadFeed([item], {
                    type: 'REEL_WATCH',
                    captureSurface: 'instagram-reels',
                    uploadEvent: 'INSTAGRAM_REEL_COMPLETE',
                });
                if (uploadSucceeded) {
                    this.lightweightUploadedIds.add(reelId);
                }
            }
        }
    }

    private async sendLightweightBatch() {
        if (!this.isCapturing) return;

        const batch = Array.from(this.capturedPosts.values())
            .filter((item) => (
                item.impressionDuration >= 1 || item.hasInteracted || item.type === 'reel'
            ) && !this.lightweightUploadedIds.has(item.videoId))
            .map((item, index) => ({
                ...item,
                position: index,
            }));

        if (batch.length === 0) return;

        for (const item of batch) {
            this.manualCaptureBuffer.set(item.videoId, item);
        }

        const uploadSucceeded = await this.uploadFeed(batch, {
            type: 'INSTAGRAM_LIGHT_SNAPSHOT',
            captureSurface: this.getCaptureSurface(),
            uploadEvent: 'INSTAGRAM_FEED_SNAPSHOT',
        });

        if (uploadSucceeded && this.isCapturing) {
            for (const item of batch) {
                this.lightweightUploadedIds.add(item.videoId);
            }
        }
    }

    private async flushManualCaptureSession(): Promise<{ itemCount: number; success: boolean }> {
        const totalCaptured = this.manualCaptureBuffer.size;
        const feed = Array.from(this.manualCaptureBuffer.values()).filter(
            (item) => !this.lightweightUploadedIds.has(item.videoId)
        );
        if (feed.length === 0) {
            this.manualCaptureBuffer.clear();
            this.lightweightUploadedIds.clear();
            return { itemCount: totalCaptured, success: true };
        }

        const uploadSucceeded = await this.uploadFeed(feed, {
            type: 'MANUAL_CAPTURE_SESSION',
            captureSurface: this.getCaptureSurface(),
            uploadEvent: 'INSTAGRAM_MANUAL_CAPTURE',
        });

        if (uploadSucceeded) {
            this.manualCaptureBuffer.clear();
            this.lightweightUploadedIds.clear();
        }

        return { itemCount: totalCaptured, success: uploadSucceeded };
    }

    private uploadFeed(feed: InstagramCapturedItem[], metadata: Record<string, unknown>): Promise<boolean> {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'UPLOAD_PLATFORM_FEED',
                payload: {
                    platform: 'instagram',
                    feed,
                    sessionMetadata: {
                        ...metadata,
                        clientSessionId: this.clientSessionId,
                        observerVersion: CURRENT_OBSERVER_VERSIONS.instagram,
                        ingestVersion: CURRENT_INGEST_VERSION,
                        capturedAt: new Date().toISOString(),
                    },
                },
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[RESMA] Instagram upload callback failed:', chrome.runtime.lastError.message);
                    resolve(false);
                    return;
                }

                resolve(Boolean(response?.success));
            });
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
