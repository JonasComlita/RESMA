/**
 * RESMA - Reddit Feed Observer
 * Captures Reddit post impressions, interactions, and video watch time.
 */
import {
    CURRENT_INGEST_VERSION,
    CURRENT_OBSERVER_VERSIONS,
    normalizeRedditPostId,
    normalizeSubredditName,
} from '@resma/shared';

type RedditPostType = 'text' | 'link' | 'image' | 'gallery' | 'video' | 'poll' | 'crosspost';

interface RedditPost {
    postId: string;
    url: string | null;
    subreddit: string;
    authorHandle: string | null;
    title: string | null;
    type: RedditPostType | 'unknown';
    score: number | null;
    comments: number | null;
    upvoteRatio: number | null;
    awardCount: number;
    flair: string | null;
    domain: string | null;
    isNsfw: boolean;
    isSpoiler: boolean;
    isCrosspost: boolean;
    crosspostParentId: string | null;
    isPromoted: boolean;
    timestamp: number;
    impressionStartTime: number;
    impressionDuration: number;
    watchTime: number;
    lastUploadedImpressionDuration: number;
    lastUploadedWatchTime: number;
    hasInteracted: boolean;
    interactionType: string | null;
    lastUploadedInteractionType: string | null;
    position: number;
}

interface RedditUploadPayload {
    videoId: string;
    postId: string;
    id: string;
    url: string | null;
    creatorHandle: string;
    subreddit: string;
    caption: string | null;
    title: string | null;
    position: number;
    watchDuration: number;
    watchTime: number;
    interacted: boolean;
    hasInteracted: boolean;
    interactionType: string | null;
    likesCount: number | null;
    score: number | null;
    upvotes: number | null;
    commentsCount: number | null;
    comments: number | null;
    numComments: number | null;
    sharesCount: null;
    contentCategories: string[];
    type: RedditPostType | 'unknown';
    postType: RedditPostType | 'unknown';
    authorHandle: string | null;
    author: string | null;
    upvoteRatio: number | null;
    awardCount: number;
    flair: string | null;
    linkFlair: string | null;
    isNsfw: boolean;
    over18: boolean;
    isSpoiler: boolean;
    isCrosspost: boolean;
    crosspostParentId: string | null;
    domain: string | null;
    isPromoted: boolean;
    isAd: boolean;
    engagementMetrics: Record<string, unknown>;
}

