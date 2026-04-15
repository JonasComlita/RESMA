import { describe, expect, it } from 'vitest';
import { evaluateTransitionPredictor } from '../src/services/forecastEvaluation';

describe('Forecast evaluation metrics', () => {
    it('computes hit rate, precision, and reliability for transition predictions', () => {
        const cases = [
            {
                userId: 'u1',
                sourceVideoId: 'A',
                actualTargets: new Set(['B', 'C']),
                cohortId: 'gaming|medium|low',
            },
            {
                userId: 'u2',
                sourceVideoId: 'A',
                actualTargets: new Set(['B']),
                cohortId: 'gaming|medium|low',
            },
            {
                userId: 'u3',
                sourceVideoId: 'X',
                actualTargets: new Set(['Y']),
                cohortId: 'beauty|low|high',
            },
        ];

        const transitions = new Map([
            ['A', [
                { toVideoId: 'B', probability: 0.7 },
                { toVideoId: 'D', probability: 0.3 },
            ]],
            ['X', [
                { toVideoId: 'Y', probability: 0.6 },
                { toVideoId: 'Z', probability: 0.4 },
            ]],
        ]);

        const metrics = evaluateTransitionPredictor(cases, transitions, 2);

        expect(metrics.sampleSize).toBe(3);
        expect(metrics.topKReachHitRate).toBeGreaterThan(0.9);
        expect(metrics.precisionAtK).toBeGreaterThan(0.4);
        expect(metrics.calibrationScore).toBeGreaterThan(0);
        expect(metrics.reliabilityScore).toBeGreaterThan(0);
    });

    it('derives adjacent-window reliability deltas', () => {
        const cases = [
            {
                userId: 'u1',
                sourceVideoId: 'A',
                actualTargets: new Set(['B']),
                cohortId: 'gaming|medium|low',
                windowBucket: 'earlier' as const,
            },
            {
                userId: 'u2',
                sourceVideoId: 'A',
                actualTargets: new Set(['B']),
                cohortId: 'gaming|medium|low',
                windowBucket: 'later' as const,
            },
        ];

        const transitions = new Map([
            ['A', [
                { toVideoId: 'B', probability: 0.8 },
                { toVideoId: 'C', probability: 0.2 },
            ]],
        ]);

        const metrics = evaluateTransitionPredictor(cases, transitions, 2);
        expect(metrics.sampleSize).toBe(2);
        expect(metrics.reliabilityScore).toBeGreaterThan(0);
    });

    it('returns zeroed metrics when no prediction cases are available', () => {
        const metrics = evaluateTransitionPredictor([], new Map(), 5);
        expect(metrics.sampleSize).toBe(0);
        expect(metrics.reliabilityScore).toBe(0);
        expect(metrics.topKReachHitRate).toBe(0);
        expect(metrics.precisionAtK).toBe(0);
        expect(metrics.calibrationScore).toBe(0);
    });
});
