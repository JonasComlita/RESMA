import { Router, type Response } from 'express';
import { query } from 'express-validator';
import type { ApiKeyRequest } from '../middleware/requireApiKey.js';
import { requireApiKey } from '../middleware/requireApiKey.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
    AudienceForecastInputError,
    generateAudienceForecast,
    getCohortUserIds,
} from '../services/audienceForecast.js';
import {
    generateRecommendationMap,
    generateRecommendationMapForUsers,
    TraversalInputError,
} from '../services/recommendationTraversal.js';
import { generateGoToMarketCohortBrief } from '../services/goToMarketBrief.js';
import { prisma } from '../lib/prisma.js';
import {
    DataQualityInputError,
    generateDataQualityDiagnostics,
} from '../services/dataQuality.js';

export const programmaticApiRouter: Router = Router();

const SUPPORTED_ANALYSIS_PLATFORMS = ['youtube', 'instagram', 'twitter', 'tiktok'] as const;

type ResponseFormat = 'json' | 'llm';

function clampNumber(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function toPercent(value: number | null | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    return `${Math.round(value * 100)}%`;
}

function parseFormat(rawValue: unknown): ResponseFormat {
    return rawValue === 'llm' ? 'llm' : 'json';
}

const platformQueryValidation = query('platform')
    .optional()
    .trim()
    .isIn(Array.from(SUPPORTED_ANALYSIS_PLATFORMS))
    .withMessage('platform must be one of youtube, instagram, twitter, or tiktok');

const formatQueryValidation = query('format')
    .optional()
    .isIn(['json', 'llm'])
    .withMessage('format must be either json or llm');

function sendProgrammaticResponse(
    req: ApiKeyRequest,
    res: Response,
    payload: {
        kind: string;
        data: Record<string, unknown>;
        meta?: Record<string, unknown>;
        llm: {
            title: string;
            bullets: string[];
            markdown: string;
            followUpQuestions?: string[];
            caveats?: string[];
        };
    },
) {
    const format = parseFormat(req.query.format);
    const baseResponse = {
        success: true,
        data: payload.data,
        meta: {
            authMode: req.authMode ?? 'api_key',
            authSubject: req.apiKey?.lookupId ?? null,
            privacyMode: 'aggregate-only',
            ...(payload.meta ?? {}),
        },
    };

    if (format !== 'llm') {
        return res.json(baseResponse);
    }

    return res.json({
        ...baseResponse,
        format: 'llm',
        llm: {
            kind: payload.kind,
            title: payload.llm.title,
            bullets: payload.llm.bullets,
            markdown: payload.llm.markdown,
            followUpQuestions: payload.llm.followUpQuestions ?? [],
            caveats: payload.llm.caveats ?? [],
        },
    });
}

programmaticApiRouter.get(
    '/analysis/audience-forecast',
    requireApiKey({ routeKey: 'analysis.audience-forecast', requiredScopes: ['analysis:read'] }),
    ...validateRequest([
        query('targetVideoId')
            .trim()
            .notEmpty()
            .withMessage('targetVideoId is required'),
        query('seedVideoId')
            .optional()
            .trim()
            .notEmpty()
            .withMessage('seedVideoId cannot be empty'),
        platformQueryValidation,
        query('maxDepth')
            .optional()
            .isInt({ min: 1, max: 6 })
            .withMessage('maxDepth must be between 1 and 6'),
        query('beamWidth')
            .optional()
            .isInt({ min: 5, max: 120 })
            .withMessage('beamWidth must be between 5 and 120'),
        formatQueryValidation,
    ]),
    async (req: ApiKeyRequest, res, next) => {
        try {
            const targetVideoId = String(req.query.targetVideoId || '').trim();
            const seedVideoId = String(req.query.seedVideoId || '').trim() || undefined;
            const platform = String(req.query.platform || 'youtube').toLowerCase();
            const maxDepthRaw = Number.parseInt(String(req.query.maxDepth || '3'), 10);
            const beamWidthRaw = Number.parseInt(String(req.query.beamWidth || '30'), 10);
            const maxDepth = clampNumber(Number.isFinite(maxDepthRaw) ? maxDepthRaw : 3, 1, 6);
            const beamWidth = clampNumber(Number.isFinite(beamWidthRaw) ? beamWidthRaw : 30, 5, 120);

            const forecast = await generateAudienceForecast(req.userId!, {
                targetVideoId,
                seedVideoId,
                platform,
                maxDepth,
                beamWidth,
            });

            const topCohort = forecast.recommendedAudienceCohorts[0];
            return sendProgrammaticResponse(req, res, {
                kind: 'audience_forecast',
                data: { forecast },
                meta: {
                    source: 'observatory-cohorts',
                },
                llm: {
                    title: `Audience forecast for ${targetVideoId}`,
                    bullets: [
                        `Global exposure estimate: ${toPercent(forecast.global.targetExposureRate) ?? 'unknown'} across ${forecast.networkEffect.comparedUsers} compared users.`,
                        topCohort
                            ? `Top cohort: ${topCohort.cohortLabel} with fit score ${topCohort.fitScore.toFixed(2)} and exposure ${toPercent(topCohort.targetExposureRate) ?? 'unknown'}.`
                            : 'No cohort cleared the recommendation threshold for this request.',
                        `Quality gate: ${forecast.qualityGate.status}, parse coverage ${toPercent(forecast.qualityGate.parseCoverage) ?? 'unknown'}, cohort stability ${forecast.qualityGate.cohortStabilityScore.toFixed(2)}.`,
                    ],
                    markdown: [
                        `# Audience Forecast`,
                        '',
                        `- Target video: \`${forecast.targetVideoId}\``,
                        `- Platform: ${forecast.platform}`,
                        `- Compared users: ${forecast.networkEffect.comparedUsers}`,
                        `- Global exposure: ${toPercent(forecast.global.targetExposureRate) ?? 'unknown'}`,
                        topCohort
                            ? `- Best cohort: ${topCohort.cohortLabel} (${topCohort.users} users, fit ${topCohort.fitScore.toFixed(2)})`
                            : '- Best cohort: none',
                        `- Quality gate: ${forecast.qualityGate.status}`,
                    ].join('\n'),
                    followUpQuestions: [
                        'Which cohort has the strongest lift versus global baseline?',
                        'What quality-gate caveats should I mention when citing this forecast?',
                    ],
                    caveats: forecast.qualityGate.degradationReasons,
                },
            });
        } catch (error) {
            if (error instanceof AudienceForecastInputError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    details: error.details,
                });
            }

            next(error);
        }
    },
);

