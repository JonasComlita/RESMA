/**
 * RESMA - Instagram Feed/Reels Observer v2
 * Hybrid mode: lightweight automatic snapshots + manual deep-capture session controls.
 */
import { CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS } from '@resma/shared';

type InstagramCaptureSurface = 'instagram-feed' | 'instagram-reels' | 'instagram-stories' | 'unknown';

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
    type: 'image' | 'video' | 'carousel' | 'reel' | 'story';
    author: string | null;
    caption: string | null;
    likesCount: number | null;
    commentsCount: number | null;
    savesCount: null;
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
    private periodicFlushIntervalId: number | null = null;

    private activeReelId: string | null = null;
    private activeVideoElement: HTMLVideoElement | null = null;
    private activeReelStartTime = 0;
    private activeReelCumulativeTime = 0;
    private activeReelLastCurrentTime = 0;
    private activeReelLoopCount = 0;
    private activeStoryId: string | null = null;
    private activeStoryUsername: string | null = null;
    private activeStoryStartTime = 0;

    constructor() {
        this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), {
            threshold: 0.6,
        });

        this.setupMessageListener();
        this.initObservers();
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
                this.startPeriodicFlush();
                void this.checkActiveStory();
                sendResponse({ success: true, data: { itemCount: 0 } });
                return true;
            }

            if (message.type === 'STOP_CAPTURE') {
                (async () => {
                    await this.finalizeReel();
                    await this.finalizeStory();
                    const flushResult = await this.flushManualCaptureSession();
                    if (flushResult.success) {
                        this.isCapturing = false;
                        this.stopPeriodicFlush();
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
        this.observeStories();

        window.addEventListener('beforeunload', () => {
            void this.finalizeReel();
            void this.finalizeStory();
            void this.sendLightweightBatch();
        });
    }

    private startPeriodicFlush() {
        if (!this.isCapturing || this.periodicFlushIntervalId !== null) {
            return;
        }

        this.periodicFlushIntervalId = window.setInterval(() => {
            if (!this.isCapturing) {
                return;
            }
            void this.sendLightweightBatch();
            this.checkActiveReel();
            void this.checkActiveStory();
        }, 12000);
    }

    private stopPeriodicFlush() {
        if (this.periodicFlushIntervalId === null) {
            return;
        }

        window.clearInterval(this.periodicFlushIntervalId);
        this.periodicFlushIntervalId = null;
    }

    private getCaptureSurface(): InstagramCaptureSurface {
        if (location.pathname.includes('/reels/')) {
            return 'instagram-reels';
        }
        if (this.currentStoryRoute()) {
            return 'instagram-stories';
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
            const isSponsored = this.hasSponsoredLabel(element);
            const likesCount = this.extractLikeCount(element);
            const commentsCount = this.extractCommentCount(element);

            return {
                videoId: id,
                id,
                type,
                author,
                caption,
                likesCount,
                commentsCount,
                savesCount: null,
                timestamp: Date.now(),
                impressionDuration: 0,
                watchTime: 0,
                loopCount: 0,
                isSponsored,
                hasInteracted: false,
                interactionType: null,
                recommendations: this.scrapeRelatedPostRecommendations(element, id),
                position: this.capturedPosts.size,
            };
        } catch (error) {
            console.warn('[RESMA] Failed to scrape Instagram post:', error);
            return null;
        }
    }

    private parseEngagementCount(text: string | null | undefined): number {
        if (!text) return 0;

        const normalized = text.replace(/,/g, '');
        const matches = Array.from(normalized.matchAll(/(\d+(?:\.\d+)?)\s*([kmb])?/gi));
        const match = matches.at(-1);
        if (!match) return 0;

        const parsed = Number.parseFloat(match[1]);
        if (!Number.isFinite(parsed) || parsed < 0) return 0;

        const suffix = (match[2] || '').toLowerCase();
        const multiplier = suffix === 'k'
            ? 1_000
            : suffix === 'm'
                ? 1_000_000
                : suffix === 'b'
                    ? 1_000_000_000
                    : 1;

        return Math.round(parsed * multiplier);
    }

    private hasEngagementNumber(text: string | null | undefined): boolean {
        return Boolean(text && /\d[\d,.]*\s*[kmb]?/i.test(text));
    }

    private extractLikeCount(element: Element): number | null {
        const candidates = Array.from(element.querySelectorAll<HTMLElement>(
            '[aria-label*="like" i], [data-testid*="like" i], a, span'
        ));
        const counts: number[] = [];

        for (const candidate of candidates) {
            const text = [
                candidate.textContent,
                candidate.getAttribute('aria-label'),
                candidate.getAttribute('data-testid'),
            ].filter(Boolean).join(' ');
            if (!/\blikes?\b|\bliked\b/i.test(text) || !this.hasEngagementNumber(text)) {
                continue;
            }
            counts.push(this.parseEngagementCount(text));
        }

        return counts.length > 0 ? Math.max(...counts) : null;
    }

    private scrapeRelatedPostRecommendations(element: Element, currentPostId: string): RecommendationRow[] {
        const anchors = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/reel/"], a[href*="/p/"]'));
        const deduped = new Map<string, RecommendationRow>();

        for (const anchor of anchors) {
            const href = anchor.getAttribute('href') || '';
            const match = href.match(/\/(?:reel|p)\/([A-Za-z0-9_-]{5,64})/);
            const videoId = match?.[1];
            if (!videoId || videoId === currentPostId || !this.isRelatedPostAnchor(anchor)) {
                continue;
            }

            const surface = 'related-posts';
            deduped.set(videoId, {
                videoId,
                position: deduped.size + 1,
                title: anchor.getAttribute('title') || anchor.getAttribute('aria-label') || null,
                channel: null,
                surface,
                surfaces: [surface],
            });

            if (deduped.size >= 25) {
                break;
            }
        }

        return Array.from(deduped.values());
    }

    private isRelatedPostAnchor(anchor: HTMLAnchorElement): boolean {
        let current: Element | null = anchor;
        for (let depth = 0; current && depth < 5; depth += 1) {
            const text = current.textContent?.trim() || '';
            if (/\b(suggested posts?|related posts?|more posts like this|recommended posts?)\b/i.test(text)) {
                return true;
            }
            current = current.parentElement;
        }

        return false;
    }

    private extractCommentCount(element: Element): number | null {
        const candidates = Array.from(element.querySelectorAll<HTMLElement>('a, button, span, div[role="button"]'));
        const counts: number[] = [];

        for (const candidate of candidates) {
            const text = [
                candidate.textContent,
                candidate.getAttribute('aria-label'),
            ].filter(Boolean).join(' ');
            if (!/\bcomments?\b/i.test(text) || !this.hasEngagementNumber(text)) {
                continue;
            }
            counts.push(this.parseEngagementCount(text));
        }

        return counts.length > 0 ? Math.max(...counts) : null;
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
            this.activeReelCumulativeTime = 0;
            this.activeReelLastCurrentTime = 0;
            this.activeReelLoopCount = 0;
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
        const currentTime = this.activeVideoElement.currentTime;
        const delta = currentTime - this.activeReelLastCurrentTime;

        if (delta > 0 && delta < 5) {
            this.activeReelCumulativeTime += delta;
        } else if (delta < 0) {
            this.activeReelCumulativeTime += currentTime;
            this.activeReelLoopCount += 1;
        }

        this.activeReelLastCurrentTime = currentTime;
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
            const surface = this.detectReelRecommendationSurface(anchor);
            const surfaces = [surface];

            const existing = deduped.get(videoId);
            if (existing) {
                existing.surfaces = Array.from(new Set([...existing.surfaces, ...surfaces]));
                if (!existing.title && title) {
                    existing.title = title;
                }
            } else {
                deduped.set(videoId, {
                    videoId,
                    position: deduped.size + 1,
                    title,
                    channel: null,
                    surface,
                    surfaces,
                });
            }

            if (deduped.size >= 25) {
                break;
            }
        }

        return Array.from(deduped.values());
    }

    private detectReelRecommendationSurface(anchor: HTMLAnchorElement): string {
        if (this.isInsideHorizontalScrollContainer(anchor)) {
            return 'reels-rail';
        }

        if (location.pathname.startsWith('/explore') || anchor.closest('[role="grid"]')) {
            return 'explore-grid';
        }

        if (this.isInsidePrimaryVerticalScrollContainer(anchor)) {
            return 'reels-up-next';
        }

        return 'unknown';
    }

    private isInsideHorizontalScrollContainer(element: Element): boolean {
        let current = element.parentElement;
        while (current && current !== document.body) {
            const styles = window.getComputedStyle(current);
            const hasHorizontalOverflow = (styles.overflowX === 'auto' || styles.overflowX === 'scroll')
                && current.scrollWidth > current.clientWidth + 20;
            const hasHorizontalSnap = /\bx\b|\binline\b/i.test(styles.scrollSnapType);
            if (hasHorizontalOverflow || hasHorizontalSnap) {
                return true;
            }
            current = current.parentElement;
        }

        return false;
    }

    private isInsidePrimaryVerticalScrollContainer(element: Element): boolean {
        let current = element.parentElement;
        while (current && current !== document.body) {
            const styles = window.getComputedStyle(current);
            const hasVerticalOverflow = (styles.overflowY === 'auto' || styles.overflowY === 'scroll')
                && current.scrollHeight > current.clientHeight + 20;
            if (hasVerticalOverflow) {
                return true;
            }
            current = current.parentElement;
        }

        return location.pathname.includes('/reels/') && Boolean(element.closest('main'));
    }

    private async finalizeReel() {
        if (!this.activeReelId) return;

        const reelId = this.activeReelId;
        const activeVideoElement = this.activeVideoElement;
        const activeReelStartTime = this.activeReelStartTime;
        const activeReelCumulativeTime = this.activeReelCumulativeTime;
        const activeReelLoopCount = this.activeReelLoopCount;
        this.activeVideoElement = null;
        this.activeReelId = null;
        this.activeReelStartTime = 0;
        this.activeReelCumulativeTime = 0;
        this.activeReelLastCurrentTime = 0;
        this.activeReelLoopCount = 0;

        if (activeVideoElement) {
            activeVideoElement.removeEventListener('timeupdate', this.onReelTimeUpdate);
        }

        const item: InstagramCapturedItem = {
            videoId: reelId,
            id: reelId,
            type: 'reel',
            author: null,
            caption: null,
            likesCount: null,
            commentsCount: null,
            savesCount: null,
            timestamp: Date.now(),
            impressionDuration: 0,
            watchTime: activeReelCumulativeTime === 0
                ? Math.max(0, (Date.now() - activeReelStartTime) / 1000)
                : activeReelCumulativeTime,
            loopCount: activeReelLoopCount,
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

    private observeStories() {
        const dispatchLocationChange = () => window.dispatchEvent(new Event('resma-location-change'));
        const originalPushState = history.pushState.bind(history);
        const originalReplaceState = history.replaceState.bind(history);

        history.pushState = ((...args: Parameters<History['pushState']>) => {
            const result = originalPushState(...args);
            dispatchLocationChange();
            return result;
        }) as History['pushState'];

        history.replaceState = ((...args: Parameters<History['replaceState']>) => {
            const result = originalReplaceState(...args);
            dispatchLocationChange();
            return result;
        }) as History['replaceState'];

        const handleLocationChange = () => {
            window.setTimeout(() => {
                void this.checkActiveStory();
            }, 0);
        };

        window.addEventListener('popstate', handleLocationChange);
        window.addEventListener('hashchange', handleLocationChange);
        window.addEventListener('resma-location-change', handleLocationChange);
        void this.checkActiveStory();
    }

    private currentStoryRoute(): { username: string; storyId: string } | null {
        const match = location.pathname.match(/\/stories\/([^/]+)\/(\d+)\//);
        if (!match?.[1] || !match?.[2]) {
            return null;
        }

        return {
            username: decodeURIComponent(match[1]),
            storyId: match[2],
        };
    }

    private async checkActiveStory() {
        if (!this.isCapturing) {
            this.activeStoryId = null;
            this.activeStoryUsername = null;
            this.activeStoryStartTime = 0;
            return;
        }

        const route = this.currentStoryRoute();
        if (!route) {
            await this.finalizeStory();
            return;
        }

        if (this.activeStoryId === route.storyId && this.activeStoryUsername === route.username) {
            return;
        }

        await this.finalizeStory();
        this.activeStoryId = route.storyId;
        this.activeStoryUsername = route.username;
        this.activeStoryStartTime = Date.now();
    }

    private async finalizeStory() {
        if (!this.activeStoryId) return;

        const storyId = this.activeStoryId;
        const username = this.activeStoryUsername;
        const storyStartTime = this.activeStoryStartTime;
        this.activeStoryId = null;
        this.activeStoryUsername = null;
        this.activeStoryStartTime = 0;

        const item: InstagramCapturedItem = {
            videoId: storyId,
            id: storyId,
            type: 'story',
            author: username,
            caption: null,
            likesCount: null,
            commentsCount: null,
            savesCount: null,
            timestamp: Date.now(),
            impressionDuration: Math.max(0, (Date.now() - storyStartTime) / 1000),
            watchTime: 0,
            loopCount: 0,
            isSponsored: this.hasSponsoredLabel(document),
            hasInteracted: false,
            interactionType: null,
            recommendations: [],
            position: this.capturedPosts.size,
        };

        this.capturedPosts.set(storyId, item);
        if (this.isCapturing) {
            this.manualCaptureBuffer.set(storyId, item);
            if (!this.lightweightUploadedIds.has(storyId)) {
                const uploadSucceeded = await this.uploadFeed([item], {
                    type: 'STORY_VIEW',
                    captureSurface: 'instagram-stories',
                    uploadEvent: 'INSTAGRAM_STORY_VIEW',
                });
                if (uploadSucceeded) {
                    this.lightweightUploadedIds.add(storyId);
                }
            }
        }
    }

    private hasSponsoredLabel(root: ParentNode): boolean {
        return Array.from(root.querySelectorAll('span'))
            .some((span) => span.textContent?.trim() === 'Sponsored');
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
        if (!this.isCapturing || feed.length === 0) {
            return Promise.resolve(false);
        }

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
