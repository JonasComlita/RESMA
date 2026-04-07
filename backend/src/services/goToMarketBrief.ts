import {
    AudienceForecastInputError,
    AudienceForecastOptions,
    AudienceModel,
    buildAudienceModel,
    computeAudienceForecastFromModel,
    loadAudienceFeedItems,
} from './audienceForecast.js';

interface TransitionProbability {
    toVideoId: string;
    probability: number;
}

type TransitionProbabilityMap = Map<string, TransitionProbability[]>;

interface PathState {
    pathVideoIds: string[];
    probability: number;
}

export interface PredictedReachPath {
    pathVideoIds: string[];
    probability: number;
    depth: number;
}

export interface GoToMarketCohortBrief {
    cohortId: string;
    cohortLabel: string;
    users: number;
    targetExposureRate: number;
    exposureConfidenceInterval: {
        low: number;
        high: number;
    };
    relativeLiftVsGlobalExposure: number | null;
    directProbabilityFromSeed: number | null;
    reachProbabilityFromSeed: number | null;
    fitScore: number;
    score: number;
    predictedReachPaths: PredictedReachPath[];
}

export interface GoToMarketBriefResult {
    generatedAt: string;
    platform: string;
    targetVideoId: string;
    seedVideoId: string | null;
    settings: {
        maxDepth: number;
        beamWidth: number;
        topCohorts: number;
        maxPathsPerCohort: number;
        pathBranchLimit: number;
    };
    global: {
        targetExposureRate: number;
        targetExposureConfidenceInterval: {
            low: number;
            high: number;
        };
        directProbabilityFromSeed: number | null;
        reachProbabilityFromSeed: number | null;
    };
    topCohorts: GoToMarketCohortBrief[];
    keyTakeaways: string[];
    markdown: string;
}