programmaticApiRouter.get(
    '/analysis/recommendation-map',
    requireApiKey({ routeKey: 'analysis.recommendation-map', requiredScopes: ['analysis:read'] }),
    ...validateRequest([
        query('seedVideoId')
            .trim()
            .notEmpty()
            .withMessage('seedVideoId is required'),
        query('maxDepth')
            .optional()
            .isInt({ min: 1, max: 8 })
            .withMessage('maxDepth must be between 1 and 8'),
        query('maxNodes')
            .optional()
            .isInt({ min: 1, max: 300 })
            .withMessage('maxNodes must be between 1 and 300'),
        platformQueryValidation,
        query('cohortId')
            .optional()
            .trim()
            .notEmpty()
            .withMessage('cohortId cannot be empty'),
        formatQueryValidation,
    ]),
    async (req: ApiKeyRequest, res, next) => {
        try {
            const seedVideoId = String(req.query.seedVideoId || '').trim();
            const maxDepthRaw = Number.parseInt(String(req.query.maxDepth || '3'), 10);
            const maxNodesRaw = Number.parseInt(String(req.query.maxNodes || '40'), 10);
            const maxDepth = clampNumber(Number.isFinite(maxDepthRaw) ? maxDepthRaw : 3, 1, 8);
            const maxNodes = clampNumber(Number.isFinite(maxNodesRaw) ? maxNodesRaw : 40, 1, 300);
            const platform = String(req.query.platform || 'youtube').toLowerCase();
            const cohortId = String(req.query.cohortId || '').trim() || undefined;

            const map = cohortId
                ? await (async () => {
                    const cohortUsers = await getCohortUserIds(platform, cohortId);
                    return generateRecommendationMapForUsers(
                        cohortUsers,
                        {
                            seedVideoId,
                            maxDepth,
                            maxNodes,
                            platform,
                        },
                        { cohortId },
                    );
                })()
                : await generateRecommendationMap(req.userId!, {
                    seedVideoId,
                    maxDepth,
                    maxNodes,
                    platform,
                });

            return sendProgrammaticResponse(req, res, {
                kind: 'recommendation_map',
                data: { map },
                meta: {
                    source: 'observatory-cohorts',
                },
                llm: {
                    title: `Recommendation map for ${seedVideoId}`,
                    bullets: [
                        `BFS unique videos: ${map.summary.bfsUniqueVideos}, DFS unique videos: ${map.summary.dfsUniqueVideos}.`,
                        `Shared overlap rate: ${toPercent(map.summary.sharedRate) ?? 'unknown'} with average confidence ${map.summary.avgPredictionConfidence.toFixed(2)}.`,
                        map.scope
                            ? `Scope: ${map.scope.type} across ${map.scope.userCount} users.`
                            : 'Scope: personal observatory view.',
                    ],
                    markdown: [
                        `# Recommendation Map`,
                        '',
                        `- Seed video: \`${map.seedVideoId}\``,
                        `- Platform: ${map.platform}`,
                        `- Shared videos: ${map.summary.sharedVideos}`,
                        `- Loop edges: ${map.summary.totalLoopEdges}`,
                        `- Scope: ${map.scope ? `${map.scope.type} (${map.scope.userCount} users)` : 'personal'}`,
                    ].join('\n'),
                    followUpQuestions: [
                        'Which nodes are discovered by both BFS and DFS?',
                        'Where do the biggest loop clusters show up in this map?',
                    ],
                },
            });
        } catch (error) {
            if (error instanceof TraversalInputError || error instanceof AudienceForecastInputError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    details: error.details,
                });
            }

            next(error);
        }
    },
);

