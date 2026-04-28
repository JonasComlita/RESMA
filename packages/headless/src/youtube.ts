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
    pickFollowUpQuery,
    pickSeedQuery,
} from './profiles.js';
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

const YOUTUBE_HOME_URL = 'https://www.youtube.com/';
const PAGE_TIMEOUT_MS = 30_000;
const DEFAULT_PROFILE_TIMEOUT_MS = 180_000;
const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const RECOMMENDATION_WAIT_MS = 7_500;
const RECOMMENDATION_POLL_MS = 500;

function buildLocalizedYouTubeUrl(pathname: string, profile: SyntheticResearchProfile): string {
    const url = new URL(pathname, YOUTUBE_HOME_URL);
    url.searchParams.set('gl', profile.region.youtubeRegionCode);
    url.searchParams.set('hl', profile.region.locale);
    url.searchParams.set('persist_gl', '1');
    url.searchParams.set('persist_hl', '1');
    return url.toString();
}

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

function shouldApplyRevisit(profile: SyntheticResearchProfile): boolean {
    const value = (stableHash(`${profile.id}:revisit`) % 10_000) / 10_000;
    return value <= profile.behavior.revisitProbability;
}

function sanitizeVideoId(rawValue: string | null | undefined): string | null {
    if (!rawValue) {
        return null;
    }

    try {
        const parsed = new URL(rawValue, YOUTUBE_HOME_URL);
        const queryId = parsed.searchParams.get('v');
        if (queryId) {
            return queryId.trim();
        }

        if (parsed.hostname.includes('youtu.be')) {
            return parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? null;
        }

        const shortsId = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]{3,64})/i)?.[1];
        if (shortsId) {
            return shortsId;
        }
    } catch {
        const inlineId = rawValue.match(/[?&]v=([A-Za-z0-9_-]{3,64})/i)?.[1];
        if (inlineId) {
            return inlineId;
        }
    }

    return /^[A-Za-z0-9_-]{3,64}$/.test(rawValue) ? rawValue : null;
}

async function dismissYouTubeConsent(page: Page): Promise<void> {
    const buttonPatterns = [
        /accept all/i,
        /reject all/i,
        /i agree/i,
        /agree to the use/i,
        /accept the use/i,
    ];

    for (const pattern of buttonPatterns) {
        const button = page.getByRole('button', { name: pattern }).first();
        try {
            if (await button.isVisible({ timeout: 750 })) {
                await button.click({ timeout: 1_500 });
                await page.waitForTimeout(500);
                return;
            }
        } catch {
            continue;
        }
    }
}

async function collectHomeFeed(page: Page): Promise<CapturedItemCandidate[]> {
    return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer'));
        return items.slice(0, 12).map((item, index) => {
            const titleAnchor = item.querySelector<HTMLAnchorElement>('#video-title-link, #video-title');
            const href = titleAnchor?.href ?? '';
            const videoId = (() => {
                try {
                    return new URL(href).searchParams.get('v');
                } catch {
                    return null;
                }
            })();

            if (!videoId) {
                return null;
            }

            return {
                videoId,
                title: titleAnchor?.textContent?.trim() ?? null,
                channel: item.querySelector('ytd-channel-name')?.textContent?.trim() ?? null,
                url: href,
                position: index + 1,
                captureSurface: 'home-feed-grid',
                viewCountText: item.querySelector('#metadata-line span:last-child')?.textContent?.trim() ?? null,
            };
        }).filter((entry): entry is CapturedItemCandidate => Boolean(entry));
    });
}

