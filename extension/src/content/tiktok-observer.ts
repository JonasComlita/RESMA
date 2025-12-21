/**
 * RESMA - TikTok Feed Observer
 * Content script that observes the TikTok feed and captures video data
 */

interface CapturedVideo {
    videoId: string;
    creatorHandle: string | null;
    creatorId: string | null;
    caption: string | null;
    musicTitle: string | null;
    position: number;
    capturedAt: number;
    isVisible: boolean;
}

interface FeedSession {
    startTime: number;
    videos: CapturedVideo[];
    scrollEvents: number;
}

class TikTokObserver {
    private session: FeedSession;
    private observer: MutationObserver | null = null;
    private isCapturing = false;
    private seenVideoIds = new Set<string>();

    constructor() {
        this.session = this.createNewSession();
        this.setupMessageListener();
        console.log('[RESMA] TikTok Observer initialized');
    }

    private createNewSession(): FeedSession {
        return {
            startTime: Date.now(),
            videos: [],
            scrollEvents: 0,
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
                    const data = this.stopCapture();
                    sendResponse({ success: true, data });
                    break;
                case 'GET_STATUS':
                    sendResponse({
                        isCapturing: this.isCapturing,
                        videoCount: this.session.videos.length,
                    });
                    break;
            }
            return true; // Keep channel open for async response
        });
    }

    startCapture() {
        if (this.isCapturing) return;

        this.session = this.createNewSession();
        this.seenVideoIds.clear();
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

        // Track scroll events
        window.addEventListener('scroll', this.handleScroll);

        console.log('[RESMA] Capture started');
    }

    private handleScroll = () => {
        if (this.isCapturing) {
            this.session.scrollEvents++;
            this.scanForVideos();
        }
    };

    stopCapture(): FeedSession {
        this.isCapturing = false;

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        window.removeEventListener('scroll', this.handleScroll);

        console.log(`[RESMA] Capture stopped. ${this.session.videos.length} videos captured`);
        return this.session;
    }

    private scanForVideos() {
        // TikTok video items
        const videoElements = document.querySelectorAll('[data-e2e="recommend-list-item-container"]');

        videoElements.forEach((element, index) => {
            const video = this.extractVideoData(element as HTMLElement, index);
            if (video && !this.seenVideoIds.has(video.videoId)) {
                this.seenVideoIds.add(video.videoId);
                this.session.videos.push(video);
                this.notifyBackgroundNewVideo(video);
            }
        });
    }

    private extractVideoData(element: HTMLElement, position: number): CapturedVideo | null {
        try {
            // Get video ID from link
            const videoLink = element.querySelector('a[href*="/video/"]');
            const videoId = videoLink?.getAttribute('href')?.match(/\/video\/(\d+)/)?.[1];

            if (!videoId) return null;

            // Get creator info
            const creatorLink = element.querySelector('a[href*="/@"]');
            const creatorHandle = creatorLink?.getAttribute('href')?.replace('/', '') || null;

            // Get caption
            const captionEl = element.querySelector('[data-e2e="video-desc"]');
            const caption = captionEl?.textContent?.trim() || null;

            // Get music
            const musicEl = element.querySelector('[data-e2e="video-music"]');
            const musicTitle = musicEl?.textContent?.trim() || null;

            return {
                videoId,
                creatorHandle,
                creatorId: null, // Would need API access
                caption,
                musicTitle,
                position,
                capturedAt: Date.now(),
                isVisible: this.isElementVisible(element),
            };
        } catch (error) {
            console.error('[RESMA] Error extracting video data:', error);
            return null;
        }
    }

    private isElementVisible(element: HTMLElement): boolean {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
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
