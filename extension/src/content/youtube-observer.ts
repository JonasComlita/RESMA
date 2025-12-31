/**
 * RESMA - YouTube Feed & Video Observer
 * Captures homepage feed, video telemetry, ads, and recommendations.
 */

interface AdEvent {
	type: 'ad_start' | 'ad_skip' | 'ad_end';
	adId?: string; // Often hard to get, might use current video ID if available
	duration?: number;
	skippedAt?: number;
	timestamp: number;
}

interface YouTubeVideo {
	videoId: string;
	title: string | null;
	channelName: string | null;
	channelHandle: string | null;
	duration: number;
	views: string | null;
	uploadDate: string | null;

	// Telemetry
	watchTime: number; // Actual seconds watched
	seekCount: number;
	pauseCount: number;
	completed: boolean;

	// Recommendations (Sidebar)
	recommendations: any[];

	// Ad Exposure during this video
	adEvents: AdEvent[];

	timestamp: number;
}

interface YouTubeSession {
	startTime: number;
	videos: YouTubeVideo[];
	homeFeedSnapshot: any[]; // Data from the homepage grid
}

class YouTubeObserver {
	private session: YouTubeSession;
	private videoObserver: MutationObserver | null = null; // Watches for player state changes

	// Active Video State
	private activeVideoId: string | null = null;
	private activeVideoElement: HTMLVideoElement | null = null;
	private videoStartTime: number = 0;
	private maxTimeWatched: number = 0;
	private lastCurrentTime: number = 0;

	// Ad State
	private isAdPlaying: boolean = false;
	private currentAdStart: number = 0;

	constructor() {
		this.session = {
			startTime: Date.now(),
			videos: [],
			homeFeedSnapshot: []
		};

		console.log('[RESMA] YouTube Observer initialized');
		this.init();
	}

	private init() {
		// 1. Snapshot Home Feed if on homepage
		if (location.pathname === '/') {
			this.snapshotHomeFeed();
		}

		// 2. Setup Navigation Listener (YouTube is a SPA)
		// YouTube fires 'yt-navigate-finish' event on internal navigation
		window.addEventListener('yt-navigate-finish', () => {
			this.handleNavigation();
		});

		// 3. Initial check in case we loaded directly on a video
		if (location.pathname === '/watch') {
			this.handleNavigation();
		}

		this.setupMessageListener();
	}