async function collectSearchResults(page: Page): Promise<CapturedItemCandidate[]> {
    return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('ytd-video-renderer'));
        return items.slice(0, 10).map((item, index) => {
            const titleAnchor = item.querySelector<HTMLAnchorElement>('#video-title');
            const href = titleAnchor?.href ?? '';
            const videoId = (() => {
                try {
                    return new URL(href).searchParams.get('v');
                } catch {
                    return null;
                }
            })();

            if (!videoId) {
                return null;
            }

            return {
                videoId,
                title: titleAnchor?.textContent?.trim() ?? null,
                channel: item.querySelector('#channel-name a, ytd-channel-name a')?.textContent?.trim() ?? null,
                url: href,
                position: index + 1,
                captureSurface: 'search-results',
                viewCountText: item.querySelector('#metadata-line span')?.textContent?.trim() ?? null,
            };
        }).filter((entry): entry is CapturedItemCandidate => Boolean(entry));
    });
}

async function collectRecommendations(page: Page): Promise<RecommendationRow[]> {
    const initialDataRecommendations = await page.evaluate(`
        (() => {
            const rows = [];
            const seen = new Set();
            const root = window.ytInitialData;
            const results = root?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];
            const itemSection = results.find((entry) => entry && entry.itemSectionRenderer)?.itemSectionRenderer;
            const contents = itemSection?.contents || [];

            function pushRow(row) {
                if (!row || !row.videoId || seen.has(row.videoId)) {
                    return;
                }
                seen.add(row.videoId);
                rows.push({
                    videoId: row.videoId,
                    position: rows.length + 1,
                    title: row.title || null,
                    channel: row.channel || null,
                    surface: row.surface || 'watch-next-sidebar',
                    surfaces: [row.surface || 'watch-next-sidebar'],
                });
            }

            function lockupChannel(lockup) {
                const parts = lockup?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
                const firstRow = parts[0]?.metadataParts || [];
                return firstRow.map((part) => part?.text?.content || '').join(' ').trim() || null;
            }

            function compactChannel(renderer) {
                return renderer?.longBylineText?.runs?.map((run) => run.text).join('') || null;
            }

            for (const entry of contents) {
                if (entry?.compactVideoRenderer) {
                    pushRow({
                        videoId: entry.compactVideoRenderer.videoId,
                        title: entry.compactVideoRenderer.title?.runs?.map((run) => run.text).join('') || null,
                        channel: compactChannel(entry.compactVideoRenderer),
                        surface: 'watch-next-sidebar',
                    });
                    continue;
                }

                if (entry?.lockupViewModel) {
                    const lockup = entry.lockupViewModel;
                    const command = lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand;
                    pushRow({
                        videoId: lockup.contentId || command?.watchEndpoint?.videoId || null,
                        title: lockup?.metadata?.lockupMetadataViewModel?.title?.content || null,
                        channel: lockupChannel(lockup),
                        surface: 'watch-next-sidebar',
                    });
                    continue;
                }

                if (entry?.reelItemRenderer) {
                    pushRow({
                        videoId: entry.reelItemRenderer.videoId || null,
                        title: entry.reelItemRenderer.headline?.simpleText || null,
                        channel: entry.reelItemRenderer.viewCountText?.simpleText || null,
                        surface: 'shorts-overlay',
                    });
                }
            }

            return rows.slice(0, 24);
        })()
    `);

    if (Array.isArray(initialDataRecommendations) && initialDataRecommendations.length > 0) {
        return initialDataRecommendations as RecommendationRow[];
    }

    const recommendations = await page.evaluate(`
        (() => {
            const selectorGroups = [
                { selector: 'ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer', surface: 'watch-next-sidebar' },
                { selector: '#secondary ytd-compact-video-renderer', surface: 'watch-next-sidebar' },
                { selector: '.ytp-endscreen-content a.ytp-ce-element', surface: 'end-screen-overlay' },
                { selector: 'ytd-reel-shelf-renderer ytd-reel-item-renderer', surface: 'shorts-overlay' },
            ];

            const rows = [];
            const seen = new Set();

            function resolveVideoId(href) {
                try {
                    const parsed = new URL(href, window.location.origin);
                    return parsed.searchParams.get('v')
                        || (parsed.pathname.match(/\\/shorts\\/([A-Za-z0-9_-]{3,64})/i) || [])[1]
                        || null;
                } catch {
                    return null;
                }
            }

            for (const group of selectorGroups) {
                const items = Array.from(document.querySelectorAll(group.selector));
                for (const item of items) {
                    const anchor = item.matches('a')
                        ? item
                        : item.querySelector('a#thumbnail, a.ytp-ce-element, a[href*="/watch"], a[href*="/shorts/"]');
                    const href = anchor && anchor.href ? anchor.href : '';
                    const videoId = resolveVideoId(href);

                    if (!videoId || seen.has(videoId)) {
                        continue;
                    }

                    seen.add(videoId);
                    rows.push({
                        videoId,
                        position: rows.length + 1,
                        title: item.querySelector('#video-title, .ytp-ce-video-title')?.textContent?.trim() || null,
                        channel: item.querySelector('#channel-name, #text.ytd-channel-name')?.textContent?.trim() || null,
                        surface: group.surface,
                        surfaces: [group.surface],
                    });
                }
            }

            return rows.slice(0, 24);
        })()
    `);

    return recommendations as RecommendationRow[];
}

