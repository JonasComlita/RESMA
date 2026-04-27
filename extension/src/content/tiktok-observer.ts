import { CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS } from '@resma/shared';

export function parseEngagementCount(text: string): number {
    const compact = text.replace(/\s+/g, '');
    if (!compact) {
        return 0;
    }

    const suffixMatch = compact.match(/(万|亿|[kmb])$/i);
    const suffix = suffixMatch?.[1] ?? '';
    const multiplier = suffix === '万'
        ? 10_000
        : suffix === '亿'
            ? 100_000_000
            : suffix.toLowerCase() === 'k'
                ? 1_000
                : suffix.toLowerCase() === 'm'
                    ? 1_000_000
                    : suffix.toLowerCase() === 'b'
                        ? 1_000_000_000
                        : 1;

    const numericPart = suffix ? compact.slice(0, -suffix.length) : compact;
    const decimalCommaMatch = numericPart.match(/,(\d{1,2})$/);
    const normalizedNumeric = decimalCommaMatch
        ? `${numericPart.slice(0, decimalCommaMatch.index).replace(/,/g, '')}.${decimalCommaMatch[1]}`
        : numericPart.replace(/,/g, '');
    const parsed = Number(normalizedNumeric);

    if (!Number.isFinite(parsed)) {
        return 0;
    }

    return Math.round(parsed * multiplier);
}

interface VideoAnalytics {
    duration: number;
    watchedSeconds: number;
    loops: number;
    seekCount: number;
    didFinish: boolean;
    exitReason: 'next_video' | 'closed_tab' | 'switched_tab' | 'unknown';
    interaction: {
        liked: boolean;
        commented: boolean;
        shared: boolean;
        clickedProfile: boolean;
        clickedExternalLink: boolean;
        clickedShop: boolean;
    };
}

interface CapturedVideo {
    videoId: string;
    creatorHandle: string | null;
    creatorId: string | null;
    caption: string | null;
    musicTitle: string | null;
    position: number;
    capturedAt: number;
    isVisible: boolean;
    engagement: {
        likes: number;
        comments: number;
        shares: number;
        saves: number;
    };
    isSponsored: boolean;
    recommendations: Array<{
        videoId: string;
        position: number;
        title: string | null;
        channel: string | null;
        surface: string;
        surfaces: string[];
    }>;
    analytics: VideoAnalytics;
}

interface RecommendationCandidate {
    videoId: string;
    position: number;
    title: string | null;
    channel: string | null;
    surface: string;
    surfaces: string[];
}

interface FeedSession {
    sessionId: string;
    startTime: number;
    videos: CapturedVideo[];
    scrollEvents: number;
}

class TikTokObserver {
    private session: FeedSession;
    private observer: MutationObserver | null = null;
    private isCapturing = false;
    private seenVideoIds = new Set<string>();
    private periodicUploadedIds = new Set<string>();
    private periodicFlushIntervalId: number | null = null;

    // Video Telemetry State
    private activeVideoId: string | null = null;
    private activeVideoElement: HTMLVideoElement | null = null;
    private videoStartTime: number = 0;
    private maxTimeWatched: number = 0;
    private seekCount: number = 0;
    private loopCount: number = 0;
    private hasFinished: boolean = false;
    private currentInteraction = this.createEmptyInteraction();

    constructor() {
        this.session = this.createNewSession();
        this.setupMessageListener();
        this.setupGlobalListeners(); // For tab closing/hiding detection
        console.log('[RESMA] TikTok Observer initialized');
    }

