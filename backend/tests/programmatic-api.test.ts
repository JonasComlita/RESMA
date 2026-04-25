import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        apiKey: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        apiKeyUsageDaily: {
            aggregate: vi.fn(),
            upsert: vi.fn(),
        },
        user: {
            count: vi.fn(),
        },
        feedSnapshot: {
            count: vi.fn(),
        },
        feedItem: {
            count: vi.fn(),
        },
        creator: {
            count: vi.fn(),
        },
        agencyReportRun: {
            findFirst: vi.fn(),
        },
        $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[])),
        $queryRaw: vi.fn(),
    },
}));

vi.mock('../src/services/audienceForecast.js', async () => {
    const actual = await vi.importActual<typeof import('../src/services/audienceForecast.js')>('../src/services/audienceForecast.js');
    return {
        ...actual,
        generateAudienceForecast: vi.fn(),
        getCohortUserIds: vi.fn(),
    };
});

vi.mock('../src/services/agencyReports.js', async () => {
    const actual = await vi.importActual<typeof import('../src/services/agencyReports.js')>('../src/services/agencyReports.js');
    return {
        ...actual,
        loadAgencyReportRunForUser: vi.fn(),
        markAgencyReportExportAccess: vi.fn(),
        serializeStoredAgencyReport: vi.fn(),
    };
});

const { prisma } = await import('../src/lib/prisma.js');
const { hashApiKey } = await import('../src/services/apiKeys.js');
const { generateAudienceForecast } = await import('../src/services/audienceForecast.js');
const {
    loadAgencyReportRunForUser,
    markAgencyReportExportAccess,
    serializeStoredAgencyReport,
} = await import('../src/services/agencyReports.js');
const { default: app } = await import('../src/index');

const rawApiKey = 'resma_test.lookup123.secret456';

