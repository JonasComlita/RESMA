import {
    AudienceForecastInputError,
    AudienceForecastOptions,
    AudienceModel,
    buildAudienceModel,
    CohortLiftStabilityEvidence,
    deriveCohortStabilityScore,
    computeAudienceForecastFromModel,
    deriveCohortLiftStabilityEvidence,
    getRecommendationQualityThresholds,
    deriveRecommendationQualityGate,
    loadCohortLiftStabilityEvidence,
    loadMaterializedAudienceModelContext,
    RecommendationQualityGate,
} from './audienceForecast.js';
import {
    ForecastEvaluationResult,
    generateForecastEvaluation,
} from './forecastEvaluation.js';

interface TransitionProbability {
    toVideoId: string;
    probability: number;
    count: number;
}

type TransitionProbabilityMap = Map<string, TransitionProbability[]>;

interface PathState {
    pathVideoIds: string[];
    probability: number;
    edgeEvidence: ReachPathEdgeEvidence[];
}

export interface ReachPathEdgeEvidence {
    fromVideoId: string;
    toVideoId: string;
    probability: number;
    support: number;
}

export interface PredictedReachPath {
    pathVideoIds: string[];
    probability: number;
    depth: number;
    platform: string;
    supportingTransitionWeight: number;
    edgeEvidence: ReachPathEdgeEvidence[];
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
    liftInterpretation: {
        isLiftInterpretable: boolean;
        gateReasons: string[];
        cohortTransitionSamples: number;
        exposureConfidenceIntervalWidth: number;
        adjacentWindowLiftDelta: number | null;
        adjacentWindowUsers: {
            earlier: number;
            later: number;
        } | null;
    };
    predictedReachPaths: PredictedReachPath[];
}

export interface BriefReliabilitySummary {
    available: boolean;
    topK: number;
    globalReliabilityScore: number;
    globalSampleSize: number;
    globalHitRate: number;
    globalPrecisionAtK: number;
    globalCalibrationScore: number;
    globalGateStatus: 'pass' | 'degraded';
    globalGateReasons: string[];
    keyCohortGateStatus: 'pass' | 'degraded';
    keyCohortGateReasons: string[];
    keyCohorts: Array<{
        cohortId: string;
        reliabilityScore: number;
        sampleSize: number;
        gateStatus: 'pass' | 'degraded';
        gateReasons: string[];
    }>;
    adjacentWindowReliabilityDelta: number | null;
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
    qualityGate: RecommendationQualityGate;
    forecastReliability: BriefReliabilitySummary;
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
                count,
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
    platform: string,
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
        edgeEvidence: [],
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
                const candidateEdgeEvidence = [
                    ...state.edgeEvidence,
                    {
                        fromVideoId: currentVideoId,
                        toVideoId: edge.toVideoId,
                        probability: roundTo(edge.probability, 4),
                        support: roundTo(edge.count, 3),
                    },
                ];
                const supportingTransitionWeight = roundTo(
                    candidateEdgeEvidence.reduce((sum, evidence) => sum + evidence.support, 0),
                    3
                );

                if (edge.toVideoId === targetVideoId) {
                    completePaths.push({
                        pathVideoIds: candidatePath,
                        probability,
                        depth,
                        platform,
                        supportingTransitionWeight,
                        edgeEvidence: candidateEdgeEvidence,
                    });
                } else {
                    nextFrontier.push({
                        pathVideoIds: candidatePath,
                        probability,
                        edgeEvidence: candidateEdgeEvidence,
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
                supportingTransitionWeight: roundTo(path.supportingTransitionWeight, 3),
            });
        }
    }

    return Array.from(deduped.values())
        .sort((a, b) => b.probability - a.probability || a.depth - b.depth)
        .slice(0, boundedMaxPaths);
}

function buildUnavailableReliabilitySummary(reason: string): BriefReliabilitySummary {
    return {
        available: false,
        topK: 0,
        globalReliabilityScore: 0,
        globalSampleSize: 0,
        globalHitRate: 0,
        globalPrecisionAtK: 0,
        globalCalibrationScore: 0,
        globalGateStatus: 'degraded',
        globalGateReasons: [reason],
        keyCohortGateStatus: 'degraded',
        keyCohortGateReasons: [reason],
        keyCohorts: [],
        adjacentWindowReliabilityDelta: null,
    };
}