programmaticApiRouter.get(
    '/analysis/go-to-market-brief',
    requireApiKey({ routeKey: 'analysis.go-to-market-brief', requiredScopes: ['analysis:read'] }),
    ...validateRequest([
        query('targetVideoId')
            .trim()
            .notEmpty()
            .withMessage('targetVideoId is required'),
        query('seedVideoId')
            .optional()
            .trim()
            .notEmpty()
            .withMessage('seedVideoId cannot be empty'),
        platformQueryValidation,
        query('maxDepth')
            .optional()
            .isInt({ min: 1, max: 6 })
            .withMessage('maxDepth must be between 1 and 6'),
        query('beamWidth')
            .optional()
            .isInt({ min: 5, max: 120 })
            .withMessage('beamWidth must be between 5 and 120'),
        query('topCohorts')
            .optional()
            .isInt({ min: 1, max: 12 })
            .withMessage('topCohorts must be between 1 and 12'),
        query('maxPathsPerCohort')
            .optional()
            .isInt({ min: 1, max: 10 })
            .withMessage('maxPathsPerCohort must be between 1 and 10'),
        query('pathBranchLimit')
            .optional()
            .isInt({ min: 1, max: 25 })
            .withMessage('pathBranchLimit must be between 1 and 25'),
        formatQueryValidation,
    ]),
    async (req: ApiKeyRequest, res, next) => {
        try {
            const targetVideoId = String(req.query.targetVideoId || '').trim();
            const seedVideoId = String(req.query.seedVideoId || '').trim() || undefined;
            const platform = String(req.query.platform || 'youtube').toLowerCase();
            const maxDepthRaw = Number.parseInt(String(req.query.maxDepth || '3'), 10);
            const beamWidthRaw = Number.parseInt(String(req.query.beamWidth || '30'), 10);
            const topCohortsRaw = Number.parseInt(String(req.query.topCohorts || '5'), 10);
            const maxPathsRaw = Number.parseInt(String(req.query.maxPathsPerCohort || '3'), 10);
            const pathBranchLimitRaw = Number.parseInt(String(req.query.pathBranchLimit || '6'), 10);

            const brief = await generateGoToMarketCohortBrief(req.userId!, {
                targetVideoId,
                seedVideoId,
                platform,
                maxDepth: clampNumber(Number.isFinite(maxDepthRaw) ? maxDepthRaw : 3, 1, 6),
                beamWidth: clampNumber(Number.isFinite(beamWidthRaw) ? beamWidthRaw : 30, 5, 120),
                topCohorts: clampNumber(Number.isFinite(topCohortsRaw) ? topCohortsRaw : 5, 1, 12),
                maxPathsPerCohort: clampNumber(Number.isFinite(maxPathsRaw) ? maxPathsRaw : 3, 1, 10),
                pathBranchLimit: clampNumber(Number.isFinite(pathBranchLimitRaw) ? pathBranchLimitRaw : 6, 1, 25),
            });

            return sendProgrammaticResponse(req, res, {
                kind: 'go_to_market_brief',
                data: { brief },
                meta: {
                    source: 'observatory-cohorts',
                },
                llm: {
                    title: `Go-to-market brief for ${targetVideoId}`,
                    bullets: [
                        `Top cohorts returned: ${brief.topCohorts.length}.`,
                        `Forecast reliability: ${brief.forecastReliability.available ? brief.forecastReliability.globalGateStatus : 'unavailable'}.`,
                        brief.keyTakeaways[0] ?? 'No key takeaway was generated.',
                    ],
                    markdown: brief.markdown,
                    followUpQuestions: [
                        'Which cohort should we prioritize first and why?',
                        'What reliability caveats matter before turning this into creator advice?',
                    ],
                    caveats: brief.qualityGate.degradationReasons,
                },
            });
        } catch (error) {
            if (error instanceof AudienceForecastInputError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    details: error.details,
                });
            }

            next(error);
        }
    },
);