class RedditObserver {
    private observedPosts = new Set<Element>();
    private sessionPosts: Map<string, RedditPost> = new Map();
    private intersectionObserver: IntersectionObserver;
    private mutationObserver: MutationObserver | null = null;
    private batchTimer: number | null = null;
    private clientSessionId = `rd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    private isCapturing = false;
    private videoState = new WeakMap<HTMLVideoElement, { postId: string; lastCurrentTime: number }>();

    constructor() {
        console.log('[RESMA] Reddit Observer initialized');
        this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), {
            threshold: 0.55,
        });
        this.setupMessageListener();
    }

    private setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'GET_STATUS') {
                sendResponse({
                    isCapturing: this.isCapturing,
                    itemCount: this.sessionPosts.size,
                });
                return true;
            }

            if (message.type === 'START_CAPTURE') {
                this.startCapture();
                sendResponse({ success: true, data: { itemCount: this.sessionPosts.size } });
                return true;
            }

            if (message.type === 'STOP_CAPTURE') {
                void this.stopCapture().then((itemCount) => {
                    sendResponse({ success: true, data: { itemCount } });
                });
                return true;
            }

            return false;
        });
    }

    private startCapture() {
        if (this.isCapturing) {
            return;
        }

        this.isCapturing = true;
        this.clientSessionId = `rd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        this.observedPosts.clear();
        this.sessionPosts.clear();
        this.intersectionObserver.disconnect();
        this.init();
    }

    private async stopCapture(): Promise<number> {
        if (!this.isCapturing) {
            return this.sessionPosts.size;
        }

        await this.sendBatch(true);
        this.isCapturing = false;

        if (this.batchTimer !== null) {
            window.clearInterval(this.batchTimer);
            this.batchTimer = null;
        }

        this.mutationObserver?.disconnect();
        this.mutationObserver = null;
        this.intersectionObserver.disconnect();

        return this.sessionPosts.size;
    }

    private init() {
        if (location.hostname === 'old.reddit.com') {
            console.log('[RESMA] old.reddit.com detected; Reddit observer is scoped to www.reddit.com');
            return;
        }

        const feedRoot = document.querySelector('main, shreddit-app, faceplate-batch') || document.body;
        this.mutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof Element) {
                        this.processNode(node);
                    }
                });
            }
        });

        this.mutationObserver.observe(feedRoot, { childList: true, subtree: true });
        this.scanForPosts();
        this.batchTimer = window.setInterval(() => {
            void this.sendBatch(false);
        }, 10_000);
    }

    private scanForPosts() {
        this.getPostElements(document).forEach((element) => this.observePost(element));
    }

    private processNode(node: Element) {
        if (this.isPostElement(node)) {
            this.observePost(node);
            return;
        }

        this.getPostElements(node).forEach((element) => this.observePost(element));
    }

    private getPostElements(root: ParentNode): Element[] {
        return Array.from(root.querySelectorAll(
            'shreddit-post, article[data-testid="post-container"], div[data-testid="post-container"], div[data-testid="post"]'
        ));
    }

    private isPostElement(element: Element): boolean {
        return element.matches(
            'shreddit-post, article[data-testid="post-container"], div[data-testid="post-container"], div[data-testid="post"]'
        );
    }

    private observePost(element: Element) {
        if (this.observedPosts.has(element)) {
            return;
        }

        const postId = this.getPostId(element);
        if (!postId) {
            return;
        }

        this.observedPosts.add(element);
        element.setAttribute('data-resma-reddit-post-id', postId);
        this.attachInteractionListeners(element);
        this.attachVideoListeners(element, postId);
        this.intersectionObserver.observe(element);
    }

    private handleIntersection(entries: IntersectionObserverEntry[]) {
        if (!this.isCapturing) {
            return;
        }

        entries.forEach((entry) => {
            const element = entry.target;
            const postId = element.getAttribute('data-resma-reddit-post-id') ?? this.getPostId(element);
            if (!postId) {
                return;
            }

            if (entry.isIntersecting) {
                if (!this.sessionPosts.has(postId)) {
                    const data = this.scrapePostData(element, postId);
                    if (data) {
                        this.sessionPosts.set(postId, data);
                    }
                }

                const post = this.sessionPosts.get(postId);
                if (post) {
                    post.impressionStartTime = Date.now();
                }
                return;
            }

            const post = this.sessionPosts.get(postId);
            if (post && post.impressionStartTime > 0) {
                post.impressionDuration += (Date.now() - post.impressionStartTime) / 1000;
                post.impressionStartTime = 0;
            }
        });
    }

    private attachInteractionListeners(element: Element) {
        const interactionTargets: Array<{ selector: string; type: string }> = [
            { selector: '[aria-label*="upvote" i], button[upvote], faceplate-tracker[noun="upvote"]', type: 'upvote' },
            { selector: '[aria-label*="downvote" i], button[downvote], faceplate-tracker[noun="downvote"]', type: 'downvote' },
            { selector: 'a[href*="/comments/"], [aria-label*="comment" i], faceplate-tracker[noun="comment"]', type: 'comment' },
            { selector: '[aria-label*="share" i], faceplate-tracker[noun="share"]', type: 'share' },
            { selector: '[aria-label*="save" i], faceplate-tracker[noun="save"]', type: 'save' },
        ];

        for (const target of interactionTargets) {
            element.querySelectorAll(target.selector).forEach((node) => {
                node.addEventListener('click', () => this.recordInteraction(element, target.type));
            });
        }
    }

    private attachVideoListeners(element: Element, postId: string) {
        element.querySelectorAll('video').forEach((video) => {
            if (this.videoState.has(video)) {
                return;
            }

            this.videoState.set(video, { postId, lastCurrentTime: 0 });
            video.addEventListener('timeupdate', () => {
                const state = this.videoState.get(video);
                if (!state) {
                    return;
                }

                const currentTime = video.currentTime;
                const delta = currentTime - state.lastCurrentTime;
                if (delta > 0 && delta < 5) {
                    const post = this.sessionPosts.get(state.postId);
                    if (post) {
                        post.watchTime += delta;
                        post.type = 'video';
                    }
                }
                state.lastCurrentTime = currentTime;
            });
        });
    }

    private recordInteraction(element: Element, type: string) {
        if (!this.isCapturing) {
            return;
        }

        const postId = element.getAttribute('data-resma-reddit-post-id') ?? this.getPostId(element);
        if (!postId) {
            return;
        }

        if (!this.sessionPosts.has(postId)) {
            const data = this.scrapePostData(element, postId);
            if (data) {
                this.sessionPosts.set(postId, data);
            }
        }

        const post = this.sessionPosts.get(postId);
        if (post) {
            post.hasInteracted = true;
            post.interactionType = type;
            console.log(`[RESMA] Reddit interaction: ${type} on ${postId}`);
        }
    }

    private scrapePostData(element: Element, postId: string): RedditPost | null {
        const subreddit = this.getSubreddit(element);
        if (!subreddit) {
            return null;
        }

        const type = this.inferPostType(element);
        const isPromoted = this.isPromotedPost(element);
        const isNsfw = this.hasBooleanSignal(element, ['over-18', 'nsfw']) || this.textIncludes(element, 'nsfw');
        const isSpoiler = this.hasBooleanSignal(element, ['spoiler']) || this.textIncludes(element, 'spoiler');
        const crosspostParentId = this.getCrosspostParentId(element);

        return {
            postId,
            url: this.getPermalink(element, postId),
            subreddit,
            authorHandle: this.getAuthorHandle(element),
            title: this.getTitle(element),
            type,
            score: this.getScore(element),
            comments: this.getCommentCount(element),
            upvoteRatio: this.getUpvoteRatio(element),
            awardCount: this.getAwardCount(element),
            flair: this.getFlair(element),
            domain: this.getDomain(element),
            isNsfw,
            isSpoiler,
            isCrosspost: type === 'crosspost' || Boolean(crosspostParentId),
            crosspostParentId,
            isPromoted,
            timestamp: Date.now(),
            impressionStartTime: Date.now(),
            impressionDuration: 0,
            watchTime: 0,
            lastUploadedImpressionDuration: 0,
            lastUploadedWatchTime: 0,
            hasInteracted: false,
            interactionType: null,
            lastUploadedInteractionType: null,
            position: this.sessionPosts.size,
        };
    }

    private async sendBatch(force: boolean): Promise<boolean> {
        if (!this.isCapturing) {
            return false;
        }

        const pendingUploads: Array<{
            post: RedditPost;
            nextUploadedImpressionDuration: number;
            nextUploadedWatchTime: number;
            nextUploadedInteractionType: string | null;
            payload: RedditUploadPayload;
        }> = [];

        for (const post of this.sessionPosts.values()) {
            const currentlyVisibleDuration = post.impressionStartTime > 0
                ? (Date.now() - post.impressionStartTime) / 1000
                : 0;
            const totalImpressionDuration = post.impressionDuration + currentlyVisibleDuration;
            const unsentImpressionDuration = Math.max(
                0,
                totalImpressionDuration - post.lastUploadedImpressionDuration
            );
            const unsentWatchTime = Math.max(0, post.watchTime - post.lastUploadedWatchTime);
            const hasNewInteraction = Boolean(post.interactionType)
                && post.interactionType !== post.lastUploadedInteractionType;

            if (!force && unsentImpressionDuration <= 1 && unsentWatchTime <= 1 && !hasNewInteraction) {
                continue;
            }

            pendingUploads.push({
                post,
                nextUploadedImpressionDuration: totalImpressionDuration,
                nextUploadedWatchTime: post.watchTime,
                nextUploadedInteractionType: hasNewInteraction ? post.interactionType : post.lastUploadedInteractionType,
                payload: this.toUploadPayload(post, pendingUploads.length, unsentImpressionDuration, unsentWatchTime, hasNewInteraction),
            });
        }

        if (pendingUploads.length === 0) {
            return true;
        }

        console.log(`[RESMA] Sending Reddit batch of ${pendingUploads.length} posts`);
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'UPLOAD_PLATFORM_FEED',
                payload: {
                    platform: 'reddit',
                    feed: pendingUploads.map((entry) => entry.payload),
                    sessionMetadata: {
                        type: 'REDDIT_FEED_SNAPSHOT',
                        captureSurface: this.getCaptureSurface(),
                        subreddit: this.getCurrentSubreddit(),
                        feedSort: this.getFeedSort(),
                        clientSessionId: this.clientSessionId,
                        observerVersion: CURRENT_OBSERVER_VERSIONS.reddit,
                        ingestVersion: CURRENT_INGEST_VERSION,
                        uploadEvent: 'REDDIT_FEED_SNAPSHOT',
                        capturedAt: new Date().toISOString(),
                    },
                },
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[RESMA] Reddit upload callback failed:', chrome.runtime.lastError.message);
                    resolve(false);
                    return;
                }

                const success = Boolean(response?.success);
                if (success) {
                    for (const entry of pendingUploads) {
                        entry.post.lastUploadedImpressionDuration = entry.nextUploadedImpressionDuration;
                        entry.post.lastUploadedWatchTime = entry.nextUploadedWatchTime;
                        entry.post.lastUploadedInteractionType = entry.nextUploadedInteractionType;
                    }
                }
                resolve(success);
            });
        });
    }

    private toUploadPayload(
        post: RedditPost,
        index: number,
        impressionDuration: number,
        watchTime: number,
        hasNewInteraction: boolean
    ): RedditUploadPayload {
        const watchDuration = post.type === 'video' ? Math.max(0, post.watchTime) : 0;

        return {
            videoId: post.postId,
            postId: post.postId,
            id: post.postId,
            url: post.url,
            creatorHandle: post.subreddit,
            subreddit: post.subreddit,
            caption: post.title,
            title: post.title,
            position: Number.isFinite(post.position) ? post.position : index,
            watchDuration,
            watchTime: watchDuration,
            interacted: hasNewInteraction,
            hasInteracted: hasNewInteraction,
            interactionType: hasNewInteraction ? post.interactionType : null,
            likesCount: post.score,
            score: post.score,
            upvotes: post.score,
            commentsCount: post.comments,
            comments: post.comments,
            numComments: post.comments,
            sharesCount: null,
            contentCategories: this.getContentCategories(post),
            type: post.type,
            postType: post.type,
            authorHandle: post.authorHandle,
            author: post.authorHandle,
            upvoteRatio: post.upvoteRatio,
            awardCount: post.awardCount,
            flair: post.flair,
            linkFlair: post.flair,
            isNsfw: post.isNsfw,
            over18: post.isNsfw,
            isSpoiler: post.isSpoiler,
            isCrosspost: post.isCrosspost,
            crosspostParentId: post.crosspostParentId,
            domain: post.domain ?? post.url,
            isPromoted: post.isPromoted,
            isAd: post.isPromoted,
            engagementMetrics: {
                impressionDuration,
                watchTime,
                score: post.score,
                commentCount: post.comments,
                upvoteRatio: post.upvoteRatio,
                awardCount: post.awardCount,
                postType: post.type,
                authorHandle: post.authorHandle,
                subreddit: post.subreddit,
                flair: post.flair,
                isNsfw: post.isNsfw,
                isSpoiler: post.isSpoiler,
                isCrosspost: post.isCrosspost,
                crosspostParentId: post.crosspostParentId,
                domain: post.domain ?? post.url,
                isPromoted: post.isPromoted,
                timestamp: post.timestamp,
            },
        };
    }

    private getContentCategories(post: RedditPost): string[] {
        const categories = new Set<string>();
        if (post.type !== 'unknown') categories.add(post.type);
        categories.add(post.subreddit.toLowerCase());
        if (post.isPromoted) categories.add('promoted');
        if (post.isNsfw) categories.add('nsfw');
        if (post.isSpoiler) categories.add('spoiler');
        const flair = this.normalizeFlair(post.flair);
        if (flair) categories.add(flair);
        return Array.from(categories);
    }

    private getPostId(element: Element): string | null {
        const candidates = [
            element.getAttribute('id'),
            element.getAttribute('post-id'),
            element.getAttribute('thingid'),
            element.getAttribute('data-fullname'),
            element.getAttribute('data-post-id'),
            element.querySelector('[id^="t3_"]')?.getAttribute('id'),
        ];

        for (const candidate of candidates) {
            const postId = normalizeRedditPostId(candidate);
            if (postId) {
                return postId;
            }
        }

        for (const anchor of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/comments/"]'))) {
            const postId = normalizeRedditPostId(anchor.href || anchor.getAttribute('href'));
            if (postId) {
                return postId;
            }
        }

        return null;
    }

    private getPermalink(element: Element, postId: string): string | null {
        const attrPermalink = element.getAttribute('permalink') ?? element.getAttribute('data-permalink');
        if (attrPermalink) {
            return new URL(attrPermalink, location.origin).toString();
        }

        const anchor = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/comments/"]'))
            .find((candidate) => normalizeRedditPostId(candidate.href || candidate.getAttribute('href')) === postId);
        if (!anchor) {
            return null;
        }

        return new URL(anchor.getAttribute('href') ?? anchor.href, location.origin).toString();
    }

    private getTitle(element: Element): string | null {
        return this.sanitizeString(
            element.getAttribute('post-title')
            ?? element.querySelector('[slot="title"]')?.textContent
            ?? element.querySelector('[data-testid="post-title"]')?.textContent
            ?? element.querySelector('h3')?.textContent
            ?? element.querySelector('a[id^="post-title"]')?.textContent
        );
    }

    private getSubreddit(element: Element): string | null {
        const fromAttribute = normalizeSubredditName(
            element.getAttribute('subreddit-name')
            ?? element.getAttribute('subreddit-prefixed-name')
            ?? element.getAttribute('data-subreddit')
        );
        if (fromAttribute) {
            return fromAttribute;
        }

        const subredditAnchor = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/r/"]'))
            .map((anchor) => normalizeSubredditName(anchor.textContent) ?? normalizeSubredditName(anchor.getAttribute('href')))
            .find((value): value is string => Boolean(value));
        if (subredditAnchor) {
            return subredditAnchor;
        }

        return this.getCurrentSubreddit();
    }

    private getAuthorHandle(element: Element): string | null {
        const raw = this.sanitizeString(
            element.getAttribute('author')
            ?? element.getAttribute('author-name')
            ?? element.querySelector('a[href*="/user/"], a[href*="/u/"]')?.textContent
        );
        if (!raw) {
            return null;
        }

        const withoutPrefix = raw.replace(/^\/?u\//i, '').replace(/^@/, '');
        return withoutPrefix ? `u/${withoutPrefix}` : null;
    }

    private inferPostType(element: Element): RedditPostType | 'unknown' {
        const rawType = this.sanitizeString(
            element.getAttribute('post-type')
            ?? element.getAttribute('type')
            ?? element.getAttribute('data-post-type')
        )?.toLowerCase();
        if (rawType) {
            if (rawType === 'self') return 'text';
            if (rawType === 'hosted:video' || rawType === 'rich:video') return 'video';
            if (rawType === 'multi_media') return 'gallery';
            if (this.isKnownPostType(rawType)) return rawType;
        }

        if (this.getCrosspostParentId(element) || this.textIncludes(element, 'crossposted')) return 'crosspost';
        if (element.querySelector('shreddit-poll, [data-testid*="poll" i]')) return 'poll';
        if (element.querySelector('gallery-carousel, shreddit-gallery-carousel, [data-testid*="gallery" i]')) return 'gallery';
        if (element.querySelector('video, shreddit-player, shreddit-async-loader[bundlename*="video" i]')) return 'video';
        if (element.querySelector('img[alt], figure img, shreddit-aspect-ratio img')) return 'image';

        const outbound = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]'))
            .find((anchor) => {
                const href = anchor.getAttribute('href') ?? '';
                return href.startsWith('http') && !href.includes('reddit.com');
            });
        if (outbound) {
            return 'link';
        }

        return this.getTitle(element) ? 'text' : 'unknown';
    }

    private isKnownPostType(value: string): value is RedditPostType {
        return ['text', 'link', 'image', 'gallery', 'video', 'poll', 'crosspost'].includes(value);
    }

    private getScore(element: Element): number | null {
        return this.parseCount(
            element.getAttribute('score')
            ?? element.getAttribute('data-score')
            ?? element.querySelector('[id*="vote-arrows"] [slot="score"], [data-testid="post-score"], faceplate-number')?.textContent
        );
    }

    private getCommentCount(element: Element): number | null {
        return this.parseCount(
            element.getAttribute('comment-count')
            ?? element.getAttribute('comments-count')
            ?? element.querySelector('[aria-label*="comment" i], a[href*="/comments/"]')?.textContent
        );
    }

    private getUpvoteRatio(element: Element): number | null {
        const raw = this.sanitizeString(element.getAttribute('upvote-ratio') ?? element.getAttribute('data-upvote-ratio'));
        if (!raw) {
            return null;
        }
        const parsed = Number.parseFloat(raw.replace('%', ''));
        if (!Number.isFinite(parsed) || parsed < 0) {
            return null;
        }
        return raw.includes('%') ? parsed / 100 : parsed;
    }

    private getAwardCount(element: Element): number {
        return this.parseCount(
            element.getAttribute('award-count')
            ?? element.getAttribute('total-awards-received')
            ?? element.querySelector('[aria-label*="award" i]')?.textContent
        ) ?? 0;
    }

    private getFlair(element: Element): string | null {
        return this.sanitizeString(
            element.getAttribute('flair')
            ?? element.getAttribute('link-flair')
            ?? element.querySelector('[slot="flair"], [data-testid*="flair" i], shreddit-post-flair')?.textContent
        );
    }

    private getDomain(element: Element): string | null {
        const raw = this.sanitizeString(
            element.getAttribute('domain')
            ?? element.getAttribute('content-href')
            ?? element.querySelector('a[href^="http"]:not([href*="reddit.com"])')?.getAttribute('href')
        );
        if (!raw) {
            return null;
        }

        try {
            return new URL(raw, location.origin).hostname;
        } catch {
            return raw;
        }
    }

    private getCrosspostParentId(element: Element): string | null {
        return normalizeRedditPostId(
            element.getAttribute('crosspost-parent-id')
            ?? element.getAttribute('crosspost-parent')
            ?? element.querySelector('[crosspost-parent-id]')?.getAttribute('crosspost-parent-id')
        );
    }

    private isPromotedPost(element: Element): boolean {
        if (this.hasBooleanSignal(element, ['promoted', 'is-promoted', 'is-ad'])) {
            return true;
        }
        return this.textIncludes(element, 'promoted') || this.textIncludes(element, 'advertise');
    }

    private hasBooleanSignal(element: Element, names: string[]): boolean {
        return names.some((name) => {
            const attr = element.getAttribute(name) ?? element.getAttribute(`data-${name}`);
            return attr === '' || attr === 'true' || attr === '1';
        });
    }

    private textIncludes(element: Element, value: string): boolean {
        return (element.textContent ?? '').toLowerCase().includes(value);
    }

    private parseCount(raw: unknown): number | null {
        const value = this.sanitizeString(raw);
        if (!value) {
            return null;
        }

        const normalized = value
            .replace(/,/g, '')
            .match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
        if (!normalized) {
            return null;
        }

        const parsed = Number.parseFloat(normalized[1]);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return null;
        }

        const suffix = (normalized[2] ?? '').toLowerCase();
        const multiplier = suffix === 'k'
            ? 1_000
            : suffix === 'm'
                ? 1_000_000
                : suffix === 'b'
                    ? 1_000_000_000
                    : 1;

        return Math.round(parsed * multiplier);
    }

    private getCaptureSurface(): string {
        const pathname = location.pathname.replace(/\/+$/, '') || '/';
        if (pathname.includes('/comments/')) return 'post-detail';
        if (pathname === '/' || pathname === '') return 'home-feed';
        if (pathname === '/r/popular') return 'popular-feed';
        if (pathname === '/r/all') return 'all-feed';
        if (pathname.startsWith('/search')) return 'search-results';
        if (/^\/r\/[^/]+/i.test(pathname)) return 'subreddit-feed';
        if (/^\/(?:u|user)\//i.test(pathname)) return 'user-profile';
        return 'home-feed';
    }

    private getCurrentSubreddit(): string | null {
        const match = location.pathname.match(/^\/r\/([^/]+)/i);
        return normalizeSubredditName(match?.[1]);
    }

    private getFeedSort(): string | null {
        const querySort = this.sanitizeString(new URLSearchParams(location.search).get('sort'));
        if (querySort) {
            return querySort.toLowerCase();
        }

        const match = location.pathname.match(/^\/r\/[^/]+\/(hot|new|top|rising|controversial)/i)
            ?? location.pathname.match(/^\/(hot|new|top|rising|controversial)/i);
        return match?.[1]?.toLowerCase() ?? null;
    }

    private normalizeFlair(raw: string | null): string | null {
        if (!raw) {
            return null;
        }

        const normalized = raw
            .toLowerCase()
            .replace(/[^a-z0-9-_ ]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 48);
        return normalized.length > 0 ? normalized : null;
    }

    private sanitizeString(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }

        const trimmed = value.trim().replace(/\s+/g, ' ');
        return trimmed.length > 0 ? trimmed : null;
    }
}

new RedditObserver();