export interface GoToMarketBriefOptions extends AudienceForecastOptions {
    topCohorts?: number;
    maxPathsPerCohort?: number;
    pathBranchLimit?: number;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function percent(value: number | null | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return `${Math.round(value * 100)}%`;
}

function normalizeTransitions(
    transitionCounts: Map<string, Map<string, number>>
): TransitionProbabilityMap {
    const normalized = new Map<string, TransitionProbability[]>();

    for (const [sourceVideoId, targets] of transitionCounts.entries()) {
        let total = 0;
        for (const count of targets.values()) {
            total += count;
        }
        if (total <= 0) continue;

        const edges: TransitionProbability[] = [];
        for (const [targetVideoId, count] of targets.entries()) {
            edges.push({
                toVideoId: targetVideoId,
                probability: count / total,
            });
        }

        edges.sort((a, b) => b.probability - a.probability || a.toVideoId.localeCompare(b.toVideoId));
        normalized.set(sourceVideoId, edges);
    }

    return normalized;
}

function computeTopReachPaths(
    normalizedTransitions: TransitionProbabilityMap,
    seedVideoId: string,
    targetVideoId: string,
    maxDepth: number,
    branchLimit: number,
    maxPaths: number
): PredictedReachPath[] {
    if (!seedVideoId || !targetVideoId || maxDepth <= 0) return [];

    const boundedBranchLimit = clamp(branchLimit, 1, 25);
    const boundedMaxPaths = clamp(maxPaths, 1, 10);
    const boundedDepth = clamp(maxDepth, 1, 8);
    const maxStatesPerDepth = 160;

    let frontier: PathState[] = [{
        pathVideoIds: [seedVideoId],
        probability: 1,
    }];

    const completePaths: PredictedReachPath[] = [];

    for (let depth = 1; depth <= boundedDepth; depth += 1) {
        if (frontier.length === 0) break;

        const nextFrontier: PathState[] = [];
        const rankedFrontier = frontier
            .slice()
            .sort((a, b) => b.probability - a.probability)
            .slice(0, maxStatesPerDepth);

        for (const state of rankedFrontier) {
            const currentVideoId = state.pathVideoIds[state.pathVideoIds.length - 1];
            const outgoing = normalizedTransitions.get(currentVideoId);
            if (!outgoing || outgoing.length === 0) continue;

            for (const edge of outgoing.slice(0, boundedBranchLimit)) {
                if (state.pathVideoIds.includes(edge.toVideoId)) continue;
                const probability = state.probability * edge.probability;
                const candidatePath = [...state.pathVideoIds, edge.toVideoId];

                if (edge.toVideoId === targetVideoId) {
                    completePaths.push({
                        pathVideoIds: candidatePath,
                        probability,
                        depth,
                    });
                } else {
                    nextFrontier.push({
                        pathVideoIds: candidatePath,
                        probability,
                    });
                }
            }
        }

        frontier = nextFrontier
            .sort((a, b) => b.probability - a.probability)
            .slice(0, maxStatesPerDepth);
    }

    const deduped = new Map<string, PredictedReachPath>();
    for (const path of completePaths) {
        const key = path.pathVideoIds.join('>');
        const existing = deduped.get(key);
        if (!existing || path.probability > existing.probability) {
            deduped.set(key, {
                ...path,
                probability: roundTo(path.probability, 4),
            });
        }
    }

    return Array.from(deduped.values())
        .sort((a, b) => b.probability - a.probability || a.depth - b.depth)
        .slice(0, boundedMaxPaths);
}

function buildTakeaways(brief: GoToMarketBriefResult): string[] {
    const takeaways: string[] = [];

    if (brief.topCohorts.length === 0) {
        takeaways.push('No stable cohorts were available yet. Gather more cross-user comparisons to produce a reliable launch plan.');
        return takeaways;
    }

    const topLift = brief.topCohorts
        .filter((cohort) => typeof cohort.relativeLiftVsGlobalExposure === 'number')
        .sort((a, b) => (b.relativeLiftVsGlobalExposure ?? 0) - (a.relativeLiftVsGlobalExposure ?? 0))[0];

    if (topLift && typeof topLift.relativeLiftVsGlobalExposure === 'number') {
        takeaways.push(
            `${topLift.cohortLabel} is the strongest launch cohort at ${topLift.relativeLiftVsGlobalExposure.toFixed(2)}x lift versus global baseline.`
        );
    }

    const tightestBand = brief.topCohorts
        .slice()
        .sort((a, b) => {
            const aWidth = a.exposureConfidenceInterval.high - a.exposureConfidenceInterval.low;
            const bWidth = b.exposureConfidenceInterval.high - b.exposureConfidenceInterval.low;
            return aWidth - bWidth;
        })[0];

    if (tightestBand) {
        takeaways.push(
            `${tightestBand.cohortLabel} has the tightest confidence band (${percent(tightestBand.exposureConfidenceInterval.low)}-${percent(tightestBand.exposureConfidenceInterval.high)}), giving the most stable exposure estimate.`
        );
    }

    if (brief.seedVideoId) {
        const withPaths = brief.topCohorts.filter((cohort) => cohort.predictedReachPaths.length > 0);
        if (withPaths.length > 0) {
            takeaways.push(
                `${withPaths.length}/${brief.topCohorts.length} top cohorts show explicit reach paths from seed ${brief.seedVideoId} to target ${brief.targetVideoId}.`
            );
        } else {
            takeaways.push(
                `No concrete reach paths were found from seed ${brief.seedVideoId} within depth ${brief.settings.maxDepth}; consider a closer seed context.`
            );
        }
    } else {
        takeaways.push('Add a seed video ID to include deterministic reach path predictions in this brief.');
    }

    return takeaways.slice(0, 4);
}

function buildMarkdownBrief(brief: GoToMarketBriefResult): string {
    const lines: string[] = [];
    lines.push('# Go-to-Market Cohort Brief');
    lines.push('');
    lines.push(`- Generated: ${brief.generatedAt}`);
    lines.push(`- Platform: ${brief.platform}`);
    lines.push(`- Target Video: ${brief.targetVideoId}`);
    lines.push(`- Seed Context: ${brief.seedVideoId ?? 'none'}`);
    lines.push('');
    lines.push('## Global Baseline');
    lines.push(`- Exposure: ${percent(brief.global.targetExposureRate)} (${percent(brief.global.targetExposureConfidenceInterval.low)}-${percent(brief.global.targetExposureConfidenceInterval.high)})`);
    lines.push(`- Direct from Seed: ${percent(brief.global.directProbabilityFromSeed)}`);
    lines.push(`- Reach from Seed: ${percent(brief.global.reachProbabilityFromSeed)}`);
    lines.push('');
    lines.push('## Top Cohorts');
    lines.push('| Cohort | Users | Exposure (CI) | Lift vs Global | Reach from Seed | Score |');
    lines.push('| --- | ---: | --- | ---: | ---: | ---: |');
    for (const cohort of brief.topCohorts) {
        lines.push(
            `| ${cohort.cohortLabel} | ${cohort.users} | ${percent(cohort.targetExposureRate)} (${percent(cohort.exposureConfidenceInterval.low)}-${percent(cohort.exposureConfidenceInterval.high)}) | ${typeof cohort.relativeLiftVsGlobalExposure === 'number' ? `${cohort.relativeLiftVsGlobalExposure.toFixed(2)}x` : '-'} | ${percent(cohort.reachProbabilityFromSeed)} | ${cohort.score.toFixed(3)} |`
        );
    }
    lines.push('');
    lines.push('## Predicted Reach Paths');
    for (const cohort of brief.topCohorts) {
        lines.push(`### ${cohort.cohortLabel}`);
        if (cohort.predictedReachPaths.length === 0) {
            lines.push('- No high-confidence path found in the configured depth/branch window.');
            continue;
        }
        for (const [index, path] of cohort.predictedReachPaths.entries()) {
            lines.push(
                `${index + 1}. ${path.pathVideoIds.join(' -> ')} (p=${(path.probability * 100).toFixed(2)}%, depth=${path.depth})`
            );
        }
    }
    lines.push('');
    lines.push('## Key Takeaways');
    for (const takeaway of brief.keyTakeaways) {
        lines.push(`- ${takeaway}`);
    }
    lines.push('');

    return lines.join('\n');
}

export function buildGoToMarketCohortBriefFromModel(
    model: AudienceModel,
    currentUserId: string,
    options: AudienceForecastOptions,
    settings?: {
        topCohorts?: number;
        maxPathsPerCohort?: number;
        pathBranchLimit?: number;
    }
): GoToMarketBriefResult {
    const topCohortsLimit = clamp(settings?.topCohorts ?? 5, 1, 12);
    const maxPathsPerCohort = clamp(settings?.maxPathsPerCohort ?? 3, 1, 10);
    const pathBranchLimit = clamp(settings?.pathBranchLimit ?? 6, 1, 25);
    const forecast = computeAudienceForecastFromModel(model, currentUserId, options);

    const selectedCohorts = (forecast.recommendedAudienceCohorts.length > 0
        ? forecast.recommendedAudienceCohorts
        : forecast.cohorts
    ).slice(0, topCohortsLimit);

    const topCohorts: GoToMarketCohortBrief[] = selectedCohorts.map((cohort) => {
        const modelCohort = model.cohorts.get(cohort.cohortId);
        const normalizedTransitions = modelCohort
            ? normalizeTransitions(modelCohort.transitionCounts)
            : new Map<string, TransitionProbability[]>();

        const predictedReachPaths = forecast.seedVideoId
            ? computeTopReachPaths(
                normalizedTransitions,
                forecast.seedVideoId,
                forecast.targetVideoId,
                forecast.settings.maxDepth,
                pathBranchLimit,
                maxPathsPerCohort
            )
            : [];

        return {
            cohortId: cohort.cohortId,
            cohortLabel: cohort.cohortLabel,
            users: cohort.users,
            targetExposureRate: cohort.targetExposureRate,
            exposureConfidenceInterval: cohort.exposureConfidenceInterval,
            relativeLiftVsGlobalExposure: cohort.relativeLiftVsGlobalExposure,
            directProbabilityFromSeed: cohort.directProbabilityFromSeed,
            reachProbabilityFromSeed: cohort.reachProbabilityFromSeed,
            fitScore: cohort.fitScore,
            score: cohort.score,
            predictedReachPaths,
        };
    });

    const briefBase: Omit<GoToMarketBriefResult, 'keyTakeaways' | 'markdown'> = {
        generatedAt: new Date().toISOString(),
        platform: forecast.platform,
        targetVideoId: forecast.targetVideoId,
        seedVideoId: forecast.seedVideoId,
        settings: {
            maxDepth: forecast.settings.maxDepth,
            beamWidth: forecast.settings.beamWidth,
            topCohorts: topCohortsLimit,
            maxPathsPerCohort,
            pathBranchLimit,
        },
        global: {
            targetExposureRate: forecast.global.targetExposureRate,
            targetExposureConfidenceInterval: forecast.global.targetExposureConfidenceInterval,
            directProbabilityFromSeed: forecast.global.directProbabilityFromSeed,
            reachProbabilityFromSeed: forecast.global.reachProbabilityFromSeed,
        },
        topCohorts,
    };

    const keyTakeaways = buildTakeaways({
        ...briefBase,
        keyTakeaways: [],
        markdown: '',
    });

    const brief: GoToMarketBriefResult = {
        ...briefBase,
        keyTakeaways,
        markdown: '',
    };

    brief.markdown = buildMarkdownBrief(brief);
    return brief;
}

export async function generateGoToMarketCohortBrief(
    currentUserId: string,
    options: GoToMarketBriefOptions
): Promise<GoToMarketBriefResult> {
    const targetVideoId = options.targetVideoId.trim();
    if (!targetVideoId) {
        throw new AudienceForecastInputError('targetVideoId is required');
    }

    const items = await loadAudienceFeedItems(options.platform);
    if (items.length === 0) {
        throw new AudienceForecastInputError(
            `No ${options.platform} comparison snapshots found yet.`,
            404,
            { platform: options.platform }
        );
    }

    const model = buildAudienceModel(items);
    return buildGoToMarketCohortBriefFromModel(
        model,
        currentUserId,
        {
            targetVideoId,
            seedVideoId: options.seedVideoId,
            platform: options.platform,
            maxDepth: options.maxDepth,
            beamWidth: options.beamWidth,
        },
        {
            topCohorts: options.topCohorts,
            maxPathsPerCohort: options.maxPathsPerCohort,
            pathBranchLimit: options.pathBranchLimit,
        }
    );
}