programmaticApiRouter.get(
    '/analysis/data-quality',
    requireApiKey({ routeKey: 'analysis.data-quality', requiredScopes: ['analysis:read'] }),
    ...validateRequest([
        platformQueryValidation,
        query('windowHours')
            .optional()
            .isInt({ min: 1, max: 24 * 180 })
            .withMessage(`windowHours must be between 1 and ${24 * 180}`),
        formatQueryValidation,
    ]),
    async (req: ApiKeyRequest, res, next) => {
        try {
            const platform = String(req.query.platform || 'youtube').toLowerCase();
            const windowHoursRaw = Number.parseInt(String(req.query.windowHours || String(24 * 14)), 10);
            const windowHours = clampNumber(Number.isFinite(windowHoursRaw) ? windowHoursRaw : (24 * 14), 1, 24 * 180);
            const diagnostics = await generateDataQualityDiagnostics(platform, windowHours);

            return sendProgrammaticResponse(req, res, {
                kind: 'data_quality',
                data: { diagnostics },
                llm: {
                    title: `Data-quality diagnostics for ${platform}`,
                    bullets: [
                        `Snapshots: ${diagnostics.totals.snapshots}, stitched feed items: ${diagnostics.totals.stitchedFeedItems}.`,
                        `Parse coverage: ${toPercent(diagnostics.recommendations.parseCoverage) ?? 'unknown'}, parser drop rate: ${toPercent(diagnostics.recommendations.parserDropRate) ?? 'unknown'}.`,
                        `Quality gate: ${diagnostics.qualityGate.status}, cohort stability ${diagnostics.cohorts.stabilityScore.toFixed(2)}.`,
                    ],
                    markdown: [
                        `# Data Quality`,
                        '',
                        `- Platform: ${diagnostics.platform}`,
                        `- Window: ${diagnostics.windowHours} hours`,
                        `- Parse coverage: ${toPercent(diagnostics.recommendations.parseCoverage) ?? 'unknown'}`,
                        `- Strict recommendation rows: ${diagnostics.recommendations.strictRecommendationRows}`,
                        `- Cohort stability: ${diagnostics.cohorts.stabilityScore.toFixed(2)}`,
                        `- Quality gate: ${diagnostics.qualityGate.status}`,
                    ].join('\n'),
                    followUpQuestions: [
                        'Which degradation reasons are blocking trustworthy lift interpretation?',
                        'What should we fix first to improve parse coverage and cohort stability?',
                    ],
                    caveats: diagnostics.qualityGate.degradationReasons,
                },
            });
        } catch (error) {
            if (error instanceof DataQualityInputError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    details: error.details,
                });
            }

            next(error);
        }
    },
);

programmaticApiRouter.get(
    '/analysis/stats',
    requireApiKey({ routeKey: 'analysis.stats', requiredScopes: ['analysis:read'] }),
    ...validateRequest([formatQueryValidation]),
    async (req: ApiKeyRequest, res, next) => {
        try {
            const [
                totalUsers,
                totalSnapshots,
                totalFeedItems,
                totalCreators,
                recentSnapshots,
            ] = await Promise.all([
                prisma.user.count(),
                prisma.feedSnapshot.count(),
                prisma.feedItem.count(),
                prisma.creator.count({ where: { verified: true } }),
                prisma.feedSnapshot.count({
                    where: {
                        capturedAt: {
                            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                        },
                    },
                }),
            ]);

            return sendProgrammaticResponse(req, res, {
                kind: 'observatory_stats',
                data: {
                    stats: {
                        totalUsers,
                        totalSnapshots,
                        totalFeedItems,
                        totalCreators,
                        recentSnapshots,
                    },
                },
                llm: {
                    title: 'RESMA observatory stats',
                    bullets: [
                        `${totalUsers} pseudonymous contributors and ${totalSnapshots} snapshots currently in the observatory.`,
                        `${totalFeedItems} feed items and ${totalCreators} verified creators are represented in aggregate outputs.`,
                        `${recentSnapshots} snapshots were captured in the last 24 hours.`,
                    ],
                    markdown: [
                        `# Observatory Stats`,
                        '',
                        `- Contributors: ${totalUsers}`,
                        `- Snapshots: ${totalSnapshots}`,
                        `- Feed items: ${totalFeedItems}`,
                        `- Verified creators: ${totalCreators}`,
                        `- Recent snapshots (24h): ${recentSnapshots}`,
                    ].join('\n'),
                    followUpQuestions: [
                        'How fast is the observatory growing week over week?',
                        'What does this scale imply for forecast reliability on each platform?',
                    ],
                },
            });
        } catch (error) {
            next(error);
        }
    },
);
