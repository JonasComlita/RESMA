import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { summarizeCaptureRun } from '../src/orchestrator.js';
import { runSyntheticCaptureMatrix } from '../src/orchestrator.js';
import { buildSyntheticProfiles } from '../src/profiles.js';
import { createDefaultCaptureModeContext } from '../src/researchAccounts.js';
import type { PersistedCaptureArtifact } from '../src/types.js';

describe('summarizeCaptureRun', () => {
    it('reports missing matrix cells and low-density profiles', () => {
        const profiles = buildSyntheticProfiles();
        const sample = profiles[0];

        const completed: PersistedCaptureArtifact[] = [
            {
                captureMode: createDefaultCaptureModeContext(),
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
        expect(summary.resumedCount).toBe(0);
        expect(summary.lowRecommendationProfiles).toEqual([sample.id]);
        expect(summary.lowSearchResultProfiles).toEqual([sample.id]);
        expect(summary.missingCoverageCells.length).toBe(profiles.length - 1);
    });

    it('resumes existing artifacts from the output directory and rewrites the summary incrementally', async () => {
        const profiles = buildSyntheticProfiles();
        const sample = profiles[0];
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'resma-headless-orchestrator-'));
        const outputDir = path.join(tempDir, 'captures');
        const profileStorageDir = path.join(tempDir, 'profiles');

        await mkdir(outputDir, { recursive: true });
        await mkdir(profileStorageDir, { recursive: true });

        const artifactPath = path.join(outputDir, '2026-04-25T00-00-00-000Z-sample.json');
        await writeFile(artifactPath, JSON.stringify({
            captureMode: createDefaultCaptureModeContext(),
            profile: sample,
            payload: {
                platform: 'youtube',
                feed: [{ videoId: 'abc123xyz78' }],
                sessionMetadata: { capturedAt: '2026-04-25T00:00:00.000Z' },
            },
            summary: {
                homeItemCount: 0,
                searchItemCount: 10,
                recommendationCount: 24,
                interactedVideoId: 'abc123xyz78',
                query: 'new gadget review',
                followUpQuery: null,
                revisitPatternApplied: 'skipped',
            },
            warnings: [],
            upload: {
                endpoint: 'http://localhost:3001/youtube/feed',
                ok: true,
                status: 201,
                uploadId: 'resume-test',
                body: { success: true },
            },
        }, null, 2), 'utf8');

        const result = await runSyntheticCaptureMatrix([sample], {
            outputDir,
            profileStorageDir,
            headless: true,
        });

        expect(result.resumed).toHaveLength(1);
        expect(result.completed).toHaveLength(0);
        expect(result.summary.completedCount).toBe(1);
        expect(result.summary.resumedCount).toBe(1);

        const summary = JSON.parse(await readFile(result.summaryPath, 'utf8')) as { resumedCount: number; completedCount: number };
        expect(summary.resumedCount).toBe(1);
        expect(summary.completedCount).toBe(1);
    });
});
