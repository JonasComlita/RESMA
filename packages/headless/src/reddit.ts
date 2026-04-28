import { chromium, type BrowserContext, type Page } from 'playwright';
import {
    coercePlatformFeedPayload,
    CURRENT_INGEST_VERSION,
    CURRENT_OBSERVER_VERSIONS,
    type CapturedFeedItem,
    type PlatformFeedPayload,
} from '@resma/shared';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
    createDefaultCaptureModeContext,
    mergeCaptureModeMetadata,
} from './researchAccounts.js';
import type {
    CaptureArtifact,
    CaptureRuntimeOptions,
    CapturedItemCandidate,
    NumericRange,
    ProfileCaptureSummary,
    SyntheticResearchProfile,
} from './types.js';

const REDDIT_HOME_URL = 'https://www.reddit.com/';
const PAGE_TIMEOUT_MS = 30_000;
const DEFAULT_PROFILE_TIMEOUT_MS = 180_000;
const DEFAULT_VIEWPORT = { width: 1440, height: 960 };

function stableHash(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash);
}

function pickInRange(range: NumericRange, seed: string): number {
    if (range.min === range.max) {
        return range.min;
    }
    const normalized = (stableHash(seed) % 10_000) / 10_000;
    const value = range.min + ((range.max - range.min) * normalized);
    return Number(value.toFixed(2));
}

async function dismissRedditConsent(page: Page): Promise<void> {
    try {
        const acceptButton = page.getByRole('button', { name: /Accept all/i }).first();
        if (await acceptButton.isVisible({ timeout: 1000 })) {
            await acceptButton.click({ timeout: 1_500 });
            await page.waitForTimeout(500);
        }
    } catch {
        // Ignore timeout
    }
}

async function applyScrollCadence(page: Page, profile: SyntheticResearchProfile): Promise<void> {
    const actions = Math.max(1, Math.round(pickInRange(profile.behavior.sessionLengthActions, `${profile.id}:actions`) / 2));
    const waitMs = Math.round(Math.min(pickInRange(profile.behavior.scrollCadenceMs, `${profile.id}:scroll`), 4_000));

    for (let index = 0; index < actions; index += 1) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(waitMs);
    }
}

async function collectPopularFeed(page: Page): Promise<CapturedItemCandidate[]> {
    return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('shreddit-post, article[data-testid="post-container"], div[data-testid="post-container"]'));
        
        return items.map((item, index): CapturedItemCandidate | null => {
            const postId = item.getAttribute('id') || item.getAttribute('post-id');
            if (!postId) return null;

            const title = item.getAttribute('post-title') || item.querySelector('[slot="title"]')?.textContent?.trim();
            const subreddit = item.getAttribute('subreddit-prefixed-name') || item.getAttribute('subreddit-name');
            const url = item.getAttribute('permalink') || item.getAttribute('content-href');
            const score = item.getAttribute('score') || item.getAttribute('data-score');

            return {
                videoId: postId,
                title: title ?? null,
                channel: subreddit ?? null,
                url: url ? new URL(url, location.origin).toString() : '',
                position: index + 1,
                captureSurface: 'popular-feed',
                viewCountText: score ?? null,
            };
        }).filter((entry): entry is CapturedItemCandidate => Boolean(entry));
    });
}

function toCapturedFeedItem(
    candidate: CapturedItemCandidate,
    profile: SyntheticResearchProfile,
): CapturedFeedItem {
    return {
        videoId: candidate.videoId,
        caption: candidate.title,
        creatorHandle: candidate.channel,
        creatorId: candidate.channel,
        positionInFeed: candidate.position,
        position: candidate.position,
        contentCategories: [profile.category.label, 'popular'],
        contentTags: [profile.category.key, candidate.channel ?? ''],
        engagementMetrics: {},
        interacted: false,
        interactionType: null,
        captureSurface: candidate.captureSurface,
        viewCountLabel: candidate.viewCountText,
    };
}

async function createPersistentContext(
    profile: SyntheticResearchProfile,
    options: CaptureRuntimeOptions,
): Promise<BrowserContext> {
    const userDataDir = path.join(options.profileStorageDir, profile.storageKey);
    await mkdir(userDataDir, { recursive: true });

    return chromium.launchPersistentContext(userDataDir, {
        headless: options.headless ?? true,
        ...(options.browserChannel ? { channel: options.browserChannel as 'chrome' } : {}),
        locale: profile.region.locale,
        timezoneId: profile.region.timezoneId,
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
        viewport: DEFAULT_VIEWPORT,
        extraHTTPHeaders: {
            'Accept-Language': profile.region.acceptLanguage,
        },
    });
}

export async function captureRedditProfile(
    profile: SyntheticResearchProfile,
    options: CaptureRuntimeOptions,
): Promise<CaptureArtifact> {
    const captureMode = options.captureMode ?? createDefaultCaptureModeContext();
    const context = await createPersistentContext(profile, options);
    const page = context.pages()[0] ?? await context.newPage();
    const warnings: string[] = [];
    const profileTimeoutMs = options.profileTimeoutMs ?? DEFAULT_PROFILE_TIMEOUT_MS;
    
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
        timedOut = true;
        void context.close().catch(() => {});
    }, profileTimeoutMs);

    try {
        try {
            await page.goto(`${REDDIT_HOME_URL}r/popular`, {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT_MS,
            });
            await page.waitForTimeout(3_000);
            await dismissRedditConsent(page);

            await applyScrollCadence(page, profile);
            const feedItems = await collectPopularFeed(page);

            if (feedItems.length === 0) {
                throw new Error(`Profile ${profile.id} produced no valid Reddit feed items.`);
            }

            const feed = feedItems.slice(0, 15).map(item => toCapturedFeedItem(item, profile));

            const payload = coercePlatformFeedPayload(
                {
                    platform: 'reddit',
                    feed,
                    sessionMetadata: mergeCaptureModeMetadata({
                        type: 'REDDIT_FEED_SNAPSHOT',
                        captureSurface: 'popular-feed',
                        observerVersion: CURRENT_OBSERVER_VERSIONS.reddit,
                        ingestVersion: CURRENT_INGEST_VERSION,
                        clientSessionId: `${profile.id}-${Date.now()}`,
                        capturedAt: new Date().toISOString(),
                        uploadEvent: 'SYNTHETIC_REDDIT_SESSION',
                        researchMode: profile.researchMode,
                        syntheticProfileId: profile.id,
                        syntheticRegion: profile.region.displayName,
                        syntheticCategory: profile.category.label,
                        syntheticBehavior: profile.behavior.key,
                    }, captureMode),
                },
                {
                    expectedPlatform: 'reddit',
                    requireFullFeedValidity: false,
                },
            ) as PlatformFeedPayload | null;

            if (!payload) {
                throw new Error(`Profile ${profile.id} produced a payload that failed shared contract coercion.`);
            }

            const summary: ProfileCaptureSummary = {
                homeItemCount: feedItems.length,
                searchItemCount: 0,
                recommendationCount: 0, // Not pulling side rails on Reddit yet
                interactedVideoId: null,
                query: 'popular',
                followUpQuery: null,
                revisitPatternApplied: 'skipped',
            };

            return {
                captureMode,
                profile,
                payload,
                summary,
                warnings,
            };
        } catch (error) {
            if (timedOut) {
                throw new Error(`Profile ${profile.id} timed out after ${profileTimeoutMs}ms.`);
            }
            throw error;
        }
    } finally {
        clearTimeout(timeoutHandle);
        await context.close().catch(() => {});
    }
}
