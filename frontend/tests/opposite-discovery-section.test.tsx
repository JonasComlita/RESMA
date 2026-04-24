import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OppositeDiscoverySection } from '../src/components/dashboard/OppositeDiscoverySection';
import type { OppositeDiscoveryResult } from '../src/types/oppositeDiscovery';

function createResult(overrides: Partial<OppositeDiscoveryResult> = {}): OppositeDiscoveryResult {
    return {
        platform: 'youtube',
        bubble: {
            score: 0.78,
            level: 'high',
            dominantCategory: 'gaming',
            diversityBand: 'medium',
            loyaltyBand: 'high',
            topCategoryShare: 0.82,
            topCreatorShare: 0.61,
            explanations: ['Your feed is heavily concentrated in one category.'],
        },
        currentCohort: {
            cohortId: 'gaming|medium|high',
            cohortLabel: 'gaming / medium discovery / high loyalty',
            users: 3,
            materialized: true,
        },
        oppositeCohorts: [
            {
                cohortId: 'beauty|medium|medium',
                cohortLabel: 'beauty / medium discovery / medium loyalty',
                users: 3,
                distanceScore: 0.84,
                dominantCategory: 'beauty',
                diversityBand: 'medium',
                loyaltyBand: 'medium',
                videoOverlap: 0.05,
                transitionOverlap: 0.08,
                whyFar: ['Very low seen-video overlap'],
            },
        ],
        candidates: [
            {
                videoId: 'oppo001',
                sourceCohortId: 'beauty|medium|medium',
                sourceCohortLabel: 'beauty / medium discovery / medium loyalty',
                cohortExposureRate: 0.67,
                currentCohortExposureRate: 0,
                underexposureLift: 0.67,
                distanceScore: 0.84,
                score: 0.71,
                explanations: ['Appears in 67% of the distant cohort.'],
            },
        ],
        bridgeContent: [
            {
                videoId: 'bridge001',
                sourceCohortId: 'beauty|medium|medium',
                sourceCohortLabel: 'beauty / medium discovery / medium loyalty',
                pathSeeds: ['gmid1'],
                bestPath: ['gmid1', 'bridge001'],
                pathReachProbability: 0.62,
                underexposureLift: 0.44,
                distanceScore: 0.72,
                score: 0.61,
                label: 'Common elsewhere, reachable from what you already watch',
            },
        ],
        diversityGap: {
            dominantCategoryShare: 0.82,
            outsideCurrentCohortCandidateCount: 8,
            bridgeCandidateCount: 1,
            distantCohortCount: 1,
        },
        qualityGate: {
            status: 'ok',
            parseCoverage: 0.91,
            parserDropRate: 0.09,
            minimumParseCoverage: 0.2,
            maxParserDropRate: 0.4,
            strictRecommendationRows: 18,
            minimumStrictRecommendationRows: 12,
            comparedUsers: 9,
            minimumComparedUsers: 3,
            cohortStabilityScore: 0.91,
            minimumCohortStabilityScore: 0.7,
            metadataIntegrityScore: 1,
            minimumMetadataIntegrityScore: 0.6,
            snapshotsWithMetadata: 0,
            decodedMetadataSnapshots: 0,
            invalidMetadataSnapshots: 0,
            minimumCohortUsersForLift: 3,
            canInterpretLift: true,
            reasonCodes: [],
            degradationReasons: [],
            confidenceMultiplier: 1,
        },
        ...overrides,
    };
}

describe('OppositeDiscoverySection', () => {
    it('renders populated opposite-discovery content', () => {
        const markup = renderToStaticMarkup(
            <OppositeDiscoverySection
                platform="youtube"
                result={createResult()}
                error={null}
                isLoading={false}
                onRefresh={() => {}}
            />
        );

        expect(markup).toContain('Opposite-Spectrum Discovery');
        expect(markup).toContain('Underexposed Candidates');
        expect(markup).toContain('oppo001');
        expect(markup).toContain('Best path: gmid1 -&gt; bridge001');
    });

    it('renders degraded confidence messaging and error states', () => {
        const markup = renderToStaticMarkup(
            <OppositeDiscoverySection
                platform="youtube"
                result={createResult({
                    qualityGate: {
                        ...createResult().qualityGate,
                        status: 'degraded',
                        degradationReasons: ['Parser coverage is below target.'],
                    },
                })}
                error="Unable to load opposite-spectrum discovery."
                isLoading={false}
                onRefresh={() => {}}
            />
        );

        expect(markup).toContain('Discovery confidence is currently degraded');
        expect(markup).toContain('Parser coverage is below target.');
        expect(markup).toContain('Unable to load opposite-spectrum discovery.');
    });

    it('renders empty candidate and bridge states', () => {
        const markup = renderToStaticMarkup(
            <OppositeDiscoverySection
                platform="youtube"
                result={createResult({
                    candidates: [],
                    bridgeContent: [],
                    diversityGap: {
                        dominantCategoryShare: 0.82,
                        outsideCurrentCohortCandidateCount: 0,
                        bridgeCandidateCount: 0,
                        distantCohortCount: 1,
                    },
                })}
                error={null}
                isLoading={false}
                onRefresh={() => {}}
            />
        );

        expect(markup).toContain('No outside-cohort candidates cleared the current quality and distance thresholds yet.');
        expect(markup).toContain('No bridge items were reachable within the current depth and beam limits.');
    });
});