async function collectRecommendationsWithWait(page: Page): Promise<RecommendationRow[]> {
    const startedAt = Date.now();
    let recommendations: RecommendationRow[] = [];

    while ((Date.now() - startedAt) < RECOMMENDATION_WAIT_MS) {
        recommendations = await collectRecommendations(page);
        if (recommendations.length > 0) {
            return recommendations;
        }

        await page.evaluate(() => window.scrollBy(0, 480));
        await page.waitForTimeout(RECOMMENDATION_POLL_MS);
    }

    return recommendations;
}

async function gotoSearchResults(page: Page, query: string, profile: SyntheticResearchProfile): Promise<void> {
    const searchUrl = buildLocalizedYouTubeUrl(`/results?search_query=${encodeURIComponent(query)}`, profile);
    await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT_MS,
    });
    await dismissYouTubeConsent(page);
    await page.waitForTimeout(2_000);
}

async function waitForWatchSignal(page: Page, profile: SyntheticResearchProfile): Promise<number> {
    const targetSeconds = pickInRange(profile.behavior.watchDurationSeconds, `${profile.id}:watch-seconds`);
    const cappedTarget = Math.max(5, Math.min(targetSeconds, 45));
    const startedAt = Date.now();
    let observedCurrentTime = 0;

    while ((Date.now() - startedAt) < (cappedTarget * 1_000)) {
        try {
            const currentTime = await page.evaluate(() => {
                const element = document.querySelector<HTMLVideoElement>('video.html5-main-video');
                return element?.currentTime ?? 0;
            });
            observedCurrentTime = Math.max(observedCurrentTime, currentTime);
            if (observedCurrentTime >= cappedTarget) {
                break;
            }
        } catch {
            break;
        }
        await page.waitForTimeout(1_000);
    }

    return Number(Math.max(observedCurrentTime, cappedTarget).toFixed(2));
}

async function applyScrollCadence(page: Page, profile: SyntheticResearchProfile): Promise<void> {
    const actions = Math.max(1, Math.round(pickInRange(profile.behavior.sessionLengthActions, `${profile.id}:actions`) / 2));
    const waitMs = Math.round(Math.min(pickInRange(profile.behavior.scrollCadenceMs, `${profile.id}:scroll`), 4_000));

    for (let index = 0; index < actions; index += 1) {
        await page.evaluate(() => window.scrollBy(0, 640));
        await page.waitForTimeout(waitMs);
    }
}

function toCapturedFeedItem(
    candidate: CapturedItemCandidate,
    profile: SyntheticResearchProfile,
    query: string,
    overrides: Partial<CapturedFeedItem> = {},
): CapturedFeedItem {
    return {
        videoId: candidate.videoId,
        caption: candidate.title,
        creatorHandle: candidate.channel,
        creatorId: candidate.channel,
        positionInFeed: candidate.position,
        position: candidate.position,
        contentCategories: [profile.category.label],
        contentTags: [profile.category.key, query],
        engagementMetrics: {},
        interacted: false,
        interactionType: null,
        captureSurface: candidate.captureSurface,
        viewCountLabel: candidate.viewCountText,
        ...overrides,
    };
}