function deriveBriefReliabilitySummary(
    evaluation: ForecastEvaluationResult | null
): BriefReliabilitySummary {
    if (!evaluation) {
        return buildUnavailableReliabilitySummary(
            'Holdout reliability metrics are not available for this platform yet.'
        );
    }

    const keyCohorts = evaluation.validation.keyCohorts.map((cohort) => ({
        cohortId: cohort.cohortId,
        reliabilityScore: cohort.reliabilityScore,
        sampleSize: cohort.sampleSize,
        gateStatus: cohort.gate.status,
        gateReasons: cohort.gate.reasons,
    }));

    return {
        available: true,
        topK: evaluation.metrics.topK,
        globalReliabilityScore: evaluation.metrics.reliabilityScore,
        globalSampleSize: evaluation.metrics.sampleSize,
        globalHitRate: evaluation.metrics.topKReachHitRate,
        globalPrecisionAtK: evaluation.metrics.precisionAtK,
        globalCalibrationScore: evaluation.metrics.calibrationScore,
        globalGateStatus: evaluation.validation.globalGate.status,
        globalGateReasons: evaluation.validation.globalGate.reasons,
        keyCohortGateStatus: evaluation.validation.keyCohortGate.status,
        keyCohortGateReasons: evaluation.validation.keyCohortGate.reasons,
        keyCohorts,
        adjacentWindowReliabilityDelta: evaluation.adjacentWindow.reliabilityDelta,
    };
}

function applyReliabilityPenaltyToQualityGate(
    qualityGate: RecommendationQualityGate,
    reliability: BriefReliabilitySummary
): RecommendationQualityGate {
    const reasonCodes = [...qualityGate.reasonCodes];
    const degradationReasons = [...qualityGate.degradationReasons];
    let confidenceMultiplier = qualityGate.confidenceMultiplier;
    let canInterpretLift = qualityGate.canInterpretLift;

    if (!reliability.available) {
        reasonCodes.push('forecast_reliability_unavailable');
        degradationReasons.push(reliability.globalGateReasons[0] ?? 'Forecast reliability is unavailable.');
        confidenceMultiplier = clamp(confidenceMultiplier * 0.84, 0.35, 1);
        canInterpretLift = false;
    } else {
        const reliabilityNeedsDegrade = reliability.globalGateStatus === 'degraded'
            || reliability.keyCohortGateStatus === 'degraded';
        if (reliabilityNeedsDegrade) {
            reasonCodes.push('forecast_reliability_low');
            const reason = reliability.globalGateReasons[0]
                ?? reliability.keyCohortGateReasons[0]
                ?? 'Forecast reliability is below policy thresholds.';
            degradationReasons.push(reason);
            const reliabilityPenalty = clamp(
                0.72 + clamp(reliability.globalReliabilityScore, 0, 1) * 0.24,
                0.72,
                0.96
            );
            confidenceMultiplier = clamp(confidenceMultiplier * reliabilityPenalty, 0.35, 1);
            canInterpretLift = false;
        }
    }

    const status: RecommendationQualityGate['status'] = degradationReasons.length > 0 ? 'degraded' : 'ok';
    return {
        ...qualityGate,
        status,
        reasonCodes,
        degradationReasons,
        canInterpretLift,
        confidenceMultiplier: roundTo(confidenceMultiplier),
    };
}