describe('Programmatic API routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({
            id: 'api-key-1',
            userId: 'user-1',
            name: 'Agent key',
            accessPackage: 'AGENCY_PILOT',
            lookupId: 'lookup123',
            keyHash: hashApiKey(rawApiKey),
            keyPrefix: 'resma_test.lookup',
            status: 'ACTIVE',
            scopes: ['analysis:read', 'reports:read'],
            dailyQuota: 500,
            monthlyQuota: 10000,
            expiresAt: null,
            revokedAt: null,
        } as any);
        vi.mocked(prisma.apiKeyUsageDaily.aggregate).mockResolvedValue({
            _sum: {
                requestCount: 0,
            },
        } as any);
        vi.mocked(prisma.user.count).mockResolvedValue(12 as any);
        vi.mocked(prisma.feedSnapshot.count).mockResolvedValue(120 as any);
        vi.mocked(prisma.feedItem.count).mockResolvedValue(880 as any);
        vi.mocked(prisma.creator.count).mockResolvedValue(18 as any);
    });

    it('serves observatory stats behind API key auth and records usage', async () => {
        const response = await request(app)
            .get('/api/v1/analysis/stats')
            .set('x-api-key', rawApiKey);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.stats.totalUsers).toBe(12);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(prisma.$transaction).toHaveBeenCalled();
        expect(prisma.apiKeyUsageDaily.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                apiKeyId_usageDate_routeKey: expect.objectContaining({
                    apiKeyId: 'api-key-1',
                    routeKey: 'analysis.stats',
                }),
            }),
        }));
    });

    it('returns an llm envelope for audience forecasts', async () => {
        vi.mocked(generateAudienceForecast).mockResolvedValue({
            platform: 'youtube',
            targetVideoId: 'target-001',
            seedVideoId: 'seed-001',
            settings: {
                maxDepth: 3,
                beamWidth: 30,
            },
            networkEffect: {
                comparedUsers: 14,
                comparedFeedItems: 120,
                comparedTransitions: 85,
                pairwiseComparisons: 42,
                cohortCount: 4,
                networkStrength: 0.82,
            },
            global: {
                targetExposureRate: 0.41,
                targetExposureConfidenceInterval: {
                    low: 0.33,
                    high: 0.48,
                },
                directProbabilityFromSeed: 0.2,
                reachProbabilityFromSeed: 0.53,
            },
            stabilityConstraints: {
                minimumCohortUsersForLift: 3,
                minimumCohortTransitionSamplesForLift: 6,
                maximumExposureConfidenceIntervalWidthForLift: 0.9,
                minimumAdjacentWindowUsersForLiftStability: 2,
                maximumAdjacentWindowLiftDelta: 0.55,
            },
            qualityGate: {
                status: 'ok',
                parseCoverage: 0.9,
                parserDropRate: 0.1,
                rawRecommendationRows: 200,
                minimumParseCoverage: 0.2,
                maxParserDropRate: 0.8,
                strictRecommendationRows: 120,
                duplicateRecommendationRows: 5,
                dedupeImpactRate: 0.03,
                minimumStrictRecommendationRows: 8,
                comparedUsers: 14,
                minimumComparedUsers: 4,
                cohortStabilityScore: 0.79,
                minimumCohortStabilityScore: 0.62,
                metadataIntegrityScore: 0.94,
                minimumMetadataIntegrityScore: 0.6,
                snapshotsWithMetadata: 20,
                decodedMetadataSnapshots: 18,
                invalidMetadataSnapshots: 2,
                minimumCohortUsersForLift: 3,
                canInterpretLift: true,
                reasonCodes: [],
                degradationReasons: [],
                confidenceMultiplier: 1,
            },
            recommendedAudienceCohorts: [
                {
                    cohortId: 'gaming|high|low',
                    cohortLabel: 'Gaming loyalists',
                    users: 6,
                    fitScore: 0.88,
                    targetExposureRate: 0.61,
                    exposureConfidenceInterval: { low: 0.5, high: 0.7 },
                    directProbabilityFromSeed: 0.25,
                    reachProbabilityFromSeed: 0.69,
                    relativeLiftVsGlobalExposure: 0.2,
                    liftInterpretation: {
                        isLiftInterpretable: true,
                        gateReasons: [],
                        cohortTransitionSamples: 12,
                        exposureConfidenceIntervalWidth: 0.2,
                        adjacentWindowLiftDelta: 0.04,
                        adjacentWindowUsers: { earlier: 3, later: 3 },
                    },
                    score: 0.91,
                },
            ],
            cohorts: [],
        } as any);

        const response = await request(app)
            .get('/api/v1/analysis/audience-forecast?targetVideoId=target-001&seedVideoId=seed-001&format=llm')
            .set('x-api-key', rawApiKey);

        expect(response.status).toBe(200);
        expect(response.body.format).toBe('llm');
        expect(response.body.llm.kind).toBe('audience_forecast');
        expect(response.body.llm.markdown).toContain('Audience Forecast');
        expect(response.body.data.forecast.targetVideoId).toBe('target-001');
    });

    it('blocks premium analysis routes for contributor free keys', async () => {
        vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({
            id: 'api-key-1',
            userId: 'user-1',
            name: 'Free key',
            accessPackage: 'CONTRIBUTOR_FREE',
            lookupId: 'lookup123',
            keyHash: hashApiKey(rawApiKey),
            keyPrefix: 'resma_test.lookup',
            status: 'ACTIVE',
            scopes: ['analysis:read'],
            dailyQuota: 100,
            monthlyQuota: 1000,
            expiresAt: null,
            revokedAt: null,
        } as any);

        const response = await request(app)
            .get('/api/v1/analysis/audience-forecast?targetVideoId=target-001')
            .set('x-api-key', rawApiKey);

        expect(response.status).toBe(403);
        expect(response.body.error).toContain('does not allow this route');
    });

    it('serves saved report exports over the programmatic API', async () => {
        vi.mocked(loadAgencyReportRunForUser).mockResolvedValue({
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            userId: 'user-1',
            availableExportFormats: ['json', 'client-report'],
            resultPayload: {
                exports: {
                    clientReport: {
                        title: 'Audience Opportunity Brief',
                    },
                },
            },
        } as any);
        vi.mocked(serializeStoredAgencyReport).mockReturnValue({
            format: 'client-report',
            content: {
                title: 'Audience Opportunity Brief',
                privacyMode: 'aggregate-only',
            },
        } as any);

        const response = await request(app)
            .get('/api/v1/reports/runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/export?format=client-report')
            .set('x-api-key', rawApiKey);

        expect(response.status).toBe(200);
        expect(response.body.data.export.format).toBe('client-report');
        expect(response.body.data.export.content.privacyMode).toBe('aggregate-only');
        expect(markAgencyReportExportAccess).toHaveBeenCalledWith(expect.objectContaining({
            apiKeyId: 'api-key-1',
            reportRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            format: 'client-report',
        }));
    });
});