async function openCandidate(page: Page, candidate: CapturedItemCandidate, profile: SyntheticResearchProfile): Promise<void> {
    const localizedUrl = buildLocalizedYouTubeUrl(`/watch?v=${candidate.videoId}`, profile);
    await page.goto(localizedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT_MS,
    });
    await dismissYouTubeConsent(page);
    await page.waitForTimeout(2_500);
}

function dedupeFeedItems(items: CapturedFeedItem[]): CapturedFeedItem[] {
    const score = (item: CapturedFeedItem): number => {
        let total = 0;
        if (item.interacted) total += 10;
        if (typeof item.watchDuration === 'number' && item.watchDuration > 0) total += 5;
        total += item.recommendations?.length ?? 0;
        total += item.engagementMetrics?.recommendationCount ?? 0;
        return total;
    };

    const deduped = new Map<string, CapturedFeedItem>();
    for (const item of items) {
        const existing = deduped.get(item.videoId);
        if (!existing) {
            deduped.set(item.videoId, item);
            continue;
        }

        const preferred = score(item) >= score(existing)
            ? {
                ...existing,
                ...item,
                engagementMetrics: {
                    ...(existing.engagementMetrics ?? {}),
                    ...(item.engagementMetrics ?? {}),
                },
                recommendations: item.recommendations ?? existing.recommendations,
                contentTags: item.contentTags ?? existing.contentTags,
                contentCategories: item.contentCategories ?? existing.contentCategories,
            }
            : {
                ...item,
                ...existing,
                engagementMetrics: {
                    ...(item.engagementMetrics ?? {}),
                    ...(existing.engagementMetrics ?? {}),
                },
                recommendations: existing.recommendations ?? item.recommendations,
                contentTags: existing.contentTags ?? item.contentTags,
                contentCategories: existing.contentCategories ?? item.contentCategories,
            };

        deduped.set(item.videoId, preferred);
    }

    return Array.from(deduped.values());
}

async function createPersistentContext(
    profile: SyntheticResearchProfile,
    options: CaptureRuntimeOptions,
): Promise<BrowserContext> {
    const researchAccountUserDataDir = options.researchAccount?.credentialSource.path;
    const userDataDir = researchAccountUserDataDir ?? path.join(options.profileStorageDir, profile.storageKey);
    if (!researchAccountUserDataDir) {
        await mkdir(userDataDir, { recursive: true });
    }

    return chromium.launchPersistentContext(userDataDir, {
        headless: options.headless ?? true,
        ...(options.browserChannel ? { channel: options.browserChannel as 'chrome' } : {}),
        locale: profile.region.locale,
        timezoneId: profile.region.timezoneId,
        userAgent: `RESMA-Headless/0.1 (${profile.region.youtubeRegionCode}; ${profile.behavior.key})`,
        viewport: DEFAULT_VIEWPORT,
        extraHTTPHeaders: {
            'Accept-Language': profile.region.acceptLanguage,
        },
    });
}