function buildTakeaways(brief: GoToMarketBriefResult): string[] {
    const takeaways: string[] = [];

    if (brief.qualityGate.status === 'degraded') {
        takeaways.push(
            brief.qualityGate.degradationReasons[0]
                ?? `Recommendation parse coverage is ${percent(brief.qualityGate.parseCoverage)} (minimum target ${percent(brief.qualityGate.minimumParseCoverage)}); confidence is currently degraded.`
        );
    }

    if (brief.topCohorts.length === 0) {
        takeaways.push('No stable cohorts were available yet. Gather more cross-user comparisons to produce a reliable launch plan.');
        return takeaways;
    }

    if (brief.forecastReliability.available) {
        takeaways.push(
            `Holdout reliability is ${percent(brief.forecastReliability.globalReliabilityScore)} at top-${brief.forecastReliability.topK} (sample n=${brief.forecastReliability.globalSampleSize}); global gate is ${brief.forecastReliability.globalGateStatus}.`
        );
    } else {
        takeaways.push(
            'Holdout reliability metrics are not available yet for this platform; treat cohort lift as directional.'
        );
    }

    const topLift = brief.topCohorts
        .filter((cohort) => typeof cohort.relativeLiftVsGlobalExposure === 'number')
        .sort((a, b) => (b.relativeLiftVsGlobalExposure ?? 0) - (a.relativeLiftVsGlobalExposure ?? 0))[0];

    if (topLift && typeof topLift.relativeLiftVsGlobalExposure === 'number') {
        takeaways.push(
            `${topLift.cohortLabel} is the strongest launch cohort at ${topLift.relativeLiftVsGlobalExposure.toFixed(2)}x lift versus global baseline.`
        );
    } else {
        const blockedLiftCohort = brief.topCohorts.find((cohort) => !cohort.liftInterpretation.isLiftInterpretable);
        if (blockedLiftCohort) {
            takeaways.push(
                `${blockedLiftCohort.cohortLabel} lift is currently gated: ${blockedLiftCohort.liftInterpretation.gateReasons[0] ?? 'insufficient stability evidence.'}`
            );
        }
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
                `${withPaths.length}/${brief.topCohorts.length} top cohorts show explicit ${brief.platform} reach paths from seed ${brief.seedVideoId} to target ${brief.targetVideoId}.`
            );
        } else {
            takeaways.push(
                `No concrete ${brief.platform} reach paths were found from seed ${brief.seedVideoId} within depth ${brief.settings.maxDepth}; consider a closer seed context.`
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
    lines.push(`- Quality Gate: ${brief.qualityGate.status} (coverage ${percent(brief.qualityGate.parseCoverage)}, parser drop ${percent(brief.qualityGate.parserDropRate)})`);
    lines.push('');
    lines.push('## Forecast Reliability');
    if (brief.forecastReliability.available) {
        lines.push(`- Global Reliability: ${percent(brief.forecastReliability.globalReliabilityScore)} (gate ${brief.forecastReliability.globalGateStatus}, n=${brief.forecastReliability.globalSampleSize})`);
        lines.push(`- Holdout metrics: top-${brief.forecastReliability.topK} hit ${percent(brief.forecastReliability.globalHitRate)}, precision ${percent(brief.forecastReliability.globalPrecisionAtK)}, calibration ${percent(brief.forecastReliability.globalCalibrationScore)}`);
        lines.push(`- Adjacent-window reliability delta: ${brief.forecastReliability.adjacentWindowReliabilityDelta === null ? '-' : brief.forecastReliability.adjacentWindowReliabilityDelta.toFixed(3)}`);
        lines.push(`- Key cohort gate: ${brief.forecastReliability.keyCohortGateStatus}`);
        if (brief.forecastReliability.globalGateReasons.length > 0) {
            lines.push(`- Global gate notes: ${brief.forecastReliability.globalGateReasons.join(' ')}`);
        }
        if (brief.forecastReliability.keyCohortGateReasons.length > 0) {
            lines.push(`- Key cohort notes: ${brief.forecastReliability.keyCohortGateReasons.join(' ')}`);
        }
    } else {
        lines.push(`- ${brief.forecastReliability.globalGateReasons[0] ?? 'Holdout reliability metrics are unavailable.'}`);
    }
    lines.push('');
    lines.push('## Global Baseline');
    lines.push(`- Exposure: ${percent(brief.global.targetExposureRate)} (${percent(brief.global.targetExposureConfidenceInterval.low)}-${percent(brief.global.targetExposureConfidenceInterval.high)})`);
    lines.push(`- Direct from Seed: ${percent(brief.global.directProbabilityFromSeed)}`);
    lines.push(`- Reach from Seed: ${percent(brief.global.reachProbabilityFromSeed)}`);
    lines.push('');
    lines.push('## Top Cohorts');
    lines.push('| Cohort | Users | Exposure (CI) | Lift vs Global | Lift Gate | Reach from Seed | Score |');
    lines.push('| --- | ---: | --- | ---: | --- | ---: | ---: |');
    for (const cohort of brief.topCohorts) {
        lines.push(
            `| ${cohort.cohortLabel} | ${cohort.users} | ${percent(cohort.targetExposureRate)} (${percent(cohort.exposureConfidenceInterval.low)}-${percent(cohort.exposureConfidenceInterval.high)}) | ${typeof cohort.relativeLiftVsGlobalExposure === 'number' ? `${cohort.relativeLiftVsGlobalExposure.toFixed(2)}x` : '-'} | ${cohort.liftInterpretation.isLiftInterpretable ? 'pass' : 'gated'} | ${percent(cohort.reachProbabilityFromSeed)} | ${cohort.score.toFixed(3)} |`
        );
    }
    lines.push('');
    lines.push(`## Predicted Reach Paths (${brief.platform} Evidence)`);
    for (const cohort of brief.topCohorts) {
        lines.push(`### ${cohort.cohortLabel}`);
        if (!cohort.liftInterpretation.isLiftInterpretable) {
            lines.push(`- Lift interpretation gated: ${cohort.liftInterpretation.gateReasons.join(' ')}`);
        }
        if (cohort.predictedReachPaths.length === 0) {
            lines.push('- No high-confidence path found in the configured depth/branch window.');
            continue;
        }
        for (const [index, path] of cohort.predictedReachPaths.entries()) {
            lines.push(
                `${index + 1}. ${path.pathVideoIds.join(' -> ')} (p=${(path.probability * 100).toFixed(2)}%, depth=${path.depth}, ${path.platform} support=${path.supportingTransitionWeight})`
            );
            lines.push(`   Evidence: ${path.edgeEvidence.map((edge) => `${edge.fromVideoId}->${edge.toVideoId} (p=${edge.probability.toFixed(3)}, w=${edge.support.toFixed(2)})`).join('; ')}`);
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
    qualityGate: RecommendationQualityGate,
    settings?: {
        topCohorts?: number;
        maxPathsPerCohort?: number;
        pathBranchLimit?: number;
        liftStabilityByCohort?: Map<string, CohortLiftStabilityEvidence>;
        forecastReliability?: BriefReliabilitySummary;
    }
): GoToMarketBriefResult {
    const topCohortsLimit = clamp(settings?.topCohorts ?? 5, 1, 12);
    const maxPathsPerCohort = clamp(settings?.maxPathsPerCohort ?? 3, 1, 10);
    const pathBranchLimit = clamp(settings?.pathBranchLimit ?? 6, 1, 25);
    const reliabilityForBrief = settings?.forecastReliability
        ?? buildUnavailableReliabilitySummary(
            'Holdout reliability metrics were not provided for this brief.'
        );
    const gatedQualityGate = settings?.forecastReliability
        ? applyReliabilityPenaltyToQualityGate(qualityGate, settings.forecastReliability)
        : qualityGate;
    const forecast = computeAudienceForecastFromModel(
        model,
        currentUserId,
        options,
        gatedQualityGate,
        settings?.liftStabilityByCohort
    );

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
                forecast.platform,
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
            liftInterpretation: cohort.liftInterpretation,
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
        qualityGate: forecast.qualityGate,
        forecastReliability: reliabilityForBrief,
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

    const context = await loadMaterializedAudienceModelContext(options.platform);
    const { model, qualityGate } = context;
    const liftStabilityByCohort = await loadCohortLiftStabilityEvidence(
        options.platform,
        targetVideoId,
    );

    let reliabilitySummary: BriefReliabilitySummary;
    try {
        const evaluation = await generateForecastEvaluation(options.platform);
        reliabilitySummary = deriveBriefReliabilitySummary(evaluation);
    } catch (error) {
        if (error instanceof AudienceForecastInputError) {
            reliabilitySummary = buildUnavailableReliabilitySummary(error.message);
        } else {
            throw error;
        }
    }

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
        qualityGate,
        {
            topCohorts: options.topCohorts,
            maxPathsPerCohort: options.maxPathsPerCohort,
            pathBranchLimit: options.pathBranchLimit,
            liftStabilityByCohort,
            forecastReliability: reliabilitySummary,
        }
    );
}
