/**
 * RESMA - YouTube Feed & Video Observer
 * Captures homepage feed, video telemetry, ads, and recommendation surfaces.
 */

type RecommendationSurface =
    | 'watch-next-sidebar'
    | 'end-screen-overlay'
    | 'shorts-overlay'
    | 'home-feed-grid'
    | 'unknown';

type CaptureSurface = 'watch' | 'shorts' | 'unknown';

interface AdEvent {
    type: 'ad_start' | 'ad_skip' | 'ad_end';
    adId?: string;
    duration?: number;
    skippedAt?: number;
    timestamp: number;
}

interface YouTubeRecommendation {
    position: number;
    videoId: string;
    title: string | null;
    channel: string | null;
    surface: RecommendationSurface;
    surfaces?: RecommendationSurface[];
}

interface YouTubeVideo {
    videoId: string;
    title: string | null;
    channelName: string | null;
    channelHandle: string | null;
    duration: number;
    views: string | null;
    uploadDate: string | null;

    watchTime: number;
    seekCount: number;
    pauseCount: number;
    completed: boolean;

    recommendations: YouTubeRecommendation[];
    adEvents: AdEvent[];
    captureSurface: CaptureSurface;
    timestamp: number;
}

interface HomeFeedItem {
    position: number;
    title: string | null;
    videoId: string;
    channel: string | null;
    section: string | null;
    surface: 'home-feed-grid';
}

interface YouTubeSession {
    sessionId: string;
    startTime: number;
    videos: YouTubeVideo[];
    homeFeedSnapshot: HomeFeedItem[];
}

class YouTubeObserver {
    private session: YouTubeSession;

    private activeVideoId: string | null = null;
    private activeVideoElement: HTMLVideoElement | null = null;
    private maxTimeWatched = 0;
    private lastCurrentTime = 0;

    private isAdPlaying = false;

