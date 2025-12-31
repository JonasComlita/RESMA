/**
 * RESMA - Instagram Feed & Reels Observer
 * Hybrid observer for scrolling feed (images/carousel) and Reels (video).
 */

interface InstagramPost {
	id: string; // Post ID
	type: 'image' | 'video' | 'carousel' | 'reel';
	author: string | null;
	caption: string | null;
	timestamp: number;

	// Telemetry
	impressionStartTime: number;
	impressionDuration: number; // For feed posts
	watchTime: number;          // For reels/videos
	loopCount: number;
	isSponsored: boolean;

	// Interaction
	hasInteracted: boolean;
	interactionType: string | null;
}

class InstagramObserver {
	private sessionPosts: Map<string, InstagramPost> = new Map();
	private intersectionObserver: IntersectionObserver;

	// Active Reel State
	private activeReelId: string | null = null;
	private activeVideoElement: HTMLVideoElement | null = null;
	private reelStartTime: number = 0;
	private maxReelTimeWatched: number = 0;

	constructor() {
		console.log('[RESMA] Instagram Observer initialized');

		this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), {
			threshold: 0.6
		});

		this.init();
	}

	private init() {
		// Detect mode based on URL
		this.checkMode();

		// Listen for navigation
		let lastUrl = location.href;
		new MutationObserver(() => {
			if (location.href !== lastUrl) {
				lastUrl = location.href;
				this.checkMode();
			}
		}).observe(document.body, { subtree: true, childList: true });

		// Periodic batch send for Feed
		setInterval(() => this.sendFeedBatch(), 10000);

		// Start observers
		this.startFeedObserver();
		this.startReelsObserver();
	}

	private checkMode() {
		if (location.pathname.includes('/reels/')) {
			console.log('[RESMA] Mode: Reels');
		} else {
			console.log('[RESMA] Mode: Feed');
		}
	}

	// --- FEED LOGIC ---

	private startFeedObserver() {
		// Observe feed articles
		const observer = new MutationObserver((mutations) => {
			mutations.forEach(m => {
				m.addedNodes.forEach(node => {
					if (node instanceof Element) {
						const articles = node.querySelectorAll('article');
						articles.forEach(a => this.observePost(a));
						// Also check if node itself is article
						if (node.matches('article')) this.observePost(node);
					}
				});
			});
		});

		// Main feed container usually in main
		const main = document.querySelector('main');
		if (main) observer.observe(main, { childList: true, subtree: true });

		// Initial scan
		document.querySelectorAll('article').forEach(a => this.observePost(a));
	}

	private observePost(element: Element) {
		// Find ID
		const link = element.querySelector('a[href*="/p/"]');
		const id = link?.getAttribute('href')?.split('/p/')[1]?.split('/')[0];
		if (id) {
			element.setAttribute('data-resma-id', id);
			this.intersectionObserver.observe(element);

			// Interaction listeners
			const likeBtn = element.querySelector('svg[aria-label="Like"]')?.closest('div[role="button"]');
			likeBtn?.addEventListener('click', () => this.recordInteraction(id, 'like'));
		}
	}

	private handleIntersection(entries: IntersectionObserverEntry[]) {
		entries.forEach(entry => {
			const id = entry.target.getAttribute('data-resma-id');
			if (!id) return;

			if (entry.isIntersecting) {
				// Start Impression
				if (!this.sessionPosts.has(id)) {
					const data = this.scrapePostData(entry.target, id);
					if (data) this.sessionPosts.set(id, data);
				}
				const post = this.sessionPosts.get(id);
				if (post) post.impressionStartTime = Date.now();
			} else {
				// End Impression
				const post = this.sessionPosts.get(id);
				if (post && post.impressionStartTime > 0) {
					const duration = (Date.now() - post.impressionStartTime) / 1000;
					post.impressionDuration += duration;
					post.impressionStartTime = 0;
				}
			}
		});
	}

	private scrapePostData(element: Element, id: string): InstagramPost | null {
		try {
			const author = element.querySelector('header a')?.textContent || null;
			const caption = element.querySelector('h1, div > span > div > span')?.textContent || null; // Caption structure varies

			// Sponsored detection: "Sponsored" text usually near header
			const isSponsored = !!Array.from(element.querySelectorAll('span')).find(s => s.textContent === 'Sponsored');

			return {
				id,
				type: 'image', // simplified
				author,
				caption,
				timestamp: Date.now(),
				impressionStartTime: Date.now(),
				impressionDuration: 0,
				watchTime: 0,
				loopCount: 0,
				isSponsored,
				hasInteracted: false,
				interactionType: null
			};
		} catch (e) {
			return null;
		}
	}

	private sendFeedBatch() {
		const batch = [];
		for (const [id, post] of this.sessionPosts.entries()) {
			if (post.impressionDuration > 1 || post.hasInteracted) {
				if (post.impressionStartTime > 0) {
					post.impressionDuration += (Date.now() - post.impressionStartTime) / 1000;
					post.impressionStartTime = Date.now();
				}
				batch.push({ ...post });
			}
		}
		if (batch.length > 0) {
			chrome.runtime.sendMessage({
				type: 'INSTAGRAM_FEED_SNAPSHOT',
				data: batch
			});
		}
	}

	private recordInteraction(id: string, type: string) {
		const post = this.sessionPosts.get(id);
		if (post) {
			post.hasInteracted = true;
			post.interactionType = type;
		}
	}

	// --- REELS LOGIC ---

	private startReelsObserver() {
		// Watch for video elements being added/removed
		// Reels structure is dynamic. We look for <video> in main.
		new MutationObserver((mutations) => {
			// Heuristic: check if we are on a reel URL
			if (location.pathname.includes('/reels/')) {
				this.checkActiveReel();
			}
		}).observe(document.body, { childList: true, subtree: true });
	}

	private checkActiveReel() {
		// Find visible video
		const videos = Array.from(document.querySelectorAll('video'));
		// The one playing is likely the active one
		const activeVid = videos.find(v => !v.paused && v.style.display !== 'none');

		if (activeVid && activeVid !== this.activeVideoElement) {
			this.handleReelChange(activeVid);
		}
	}

	private handleReelChange(video: HTMLVideoElement) {
		if (this.activeVideoElement) {
			this.finalizeReel(); // Finish previous
		}

		const reelId = location.pathname.split('/reels/')[1]?.split('/')[0] || 'unknown';
		console.log(`[RESMA] Tracking Reel: ${reelId}`);

		this.activeVideoElement = video;
		this.activeReelId = reelId;
		this.reelStartTime = Date.now();
		this.maxReelTimeWatched = 0;

		this.activeVideoElement.addEventListener('timeupdate', this.onReelTimeUpdate);
	}

	private onReelTimeUpdate = () => {
		if (this.activeVideoElement) {
			// Simple watch time tracking
			this.maxReelTimeWatched = Math.max(this.maxReelTimeWatched, this.activeVideoElement.currentTime);
		}
	}

	private finalizeReel() {
		if (this.activeVideoElement && this.activeReelId) {
			console.log(`[RESMA] Finalizing Reel: ${this.activeReelId}`);

			// Build payload
			const reelData: InstagramPost = {
				id: this.activeReelId,
				type: 'reel',
				author: null, // Hard to scrape from overlay sometimes
				caption: null,
				timestamp: Date.now(),
				impressionStartTime: 0,
				impressionDuration: 0,
				watchTime: this.maxReelTimeWatched,
				loopCount: 0, // Implement later
				isSponsored: false, // Check overlay for "Sponsored"
				hasInteracted: false,
				interactionType: null
			};

			// Send immediately
			chrome.runtime.sendMessage({
				type: 'INSTAGRAM_REEL_COMPLETE',
				data: reelData
			});

			this.activeVideoElement.removeEventListener('timeupdate', this.onReelTimeUpdate);
			this.activeVideoElement = null;
			this.activeReelId = null;
		}
	}
}

new InstagramObserver();