export async function captureYouTubeProfile(
    profile: SyntheticResearchProfile,
    options: CaptureRuntimeOptions,
): Promise<CaptureArtifact> {
    const captureMode = options.captureMode ?? createDefaultCaptureModeContext();
    const context = await createPersistentContext(profile, options);
    const page = context.pages()[0] ?? await context.newPage();
    const warnings: string[] = [];
    const query = pickSeedQuery(profile);
    const applyRevisit = shouldApplyRevisit(profile);
    const followUpQuery = applyRevisit ? pickFollowUpQuery(profile) : null;
    const profileTimeoutMs = options.profileTimeoutMs ?? DEFAULT_PROFILE_TIMEOUT_MS;
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
        timedOut = true;
        void context.close().catch(() => {
            // Best-effort close to break stuck browser work.
        });
    }, profileTimeoutMs);

    try {
        try {
            await page.goto(buildLocalizedYouTubeUrl('/', profile), {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT_MS,
            });
            await dismissYouTubeConsent(page);
            await page.waitForTimeout(2_000);

            const homepageItems = await collectHomeFeed(page);

            await gotoSearchResults(page, query, profile);
            const searchItems = await collectSearchResults(page);
            if (searchItems.length === 0) {
                warnings.push('No YouTube search results were collected for the seed query.');
            }

            const interactionRate = pickInRange(profile.behavior.interactionRate, `${profile.id}:interaction-rate`);
            const detailOpenRate = pickInRange(profile.behavior.detailOpenRate, `${profile.id}:detail-open-rate`);
            const shouldOpenDetail = searchItems.length > 0 && (interactionRate > 0.15 || detailOpenRate > 0.4);
            const watchedCandidate = shouldOpenDetail ? searchItems[0] : null;

            let watchedItem: CapturedFeedItem | null = null;
            let recommendationCount = 0;

            if (watchedCandidate) {
                await openCandidate(page, watchedCandidate, profile);
                await applyScrollCadence(page, profile);
                const watchDuration = await waitForWatchSignal(page, profile);
                const recommendations = await collectRecommendationsWithWait(page);
                recommendationCount = recommendations.length;
                if (recommendations.length === 0) {
                    warnings.push('Watch-page recommendations were empty after retry/polling.');
                }

                watchedItem = toCapturedFeedItem(watchedCandidate, profile, query, {
                    watchDuration,
                    interacted: true,
                    interactionType: 'opened-watch-page',
                    captureSurface: 'watch',
                    recommendations,
                    engagementMetrics: {
                        watchTime: watchDuration,
                        recommendationCount: recommendations.length,
                        recommendations,
                    },
                });
            }

            if (followUpQuery) {
                await gotoSearchResults(page, followUpQuery, profile);
                await page.waitForTimeout(1_000);
            }

            const feed = dedupeFeedItems([
                ...homepageItems.slice(0, 6).map((item) => toCapturedFeedItem(item, profile, query)),
                ...searchItems.slice(0, 6).map((item) => toCapturedFeedItem(item, profile, query)),
                ...(watchedItem ? [watchedItem] : []),
            ]);

            if (feed.length === 0) {
                throw new Error(`Profile ${profile.id} produced no valid YouTube feed items.`);
            }

            const payload = coercePlatformFeedPayload(
                {
                    platform: 'youtube',
                    feed,
                    sessionMetadata: mergeCaptureModeMetadata({
                        type: watchedItem ? 'VIDEO_WATCH' : 'HOMEPAGE_SNAPSHOT',
                        captureSurface: watchedItem ? 'watch' : 'search-results',
                        observerVersion: CURRENT_OBSERVER_VERSIONS.youtube,
                        ingestVersion: CURRENT_INGEST_VERSION,
                        clientSessionId: `${profile.id}-${Date.now()}`,
                        capturedAt: new Date().toISOString(),
                        uploadEvent: 'SYNTHETIC_YOUTUBE_SESSION',
                        researchMode: profile.researchMode,
                        syntheticProfileId: profile.id,
                        syntheticRegion: profile.region.displayName,
                        syntheticCategory: profile.category.label,
                        syntheticBehavior: profile.behavior.key,
                        searchQuery: query,
                        followUpQuery,
                    }, captureMode),
                },
                {
                    expectedPlatform: 'youtube',
                    requireFullFeedValidity: true,
                },
            ) as PlatformFeedPayload | null;

            if (!payload) {
                throw new Error(`Profile ${profile.id} produced a payload that failed shared contract coercion.`);
            }

            const summary: ProfileCaptureSummary = {
                homeItemCount: homepageItems.length,
                searchItemCount: searchItems.length,
                recommendationCount,
                interactedVideoId: watchedCandidate?.videoId ?? null,
                query,
                followUpQuery,
                revisitPatternApplied: followUpQuery ? profile.behavior.revisitPattern : 'skipped',
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
        await context.close().catch(() => {
            // Context may already be closed by the timeout watchdog.
        });
    }
}