    constructor() {
        this.session = {
            sessionId: `yt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            startTime: Date.now(),
            videos: [],
            homeFeedSnapshot: [],
        };

        console.log('[RESMA] YouTube Observer initialized');
        this.init();
    }

    private init() {
        if (this.isHomeRoute()) {
            this.snapshotHomeFeed();
        }

        window.addEventListener('yt-navigate-finish', () => {
            this.handleNavigation();
        });

        if (this.getCurrentVideoId()) {
            this.handleNavigation();
        }

        this.setupMessageListener();
    }

    private setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'GET_STATUS') {
                sendResponse({
                    videoCount: this.session.videos.length,
                    active: Boolean(this.activeVideoId),
                });
            }
        });
    }

    private isHomeRoute() {
        return location.pathname === '/';
    }

    private getCurrentCaptureSurface(): CaptureSurface {
        if (location.pathname.startsWith('/shorts/')) {
            return 'shorts';
        }
        if (location.pathname === '/watch') {
            return 'watch';
        }
        return 'unknown';
    }

    private getCurrentVideoId(): string | null {
        if (location.pathname === '/watch') {
            const queryVideoId = new URLSearchParams(location.search).get('v');
            if (queryVideoId) {
                return queryVideoId.trim();
            }
        }

        const shortsMatch = location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,20})/);
        if (shortsMatch?.[1]) {
            return shortsMatch[1];
        }

        return null;
    }

    private handleNavigation() {
        const videoId = this.getCurrentVideoId();
        if (videoId && videoId !== this.activeVideoId) {
            this.finalizeActiveVideo();
            this.startVideoTracking(videoId, this.getCurrentCaptureSurface());
            return;
        }

        if (!videoId) {
            this.finalizeActiveVideo();
            if (this.isHomeRoute()) {
                this.snapshotHomeFeed();
            }
        }
    }

    private snapshotHomeFeed() {
        setTimeout(() => {
            const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer'));
            const feed: HomeFeedItem[] = items
                .map((item, idx) => {
                    const titleAnchor = item.querySelector<HTMLAnchorElement>('#video-title-link, #video-title');
                    const videoId = this.extractVideoIdFromHref(titleAnchor?.href ?? null);
                    if (!videoId) return null;

                    const section = item
                        .closest('ytd-rich-section-renderer')
                        ?.querySelector('#title')
                        ?.textContent
                        ?.trim() ?? null;

                    return {
                        position: idx + 1,
                        title: titleAnchor?.textContent?.trim() || null,
                        videoId,
                        channel: item.querySelector('ytd-channel-name')?.textContent?.trim() || null,
                        section,
                        surface: 'home-feed-grid' as const,
                    };
                })
                .filter((entry): entry is HomeFeedItem => Boolean(entry));

            this.session.homeFeedSnapshot = feed;
            chrome.runtime.sendMessage({
                type: 'YOUTUBE_HOMEPAGE_SNAPSHOT',
                data: feed,
                sessionMetadata: {
                    type: 'HOMEPAGE_SNAPSHOT',
                    captureSurface: 'home-feed-grid',
                    observerVersion: 'youtube-observer-v2',
                    clientSessionId: this.session.sessionId,
                    capturedAt: new Date().toISOString(),
                },
            });
        }, 2000);
    }

    private startVideoTracking(videoId: string, captureSurface: CaptureSurface) {
        console.log(`[RESMA] Tracking video: ${videoId} (${captureSurface})`);
        this.activeVideoId = videoId;
        this.activeVideoElement = document.querySelector('video.html5-main-video');

        if (!this.activeVideoElement) {
            setTimeout(() => {
                if (this.activeVideoId === videoId) {
                    this.startVideoTracking(videoId, captureSurface);
                }
            }, 500);
            return;
        }

        this.maxTimeWatched = 0;
        this.lastCurrentTime = 0;
        this.isAdPlaying = false;

        this.activeVideoElement.addEventListener('timeupdate', this.onTimeUpdate);
        this.activeVideoElement.addEventListener('playing', this.checkAdState);

        const entry: YouTubeVideo = {
            videoId,
            title: document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() || null,
            channelName: document.querySelector('ytd-video-owner-renderer #channel-name')?.textContent?.trim() || null,
            channelHandle: document.querySelector('ytd-video-owner-renderer a[href^="/@"]')?.getAttribute('href') || null,
            duration: this.activeVideoElement.duration,
            views: document.querySelector('ytd-video-primary-info-renderer #count')?.textContent?.trim() || null,
            uploadDate: document.querySelector('#info-strings yt-formatted-string')?.textContent?.trim() || null,
            watchTime: 0,
            seekCount: 0,
            pauseCount: 0,
            completed: false,
            recommendations: [],
            adEvents: [],
            captureSurface,
            timestamp: Date.now(),
        };

        this.session.videos.push(entry);

        setTimeout(() => this.scrapeRecommendations(videoId), 2500);
        setTimeout(() => this.scrapeRecommendations(videoId), 8000);
    }

    private onTimeUpdate = () => {
        if (!this.activeVideoElement || !this.activeVideoId) return;

        const isAd = document.querySelector('.ad-showing') !== null;
        if (isAd) {
            if (!this.isAdPlaying) {
                this.isAdPlaying = true;
                this.recordAdEvent('ad_start');
            }
            return;
        }

        if (this.isAdPlaying) {
            this.isAdPlaying = false;
            this.recordAdEvent('ad_end');
        }

        const currentTime = this.activeVideoElement.currentTime;
        const delta = currentTime - this.lastCurrentTime;

        if (delta > 0 && delta < 2) {
            this.maxTimeWatched += delta;
            this.updateActiveEntry((entry) => {
                entry.watchTime = this.maxTimeWatched;
            });
        } else if (Math.abs(delta) > 2) {
            this.updateActiveEntry((entry) => {
                entry.seekCount += 1;
            });
        }

        this.lastCurrentTime = currentTime;
    };

    private checkAdState = () => {
        const isAd = document.querySelector('.ad-showing') !== null;
        if (isAd && !this.isAdPlaying) {
            this.isAdPlaying = true;
            this.recordAdEvent('ad_start');
        }
    };

    private recordAdEvent(type: 'ad_start' | 'ad_end') {
        const entry = this.getActiveEntry();
        if (!entry) return;

        entry.adEvents.push({
            type,
            timestamp: Date.now(),
        });

        console.log(`[RESMA] Ad Event: ${type}`);
    }

    private scrapeRecommendations(currentVideoId: string) {
        const activeEntry = this.getActiveEntry();
        if (!activeEntry || activeEntry.videoId !== currentVideoId) {
            return;
        }

        const candidates: YouTubeRecommendation[] = [
            ...this.collectFromRenderer(
                'ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer',
                'watch-next-sidebar',
                20
            ),
            ...this.collectFromAnchors(
                '.ytp-ce-element .ytp-ce-covering-overlay[href], .ytp-endscreen-content a.ytp-videowall-still[href]',
                'end-screen-overlay',
                14
            ),
            ...this.collectFromRenderer(
                'ytd-reel-video-renderer ytd-compact-video-renderer, ytd-reel-player-overlay-renderer ytd-compact-video-renderer',
                'shorts-overlay',
                12
            ),
            ...this.collectFromAnchors(
                'ytd-reel-video-renderer a#thumbnail[href], ytd-reel-player-overlay-renderer a#thumbnail[href]',
                'shorts-overlay',
                12
            ),
        ].filter((candidate) => candidate.videoId !== currentVideoId);

        const recommendations = this.mergeRecommendations(candidates, 30);

        this.updateActiveEntry((entry) => {
            if (entry.videoId === currentVideoId) {
                entry.recommendations = recommendations;
            }
        });
    }

    private collectFromRenderer(
        selector: string,
        surface: RecommendationSurface,
        limit: number
    ): YouTubeRecommendation[] {
        const elements = Array.from(document.querySelectorAll(selector)).slice(0, limit);

        return elements
            .map((element, index) => {
                const anchor = element.querySelector<HTMLAnchorElement>(
                    'a#thumbnail[href], a#video-title-link[href], a[href*="/watch"], a[href*="/shorts/"]'
                );
                const videoId = this.extractVideoIdFromHref(anchor?.href ?? null);
                if (!videoId) return null;

                const title =
                    element.querySelector('#video-title')?.textContent?.trim()
                    || element.querySelector('#video-title-link')?.textContent?.trim()
                    || anchor?.getAttribute('title')
                    || null;

                const channel =
                    element.querySelector('.ytd-channel-name')?.textContent?.trim()
                    || element.querySelector('#channel-name')?.textContent?.trim()
                    || null;

                return {
                    position: index + 1,
                    videoId,
                    title,
                    channel,
                    surface,
                };
            })
            .filter((entry): entry is YouTubeRecommendation => Boolean(entry));
    }

    private collectFromAnchors(
        selector: string,
        surface: RecommendationSurface,
        limit: number
    ): YouTubeRecommendation[] {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(selector)).slice(0, limit);

        return anchors
            .map((anchor, index) => {
                const videoId = this.extractVideoIdFromHref(anchor.href);
                if (!videoId) return null;

                const title = anchor.getAttribute('title') || anchor.getAttribute('aria-label') || null;

                return {
                    position: index + 1,
                    videoId,
                    title,
                    channel: null,
                    surface,
                };
            })
            .filter((entry): entry is YouTubeRecommendation => Boolean(entry));
    }

    private mergeRecommendations(recommendations: YouTubeRecommendation[], maxItems: number): YouTubeRecommendation[] {
        const merged = new Map<string, {
            videoId: string;
            position: number;
            title: string | null;
            channel: string | null;
            primarySurface: RecommendationSurface;
            surfaces: Set<RecommendationSurface>;
        }>();

        for (const recommendation of recommendations) {
            const existing = merged.get(recommendation.videoId);
            if (!existing) {
                merged.set(recommendation.videoId, {
                    videoId: recommendation.videoId,
                    position: recommendation.position,
                    title: recommendation.title,
                    channel: recommendation.channel,
                    primarySurface: recommendation.surface,
                    surfaces: new Set([recommendation.surface]),
                });
                continue;
            }

            existing.surfaces.add(recommendation.surface);
            if (recommendation.position < existing.position) {
                existing.position = recommendation.position;
                existing.primarySurface = recommendation.surface;
            }
            if (!existing.title && recommendation.title) {
                existing.title = recommendation.title;
            }
            if (!existing.channel && recommendation.channel) {
                existing.channel = recommendation.channel;
            }
        }

        return Array.from(merged.values())
            .sort((left, right) => left.position - right.position || left.videoId.localeCompare(right.videoId))
            .slice(0, maxItems)
            .map((entry, index) => ({
                position: index + 1,
                videoId: entry.videoId,
                title: entry.title,
                channel: entry.channel,
                surface: entry.primarySurface,
                surfaces: Array.from(entry.surfaces),
            }));
    }

    private extractVideoIdFromHref(href: string | null): string | null {
        if (!href) return null;

        try {
            const parsed = new URL(href, location.origin);
            const fromWatchQuery = parsed.searchParams.get('v');
            if (fromWatchQuery && /^[A-Za-z0-9_-]{6,20}$/.test(fromWatchQuery)) {
                return fromWatchQuery;
            }

            const shortsMatch = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,20})/);
            if (shortsMatch?.[1]) {
                return shortsMatch[1];
            }

            if (parsed.hostname.includes('youtu.be')) {
                const shortPathId = parsed.pathname.replace(/^\/+/, '').split('/')[0];
                if (shortPathId && /^[A-Za-z0-9_-]{6,20}$/.test(shortPathId)) {
                    return shortPathId;
                }
            }
        } catch {
            return null;
        }

        return null;
    }

    private finalizeActiveVideo() {
        if (!this.activeVideoId || !this.activeVideoElement) return;

        console.log(`[RESMA] Finalizing video: ${this.activeVideoId}, watched: ${this.maxTimeWatched.toFixed(1)}s`);

        const finalizedVideoId = this.activeVideoId;

        this.updateActiveEntry((entry) => {
            entry.duration = this.activeVideoElement?.duration || 0;
            if (entry.duration > 0 && (entry.watchTime / entry.duration) > 0.9) {
                entry.completed = true;
            }
        });

        const entry = this.getActiveEntry();
        if (entry) {
            chrome.runtime.sendMessage({
                type: 'YOUTUBE_VIDEO_COMPLETE',
                data: entry,
                sessionMetadata: {
                    type: 'VIDEO_WATCH',
                    captureSurface: entry.captureSurface,
                    observerVersion: 'youtube-observer-v2',
                    clientSessionId: this.session.sessionId,
                    sourceVideoId: entry.videoId,
                    capturedAt: new Date().toISOString(),
                },
            });
        }

        this.activeVideoElement.removeEventListener('timeupdate', this.onTimeUpdate);
        this.activeVideoElement.removeEventListener('playing', this.checkAdState);

        if (this.activeVideoId === finalizedVideoId) {
            this.activeVideoId = null;
        }
        this.activeVideoElement = null;
    }

    private getActiveEntry() {
        return this.session.videos.find((video) => video.videoId === this.activeVideoId);
    }

    private updateActiveEntry(updater: (entry: YouTubeVideo) => void) {
        const entry = this.getActiveEntry();
        if (entry) {
            updater(entry);
        }
    }
}

new YouTubeObserver();