    private createNewSession(): FeedSession {
        return {
            sessionId: `tt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            startTime: Date.now(),
            videos: [],
            scrollEvents: 0,
        };
    }

    private createEmptyInteraction() {
        return {
            liked: false,
            commented: false,
            shared: false,
            clickedProfile: false,
            clickedExternalLink: false,
            clickedShop: false,
        };
    }

    private setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.type) {
                case 'START_CAPTURE':
                    this.startCapture();
                    sendResponse({ success: true });
                    break;
                case 'STOP_CAPTURE':
                    void this.stopCapture().then((data) => {
                        if (data.uploadSucceeded) {
                            sendResponse({ success: true, data });
                            return;
                        }

                        sendResponse({
                            success: false,
                            error: 'Upload failed. Please retry stop capture when connected.',
                            data,
                        });
                    }).catch((error) => {
                        console.warn('[RESMA] Failed to stop TikTok capture cleanly:', error);
                        sendResponse({
                            success: false,
                            error: 'Failed to finalize capture session.',
                        });
                    });
                    return true;
                case 'GET_STATUS':
                    sendResponse({
                        isCapturing: this.isCapturing,
                        itemCount: this.session.videos.length,
                    });
                    break;
            }
            return true;
        });
    }

    private setupGlobalListeners() {
        // Detect tab switching/closing
        document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.activeVideoId) {
                this.finalizeActiveVideo('switched_tab');
            }
        });

        window.addEventListener('beforeunload', () => {
            if (this.activeVideoId) {
                this.finalizeActiveVideo('closed_tab');
            }
            this.stopPeriodicFlush();
        });
    }

    startCapture() {
        if (this.isCapturing) return;

        this.session = this.createNewSession();
        this.seenVideoIds.clear();
        this.periodicUploadedIds.clear();
        this.isCapturing = true;

        // Scan existing videos
        this.scanForVideos();

        // Set up mutation observer for new videos
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    this.scanForVideos();
                }
            }
        });

        const feedContainer = document.querySelector('[data-e2e="recommend-list-item-container"]')?.parentElement
            || document.querySelector('main')
            || document.body;

        this.observer.observe(feedContainer, {
            childList: true,
            subtree: true,
        });

        window.addEventListener('scroll', this.handleScroll);
        this.startPeriodicFlush();
        console.log('[RESMA] Capture started');
    }

    private handleScroll = () => {
        if (this.isCapturing) {
            this.session.scrollEvents++;
            this.scanForVideos();
        }
    };

    async stopCapture(): Promise<{
        itemCount: number;
        sessionId: string;
        scrollEvents: number;
        uploadSucceeded: boolean;
    }> {
        // Finalize any currently watching video
        if (this.activeVideoId) {
            this.finalizeActiveVideo('unknown');
        }

        this.stopPeriodicFlush();

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        window.removeEventListener('scroll', this.handleScroll);

        const remainingVideos = this.session.videos.filter((video) => !this.periodicUploadedIds.has(video.videoId));
        let uploadSucceeded = true;
        if (remainingVideos.length > 0) {
            const uploaded = await this.uploadFeed(remainingVideos);
            if (uploaded) {
                remainingVideos.forEach((video) => this.periodicUploadedIds.add(video.videoId));
            } else {
                uploadSucceeded = false;
            }
        }

        const itemCount = this.session.videos.length;
        const sessionId = this.session.sessionId;
        const scrollEvents = this.session.scrollEvents;
        if (uploadSucceeded) {
            this.isCapturing = false;
        } else {
            this.startPeriodicFlush();
        }

        console.log(`[RESMA] Capture stopped. ${this.session.videos.length} videos captured`);
        return { itemCount, sessionId, scrollEvents, uploadSucceeded };
    }

    private startPeriodicFlush() {
        if (!this.isCapturing || this.periodicFlushIntervalId !== null) {
            return;
        }

        this.periodicFlushIntervalId = window.setInterval(() => {
            if (!this.isCapturing) {
                return;
            }
            void this.flushPeriodicBatch();
        }, 15_000);
    }

    private stopPeriodicFlush() {
        if (this.periodicFlushIntervalId === null) {
            return;
        }

        window.clearInterval(this.periodicFlushIntervalId);
        this.periodicFlushIntervalId = null;
    }

    private async flushPeriodicBatch(): Promise<boolean> {
        if (!this.isCapturing) {
            return false;
        }

        const finalizedVideos = this.session.videos.filter((video) => (
            video.videoId !== this.activeVideoId && !this.periodicUploadedIds.has(video.videoId)
        ));
        if (finalizedVideos.length === 0) {
            return false;
        }

        const uploaded = await this.uploadFeed(finalizedVideos);
        if (uploaded) {
            finalizedVideos.forEach((video) => this.periodicUploadedIds.add(video.videoId));
        }

        return uploaded;
    }

    private createSessionMetadata() {
        return {
            type: 'MANUAL_CAPTURE_SESSION',
            captureSurface: 'for-you-feed',
            clientSessionId: this.session.sessionId,
            observerVersion: CURRENT_OBSERVER_VERSIONS.tiktok,
            ingestVersion: CURRENT_INGEST_VERSION,
            scrollEvents: this.session.scrollEvents,
            capturedAt: new Date().toISOString(),
            totalCaptured: this.session.videos.length,
        };
    }

    private toUploadFeedItem(video: CapturedVideo, index: number) {
        return {
            videoId: video.videoId,
            creatorHandle: video.creatorHandle,
            creatorId: video.creatorId,
            caption: video.caption,
            musicTitle: video.musicTitle,
            positionInFeed: Number.isFinite(video.position) ? video.position : index,
            watchDuration: video.analytics?.watchedSeconds ?? 0,
            interacted: Boolean(
                video.analytics?.interaction?.liked
                || video.analytics?.interaction?.shared
                || video.analytics?.interaction?.commented
            ),
            engagementMetrics: {
                ...video.engagement,
                analytics: video.analytics,
                isSponsored: Boolean(video.isSponsored),
                recommendations: Array.isArray(video.recommendations) ? video.recommendations : [],
            },
            recommendations: Array.isArray(video.recommendations) ? video.recommendations : [],
            contentCategories: ['for-you'],
            contentTags: video.isSponsored ? ['sponsored'] : [],
        };
    }

    private uploadFeed(videos: CapturedVideo[]): Promise<boolean> {
        if (videos.length === 0) {
            return Promise.resolve(false);
        }

        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'UPLOAD_PLATFORM_FEED',
                payload: {
                    platform: 'tiktok',
                    feed: videos.map((video, index) => this.toUploadFeedItem(video, index)),
                    sessionMetadata: this.createSessionMetadata(),
                },
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[RESMA] TikTok upload callback failed:', chrome.runtime.lastError.message);
                    resolve(false);
                    return;
                }

                resolve(Boolean(response?.success));
            });
        });
    }

    private scanForVideos() {
        const videoContainers = document.querySelectorAll('[data-e2e="recommend-list-item-container"]');

        videoContainers.forEach((container, index) => {
            // Check for visibility to determine "active" video for telemetry
            if (this.isElementVisible(container as HTMLElement)) {
                this.attachVideoListeners(container as HTMLElement);
            }

            // Only extract data for new videos
            // Note: We might re-extract to update metrics if we want to capture live updates, 
            // but for now stick to "first seen" for basic metadata
            // Realistically, we should update the entry if it exists but hasn't been finalized.
            const videoLink = container.querySelector('a[href*="/video/"]');
            const videoId = videoLink?.getAttribute('href')?.match(/\/video\/(\d+)/)?.[1];

            if (videoId && !this.seenVideoIds.has(videoId)) {
                const videoData = this.extractVideoData(container as HTMLElement, index);
                if (videoData) {
                    this.seenVideoIds.add(videoData.videoId);
                    this.session.videos.push(videoData);
                    this.notifyBackgroundNewVideo(videoData);
                }
            }
        });
    }

    /**
     * Attaches listeners to the HTML5 video element to track viewing behavior
     */
    private attachVideoListeners(container: HTMLElement) {
        const videoId = container.querySelector('a[href*="/video/"]')?.getAttribute('href')?.match(/\/video\/(\d+)/)?.[1];
        if (!videoId) return;

        // If we are already tracking this video, ignore
        if (this.activeVideoId === videoId) return;

        // If we were tracking another video, finalize it (user scrolled to next)
        if (this.activeVideoId && this.activeVideoId !== videoId) {
            this.finalizeActiveVideo('next_video', videoId);
        }

        // Start tracking new video
        const videoEl = container.querySelector('video');
        if (!videoEl) return;

        this.activeVideoId = videoId;
        this.activeVideoElement = videoEl;
        this.videoStartTime = Date.now();
        this.maxTimeWatched = 0;
        this.seekCount = 0;
        this.loopCount = 0;
        this.hasFinished = false;
        this.currentInteraction = this.createEmptyInteraction();

        // Attach click listeners for conversion tracking
        this.attachConversionListeners(container);

        // HTML5 Video Events
        videoEl.addEventListener('timeupdate', () => {
            if (videoEl.currentTime > this.maxTimeWatched) {
                this.maxTimeWatched = videoEl.currentTime;
            }
        });

        videoEl.addEventListener('seeking', () => {
            this.seekCount++;
        });

        videoEl.addEventListener('ended', () => {
            this.hasFinished = true;
            this.loopCount++;
        });
    }

    private attachConversionListeners(container: HTMLElement) {
        // Link clicks
        container.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                const href = link.href;
                if (href.includes('tiktok.com/@')) {
                    this.currentInteraction.clickedProfile = true;
                } else if (!href.includes('tiktok.com')) {
                    this.currentInteraction.clickedExternalLink = true;
                }
            });
        });

        // Shop/Buy buttons (Generic heuristic)
        const buttons = container.querySelectorAll('button, a[role="button"]');
        buttons.forEach(btn => {
            if (btn.textContent?.toLowerCase().match(/(shop|buy|cart|order)/)) {
                btn.addEventListener('click', () => {
                    this.currentInteraction.clickedShop = true;
                });
            }
        });

        // Like button (approximation)
        const likeBtn = container.querySelector('[data-e2e="like-icon"]');
        likeBtn?.parentElement?.addEventListener('click', () => {
            this.currentInteraction.liked = !this.currentInteraction.liked; // Toggle
        });
    }

    private finalizeActiveVideo(
        reason: 'next_video' | 'closed_tab' | 'switched_tab' | 'unknown',
        nextVideoId?: string
    ) {
        if (!this.activeVideoId) return;

        // Find the video in our session to update it
        const videoEntry = this.session.videos.find(v => v.videoId === this.activeVideoId);
        if (videoEntry) {
            if (reason === 'next_video' && nextVideoId && nextVideoId !== this.activeVideoId) {
                const existing = videoEntry.recommendations.find((row) => row.videoId === nextVideoId);
                if (!existing) {
                    videoEntry.recommendations.unshift({
                        videoId: nextVideoId,
                        position: 1,
                        title: null,
                        channel: null,
                        surface: 'for-you-next',
                        surfaces: ['for-you-next'],
                    });
                }
            }
            videoEntry.analytics = {
                duration: this.activeVideoElement?.duration || 0,
                watchedSeconds: this.maxTimeWatched, // best approximation of linear watch
                // Or better: (Date.now() - this.videoStartTime) / 1000 for total time spent on card
                loops: this.loopCount,
                seekCount: this.seekCount,
                didFinish: this.hasFinished,
                exitReason: reason,
                interaction: this.currentInteraction
            };
        }

        // Reset state
        this.activeVideoId = null;
        this.activeVideoElement = null;
    }

    private extractVideoData(element: HTMLElement, position: number): CapturedVideo | null {
        try {
            const videoLink = element.querySelector('a[href*="/video/"]');
            const videoId = videoLink?.getAttribute('href')?.match(/\/video\/(\d+)/)?.[1];
            if (!videoId) return null;

            const creatorLink = element.querySelector('a[href*="/@"]');
            const creatorHandle = creatorLink?.getAttribute('href')?.replace('/', '') || null;

            const captionEl = element.querySelector('[data-e2e="video-desc"]');
            const caption = captionEl?.textContent?.trim() || null;

            const musicEl = element.querySelector('[data-e2e="video-music"]');
            const musicTitle = musicEl?.textContent?.trim() || null;

            const getCount = (selector: string): number => {
                const el = element.querySelector(selector);
                const text = el?.textContent?.trim();
                return text ? parseEngagementCount(text) : 0;
            };

            const likes = getCount('[data-e2e="like-count"]');
            const comments = getCount('[data-e2e="comment-count"]');
            const shares = getCount('[data-e2e="share-count"]');
            const saves = getCount('[data-e2e="undefined-count"]'); // Saves selector varies, leaving generic for now or 0

            const isSponsored = !!element.querySelector('.sponsored-label') ||
                (element.textContent?.includes('Sponsored') ?? false);

            return {
                videoId,
                creatorHandle,
                creatorId: null,
                caption,
                musicTitle,
                position,
                capturedAt: Date.now(),
                isVisible: this.isElementVisible(element),
                engagement: { likes, comments, shares, saves },
                isSponsored,
                recommendations: this.extractRecommendationCandidates(element, videoId),
                analytics: { // Initialize with defaults, will be updated by finalizeActiveVideo
                    duration: 0,
                    watchedSeconds: 0,
                    loops: 0,
                    seekCount: 0,
                    didFinish: false,
                    exitReason: 'unknown',
                    interaction: this.createEmptyInteraction()
                }
            };
        } catch (error) {
            console.error('[RESMA] Error extracting video data:', error);
            return null;
        }
    }

    private extractRecommendationCandidates(element: HTMLElement, currentVideoId: string): RecommendationCandidate[] {
        const railSelector = [
            '[data-e2e*="recommend" i] a[href*="/video/"]',
            '[data-e2e*="related" i] a[href*="/video/"]',
            '[data-e2e*="up-next" i] a[href*="/video/"]',
            '[data-e2e*="upnext" i] a[href*="/video/"]',
            '[data-e2e*="next" i] a[href*="/video/"]',
        ].join(', ');
        const railAnchors = Array.from(element.querySelectorAll<HTMLAnchorElement>(railSelector));
        const railRecommendations = this.collectRecommendationsFromAnchors(
            railAnchors,
            currentVideoId,
            'for-you-next',
            false
        );

        if (railRecommendations.length > 0) {
            return railRecommendations;
        }

        const fallbackAnchors = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'));
        return this.collectRecommendationsFromAnchors(
            fallbackAnchors,
            currentVideoId,
            'related-link',
            true
        );
    }

    private collectRecommendationsFromAnchors(
        anchors: HTMLAnchorElement[],
        currentVideoId: string,
        surface: string,
        skipProfileLinks: boolean
    ): RecommendationCandidate[] {
        const deduped = new Map<string, RecommendationCandidate>();

        for (const anchor of anchors) {
            const href = anchor.getAttribute('href') ?? anchor.href ?? '';
            if (skipProfileLinks && href.includes('/@')) continue;

            const candidateId = href.match(/\/video\/(\d{5,32})/)?.[1];
            if (!candidateId || candidateId === currentVideoId) continue;
            if (deduped.has(candidateId)) continue;

            deduped.set(candidateId, {
                videoId: candidateId,
                position: deduped.size + 1,
                title: anchor.getAttribute('title') || anchor.getAttribute('aria-label') || null,
                channel: null,
                surface,
                surfaces: [surface],
            });

            if (deduped.size >= 20) break;
        }

        return Array.from(deduped.values());
    }

    private isElementVisible(element: HTMLElement): boolean {
        const rect = element.getBoundingClientRect();
        // Considered "visible" if mostly in viewport (e.g., center point is visible)
        const windowHeight = (window.innerHeight || document.documentElement.clientHeight);
        const windowWidth = (window.innerWidth || document.documentElement.clientWidth);

        const vertInView = (rect.top <= windowHeight) && ((rect.top + rect.height) >= 0);
        const horInView = (rect.left <= windowWidth) && ((rect.left + rect.width) >= 0);

        // Stricter check for "active" consideration: center is in view
        const centerY = rect.top + rect.height / 2;
        const centerX = rect.left + rect.width / 2;
        const centerInView = (centerY >= 0 && centerY <= windowHeight) &&
            (centerX >= 0 && centerX <= windowWidth);

        return (vertInView && horInView); // For general visibility
    }

    private notifyBackgroundNewVideo(video: CapturedVideo) {
        chrome.runtime.sendMessage({
            type: 'NEW_VIDEO_CAPTURED',
            data: video,
        });
    }
}

// Initialize observer
new TikTokObserver();