	private setupMessageListener() {
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			if (message.type === 'GET_STATUS') {
				sendResponse({
					videoCount: this.session.videos.length,
					active: !!this.activeVideoId
				});
			}
		});
	}

	private handleNavigation() {
		const urlParams = new URLSearchParams(location.search);
		const videoId = urlParams.get('v');

		if (videoId && videoId !== this.activeVideoId) {
			// Finalize previous video if exists
			this.finalizeActiveVideo();

			// Start new video tracking
			this.startVideoTracking(videoId);
		} else if (!videoId) {
			// Probably went back to home or channel page
			this.finalizeActiveVideo();
		}
	}

	private snapshotHomeFeed() {
		// Basic delay to ensure grid loaded
		setTimeout(() => {
			const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer'));
			const feed = items.map((item, idx) => {
				const titleEl = item.querySelector('#video-title');
				return {
					position: idx + 1,
					title: titleEl?.textContent?.trim(),
					videoId: (titleEl as HTMLAnchorElement)?.href?.split('v=')[1]?.split('&')[0],
					channel: item.querySelector('ytd-channel-name')?.textContent?.trim()
				};
			}).filter(i => i.videoId);

			this.session.homeFeedSnapshot = feed;
			// Optionally send immediately
			chrome.runtime.sendMessage({ type: 'YOUTUBE_HOMEPAGE_SNAPSHOT', data: feed });
		}, 2000);
	}

	private startVideoTracking(videoId: string) {
		console.log(`[RESMA] Tracking video: ${videoId}`);
		this.activeVideoId = videoId;
		this.activeVideoElement = document.querySelector('video.html5-main-video');

		if (!this.activeVideoElement) {
			// Retry if video element not ready (rare on SPA nav but possible on refresh)
			setTimeout(() => this.startVideoTracking(videoId), 500);
			return;
		}

		// Reset Telemetry
		this.videoStartTime = Date.now();
		this.maxTimeWatched = 0;
		this.lastCurrentTime = 0;
		this.isAdPlaying = false;

		// Attach Listeners
		this.activeVideoElement.addEventListener('timeupdate', this.onTimeUpdate);
		this.activeVideoElement.addEventListener('playing', this.checkAdState);

		// Create initial entry in session
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
			recommendations: [], // To be populated
			adEvents: [],
			timestamp: Date.now()
		};

		this.session.videos.push(entry);

		// Scrape sidebar recommendations after a delay
		setTimeout(() => this.scrapeSidebar(videoId), 3000);
	}

	private onTimeUpdate = () => {
		if (!this.activeVideoElement || !this.activeVideoId) return;

		// Check for Ad
		const isAd = document.querySelector('.ad-showing') !== null;

		if (isAd) {
			if (!this.isAdPlaying) {
				this.isAdPlaying = true;
				this.recordAdEvent('ad_start');
			}
			return; // Don't track watch time for main video if ad is playing
		} else {
			if (this.isAdPlaying) {
				this.isAdPlaying = false;
				this.recordAdEvent('ad_end');
			}
		}

		const currentTime = this.activeVideoElement.currentTime;

		// Logic to track "Max Time Watched" linearly
		// If we moved forward by ~0.2-1.0s, we watched that chunk.
		// If jump is large (>2s), it's a seek.
		const delta = currentTime - this.lastCurrentTime;

		if (delta > 0 && delta < 2) {
			this.maxTimeWatched += delta;
			this.updateActiveEntry(entry => entry.watchTime = this.maxTimeWatched);
		} else if (Math.abs(delta) > 2) {
			this.updateActiveEntry(entry => entry.seekCount++);
		}

		this.lastCurrentTime = currentTime;
	};

	private checkAdState = () => {
		// Triggered on 'playing' event to catch start of content or ad
		const isAd = document.querySelector('.ad-showing') !== null;
		if (isAd && !this.isAdPlaying) {
			this.isAdPlaying = true;
			this.recordAdEvent('ad_start');
		}
	};

	private recordAdEvent(type: 'ad_start' | 'ad_end') {
		const entry = this.getActiveEntry();
		if (entry) {
			entry.adEvents.push({
				type,
				timestamp: Date.now()
			});
			console.log(`[RESMA] Ad Event: ${type}`);
		}
	}

	private scrapeSidebar(currentVideoId: string) {
		const sidebarItems = document.querySelectorAll('ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer');
		const recommendations = Array.from(sidebarItems).slice(0, 10).map((item, idx) => ({
			position: idx + 1,
			videoId: item.querySelector('a')?.href?.split('v=')[1]?.split('&')[0],
			title: item.querySelector('#video-title')?.textContent?.trim(),
			channel: item.querySelector('.ytd-channel-name')?.textContent?.trim()
		}));

		this.updateActiveEntry(entry => {
			if (entry.videoId === currentVideoId) {
				entry.recommendations = recommendations;
			}
		});
	}

	private finalizeActiveVideo() {
		if (!this.activeVideoId || !this.activeVideoElement) return;

		console.log(`[RESMA] Finalizing video: ${this.activeVideoId}, Watched: ${this.maxTimeWatched.toFixed(1)}s`);

		// 1. Update final duration if it was 0 initially
		this.updateActiveEntry(entry => {
			entry.duration = this.activeVideoElement?.duration || 0;
			if (entry.watchTime / entry.duration > 0.9) entry.completed = true;
		});

		// 2. Send to background immediately (streaming approach)
		const entry = this.getActiveEntry();
		if (entry) {
			chrome.runtime.sendMessage({ type: 'YOUTUBE_VIDEO_COMPLETE', data: entry });
		}

		// 3. Cleanup
		this.activeVideoElement.removeEventListener('timeupdate', this.onTimeUpdate);
		this.activeVideoElement.removeEventListener('playing', this.checkAdState);
		this.activeVideoId = null;
		this.activeVideoElement = null;
	}

	private getActiveEntry() {
		return this.session.videos.find(v => v.videoId === this.activeVideoId);
	}

	private updateActiveEntry(updater: (entry: YouTubeVideo) => void) {
		const entry = this.getActiveEntry();
		if (entry) updater(entry);
	}
}

new YouTubeObserver();
