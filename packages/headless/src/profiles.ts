import type {
    BehavioralTraitDefinition,
    CategoryDefinition,
    RegionDefinition,
    SupportedHeadlessPlatform,
    SyntheticResearchProfile,
} from './types.js';

export const HEADLESS_PLATFORM_YOUTUBE: SupportedHeadlessPlatform = 'youtube';

export const RESEARCH_REGIONS: readonly RegionDefinition[] = [
    {
        key: 'us',
        displayName: 'United States',
        youtubeRegionCode: 'US',
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
        acceptLanguage: 'en-US,en;q=0.9',
    },
    {
        key: 'uk',
        displayName: 'United Kingdom',
        youtubeRegionCode: 'GB',
        locale: 'en-GB',
        timezoneId: 'Europe/London',
        acceptLanguage: 'en-GB,en;q=0.9',
    },
    {
        key: 'ca',
        displayName: 'Canada',
        youtubeRegionCode: 'CA',
        locale: 'en-CA',
        timezoneId: 'America/Toronto',
        acceptLanguage: 'en-CA,en;q=0.9',
    },
    {
        key: 'br',
        displayName: 'Brazil',
        youtubeRegionCode: 'BR',
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.6',
    },
    {
        key: 'de',
        displayName: 'Germany',
        youtubeRegionCode: 'DE',
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        acceptLanguage: 'de-DE,de;q=0.9,en;q=0.6',
    },
    {
        key: 'in',
        displayName: 'India',
        youtubeRegionCode: 'IN',
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        acceptLanguage: 'en-IN,en;q=0.9,hi;q=0.6',
    },
    {
        key: 'jp',
        displayName: 'Japan',
        youtubeRegionCode: 'JP',
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
        acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.5',
    },
    {
        key: 'mx',
        displayName: 'Mexico',
        youtubeRegionCode: 'MX',
        locale: 'es-MX',
        timezoneId: 'America/Mexico_City',
        acceptLanguage: 'es-MX,es;q=0.9,en;q=0.6',
    },
] as const;

export const CORE_CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
    {
        key: 'entertainment',
        label: 'Entertainment',
        description: 'Broad appeal entertainment intended to sample mainstream recommendation pressure.',
        querySeeds: ['movie trailer interviews', 'late night comedy clips', 'celebrity behind the scenes'],
        followUpQuerySeeds: ['award show highlights', 'streaming series teaser'],
    },
    {
        key: 'gaming',
        label: 'Gaming',
        description: 'Game discovery, commentary, highlights, and live-play recommendation clusters.',
        querySeeds: ['gameplay highlights', 'new game review', 'speedrun world record'],
        followUpQuerySeeds: ['gaming setup tour', 'esports finals highlights'],
    },
    {
        key: 'music',
        label: 'Music',
        description: 'Music video, live performance, and genre-adjacent recommendation paths.',
        querySeeds: ['live studio performance', 'official music video', 'acoustic cover session'],
        followUpQuerySeeds: ['festival live set', 'artist interview performance'],
    },
    {
        key: 'fitness-health',
        label: 'Fitness & Health',
        description: 'Workout, recovery, wellness, and health-education recommendation patterns.',
        querySeeds: ['full body workout routine', 'healthy habit tips', 'mobility stretch routine'],
        followUpQuerySeeds: ['nutrition meal prep tips', 'beginner recovery exercises'],
    },
    {
        key: 'food-cooking',
        label: 'Food & Cooking',
        description: 'Recipe, kitchen technique, and food entertainment recommendation paths.',
        querySeeds: ['easy weeknight dinner recipe', 'street food documentary', 'chef kitchen technique'],
        followUpQuerySeeds: ['meal prep for beginners', 'dessert recipe tutorial'],
    },
    {
        key: 'beauty-fashion',
        label: 'Beauty & Fashion',
        description: 'Style, makeup, skincare, and fashion trend recommendation sampling.',
        querySeeds: ['seasonal fashion lookbook', 'makeup tutorial everyday', 'skincare routine review'],
        followUpQuerySeeds: ['fashion week recap', 'hair styling tutorial'],
    },
    {
        key: 'technology',
        label: 'Technology',
        description: 'Consumer tech, developer-adjacent, and hardware/software recommendation signals.',
        querySeeds: ['new gadget review', 'coding setup tour', 'ai tool comparison'],
        followUpQuerySeeds: ['smartphone camera test', 'laptop buying guide'],
    },
    {
        key: 'finance-business',
        label: 'Finance & Business',
        description: 'Entrepreneurship, personal finance, macro-business, and career recommendation paths.',
        querySeeds: ['small business case study', 'personal finance basics', 'startup founder interview'],
        followUpQuerySeeds: ['investing explained beginners', 'market recap analysis'],
    },
    {
        key: 'news-politics',
        label: 'News & Politics',
        description: 'Topical news, explainers, and civic commentary recommendation behavior.',
        querySeeds: ['daily news briefing', 'policy explainer', 'election analysis panel'],
        followUpQuerySeeds: ['international news summary', 'fact check explainer'],
    },
    {
        key: 'sports',
        label: 'Sports',
        description: 'League highlights, analysis, fitness crossover, and event recommendations.',
        querySeeds: ['match highlights today', 'player analysis breakdown', 'sports documentary clip'],
        followUpQuerySeeds: ['post game interview', 'training drill highlights'],
    },
] as const;

