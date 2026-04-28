import { chromium, type BrowserContext, type Page } from 'playwright';
import {
    coercePlatformFeedPayload,
    CURRENT_INGEST_VERSION,
    CURRENT_OBSERVER_VERSIONS,
    type CapturedFeedItem,
    type PlatformFeedPayload,
    type RecommendationRow,
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

const TIKTOK_HOME_URL = 'https://www.tiktok.com/';
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

async function dismissTikTokConsent(page: Page): Promise<void> {
    const buttonPatterns = [
        /Accept all/i,
        /Allow all cookies/i,
        /Continue/i,
        /Decline/i,
        /Guest/i
    ];

    for (const pattern of buttonPatterns) {
        try {
            const button = page.getByRole('button', { name: pattern }).first();
            if (await button.isVisible({ timeout: 1000 })) {
                await button.click({ timeout: 1_500 });
                await page.waitForTimeout(500);
            }
        } catch {
            // Ignore timeout errors
        }
    }
    
    // Attempt to close generic modals (like login nag)
    try {
        const closeBtn = page.locator('[data-e2e="modal-close-inner-button"]');
        if (await closeBtn.isVisible({ timeout: 1000 })) {
            await closeBtn.click();
        }
    } catch {
        // Ignore
    }
}

async function applyScrollCadence(page: Page, profile: SyntheticResearchProfile): Promise<void> {
    const actions = Math.max(1, Math.round(pickInRange(profile.behavior.sessionLengthActions, `${profile.id}:actions`) / 2));
    const waitMs = Math.round(Math.min(pickInRange(profile.behavior.scrollCadenceMs, `${profile.id}:scroll`), 4_000));

    for (let index = 0; index < actions; index += 1) {
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(waitMs);
        await dismissTikTokConsent(page); // Login nags appear on scroll
    }
}

async function collectExploreFeed(page: Page): Promise<CapturedItemCandidate[]> {
    return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[data-e2e="recommend-list-item-container"], .tiktok-feed-item, [data-e2e="explore-item"]'));
        
        return items.map((item, index): CapturedItemCandidate | null => {
            const videoLink = item.querySelector('a[href*="/video/"]');
            const href = videoLink?.getAttribute('href') ?? '';
            const videoId = href.match(/\/video\/(\d+)/)?.[1];

            if (!videoId) return null;

            const creatorLink = item.querySelector('a[href*="/@"]');
            const creatorHandle = creatorLink?.getAttribute('href')?.replace('/', '') || null;

            const captionEl = item.querySelector('[data-e2e="video-desc"]');
            const caption = captionEl?.textContent?.trim() || null;

            return {
                videoId,
                title: caption,
                channel: creatorHandle,
                url: href,
                position: index + 1,
                captureSurface: 'explore-feed',
                viewCountText: null as string | null,
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
        contentCategories: [profile.category.label],
        contentTags: [profile.category.key, 'explore'],
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

export async function captureTikTokProfile(
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
            // TikTok Explore bypasses the immediate FYP login wall usually
            await page.goto(`${TIKTOK_HOME_URL}explore`, {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT_MS,
            });
            await page.waitForTimeout(3_000);
            await dismissTikTokConsent(page);

            await applyScrollCadence(page, profile);
            const feedItems = await collectExploreFeed(page);

            if (feedItems.length === 0) {
                throw new Error(`Profile ${profile.id} produced no valid TikTok feed items.`);
            }

            const feed = feedItems.slice(0, 15).map(item => toCapturedFeedItem(item, profile));

            const payload = coercePlatformFeedPayload(
                {
                    platform: 'tiktok',
                    feed,
                    sessionMetadata: mergeCaptureModeMetadata({
                        type: 'EXPLORE_SNAPSHOT',
                        captureSurface: 'explore',
                        observerVersion: CURRENT_OBSERVER_VERSIONS.tiktok,
                        ingestVersion: CURRENT_INGEST_VERSION,
                        clientSessionId: `${profile.id}-${Date.now()}`,
                        capturedAt: new Date().toISOString(),
                        uploadEvent: 'SYNTHETIC_TIKTOK_SESSION',
                        researchMode: profile.researchMode,
                        syntheticProfileId: profile.id,
                        syntheticRegion: profile.region.displayName,
                        syntheticCategory: profile.category.label,
                        syntheticBehavior: profile.behavior.key,
                    }, captureMode),
                },
                {
                    expectedPlatform: 'tiktok',
                    requireFullFeedValidity: false,
                },
            ) as PlatformFeedPayload | null;

            if (!payload) {
                throw new Error(`Profile ${profile.id} produced a payload that failed shared contract coercion.`);
            }

            const summary: ProfileCaptureSummary = {
                homeItemCount: feedItems.length,
                searchItemCount: 0,
                recommendationCount: 0, // TikTok doesn't have a side rail on explore cards like YT
                interactedVideoId: null,
                query: 'explore',
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
