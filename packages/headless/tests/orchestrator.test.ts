import { describe, expect, it } from 'vitest';
import { summarizeCaptureRun } from '../src/orchestrator.js';
import { buildSyntheticProfiles } from '../src/profiles.js';
import type { PersistedCaptureArtifact } from '../src/types.js';

describe('summarizeCaptureRun', () => {
    it('reports missing matrix cells and low-density profiles', () => {
        const profiles = buildSyntheticProfiles();
        const sample = profiles[0];

        const completed: PersistedCaptureArtifact[] = [
            {
                profile: sample,
                payload: {
                    platform: 'youtube',
                    feed: [{ videoId: 'abc123xyz78' }],
                    sessionMetadata: { capturedAt: '2026-04-24T00:00:00.000Z' },
                },
                summary: {
                    homeItemCount: 0,
                    searchItemCount: 4,
                    recommendationCount: 1,
                    interactedVideoId: 'abc123xyz78',
                    query: 'new gadget review',
                    followUpQuery: null,
                    revisitPatternApplied: 'skipped',
                },
                warnings: [],
                artifactPath: 'artifact.json',
                upload: null,
            },
        ];

        const summary = summarizeCaptureRun(profiles, completed, []);

        expect(summary.completedCount).toBe(1);
        expect(summary.lowRecommendationProfiles).toEqual([sample.id]);
        expect(summary.lowSearchResultProfiles).toEqual([sample.id]);
        expect(summary.missingCoverageCells.length).toBe(profiles.length - 1);
    });
});