export const BEHAVIORAL_TRAITS: readonly BehavioralTraitDefinition[] = [
    {
        key: 'scanner',
        label: 'Scanner',
        description: 'Moves quickly, samples lightly, and opens detail pages only when a result stands out.',
        watchDurationSeconds: { min: 8, max: 22 },
        watchDurationRatio: { min: 0.08, max: 0.2 },
        scrollCadenceMs: { min: 1200, max: 2600 },
        interactionRate: { min: 0.08, max: 0.18 },
        sessionLengthActions: { min: 5, max: 8 },
        detailOpenRate: { min: 0.25, max: 0.45 },
        revisitPattern: 'none',
        revisitProbability: 0.05,
    },
    {
        key: 'steady-viewer',
        label: 'Steady Viewer',
        description: 'Watches longer, scrolls less aggressively, and follows a stable interest lane.',
        watchDurationSeconds: { min: 22, max: 48 },
        watchDurationRatio: { min: 0.2, max: 0.45 },
        scrollCadenceMs: { min: 2500, max: 4200 },
        interactionRate: { min: 0.18, max: 0.32 },
        sessionLengthActions: { min: 4, max: 7 },
        detailOpenRate: { min: 0.45, max: 0.7 },
        revisitPattern: 'same-query',
        revisitProbability: 0.42,
    },
    {
        key: 'engaged-sampler',
        label: 'Engaged Sampler',
        description: 'Clicks through several candidates and mixes quick sampling with one stronger watch signal.',
        watchDurationSeconds: { min: 16, max: 36 },
        watchDurationRatio: { min: 0.14, max: 0.35 },
        scrollCadenceMs: { min: 1700, max: 3200 },
        interactionRate: { min: 0.28, max: 0.5 },
        sessionLengthActions: { min: 6, max: 10 },
        detailOpenRate: { min: 0.55, max: 0.75 },
        revisitPattern: 'adjacent-query',
        revisitProbability: 0.36,
    },
    {
        key: 'repeat-explorer',
        label: 'Repeat Explorer',
        description: 'Returns to prior clusters, follows channel adjacency, and is useful for recommendation drift checks.',
        watchDurationSeconds: { min: 18, max: 42 },
        watchDurationRatio: { min: 0.16, max: 0.4 },
        scrollCadenceMs: { min: 2100, max: 3600 },
        interactionRate: { min: 0.24, max: 0.42 },
        sessionLengthActions: { min: 5, max: 9 },
        detailOpenRate: { min: 0.48, max: 0.72 },
        revisitPattern: 'channel-loop',
        revisitProbability: 0.51,
    },
] as const;

function slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function getRegionByKey(regionKey: string): RegionDefinition {
    const region = RESEARCH_REGIONS.find((entry) => entry.key === regionKey);
    if (!region) {
        throw new Error(`Unknown region "${regionKey}"`);
    }
    return region;
}

export function getCategoryByKey(categoryKey: string): CategoryDefinition {
    const category = CORE_CATEGORY_DEFINITIONS.find((entry) => entry.key === categoryKey || slugify(entry.label) === categoryKey);
    if (!category) {
        throw new Error(`Unknown category "${categoryKey}"`);
    }
    return category;
}

export function getBehaviorByKey(behaviorKey: string): BehavioralTraitDefinition {
    const behavior = BEHAVIORAL_TRAITS.find((entry) => entry.key === behaviorKey);
    if (!behavior) {
        throw new Error(`Unknown behavior "${behaviorKey}"`);
    }
    return behavior;
}

export function buildSyntheticProfiles(variantsPerRegionCategory = 1): SyntheticResearchProfile[] {
    const profiles: SyntheticResearchProfile[] = [];

    for (const region of RESEARCH_REGIONS) {
        for (const category of CORE_CATEGORY_DEFINITIONS) {
            for (let variantIndex = 0; variantIndex < variantsPerRegionCategory; variantIndex += 1) {
                const behavior = BEHAVIORAL_TRAITS[(profiles.length + variantIndex) % BEHAVIORAL_TRAITS.length];
                const id = [
                    'yt',
                    region.key,
                    slugify(category.label),
                    behavior.key,
                    `v${variantIndex + 1}`,
                ].join('-');

                profiles.push({
                    id,
                    storageKey: id,
                    platform: HEADLESS_PLATFORM_YOUTUBE,
                    researchMode: 'synthetic-logged-out',
                    region,
                    category,
                    behavior,
                    notes: [
                        'Synthetic research profile with no real-person identity linkage.',
                        'Uses the same core category matrix across all target regions.',
                        'Defaults to logged-out capture unless the operator explicitly provisions labeled research accounts.',
                    ],
                });
            }
        }
    }

    return profiles;
}

export function pickSeedQuery(profile: SyntheticResearchProfile, iteration = 0): string {
    const seeds = profile.category.querySeeds;
    return seeds[iteration % seeds.length] ?? profile.category.label;
}

export function pickFollowUpQuery(profile: SyntheticResearchProfile, iteration = 0): string | null {
    const seeds = profile.category.followUpQuerySeeds;
    if (seeds.length === 0) {
        return null;
    }
    return seeds[iteration % seeds.length] ?? null;
}
