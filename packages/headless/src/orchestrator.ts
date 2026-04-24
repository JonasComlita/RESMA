import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { captureYouTubeProfile } from './youtube.js';
import { uploadCapturePayload } from './uploader.js';
import {
    CORE_CATEGORY_DEFINITIONS,
    RESEARCH_REGIONS,
} from './profiles.js';
import type {
    CaptureArtifact,
    CaptureRunSummary,
    CaptureRunResult,
    CaptureRuntimeOptions,
    CoverageCellSummary,
    PersistedCaptureArtifact,
    SyntheticResearchProfile,
} from './types.js';

function artifactFilename(profileId: string, capturedAt: string): string {
    const safeTimestamp = capturedAt.replace(/[:.]/g, '-');
    return `${safeTimestamp}-${profileId}.json`;
}

async function persistCaptureArtifact(
    artifact: CaptureArtifact,
    options: CaptureRuntimeOptions,
): Promise<PersistedCaptureArtifact> {
    await mkdir(options.outputDir, { recursive: true });

    const capturedAt = artifact.payload.sessionMetadata.capturedAt ?? new Date().toISOString();
    const artifactPath = path.join(options.outputDir, artifactFilename(artifact.profile.id, capturedAt));

    await writeFile(
        artifactPath,
        JSON.stringify(
            {
                profile: artifact.profile,
                summary: artifact.summary,
                warnings: artifact.warnings,
                payload: artifact.payload,
            },
            null,
            2,
        ),
        'utf8',
    );

    let upload = null;
    if (options.upload && options.apiBaseUrl && options.authToken) {
        upload = await uploadCapturePayload(artifact.payload, {
            apiBaseUrl: options.apiBaseUrl,
            authToken: options.authToken,
        });
    }

    return {
        ...artifact,
        artifactPath,
        upload,
    };
}

function buildCoverageCells(completed: PersistedCaptureArtifact[]): CoverageCellSummary[] {
    const counts = new Map<string, CoverageCellSummary>();

    for (const artifact of completed) {
        const key = `${artifact.profile.region.key}:${artifact.profile.category.key}`;
        const existing = counts.get(key);
        if (existing) {
            existing.count += 1;
            continue;
        }

        counts.set(key, {
            regionKey: artifact.profile.region.key,
            categoryKey: artifact.profile.category.key,
            count: 1,
        });
    }

    return Array.from(counts.values()).sort((left, right) => {
        return left.regionKey.localeCompare(right.regionKey) || left.categoryKey.localeCompare(right.categoryKey);
    });
}

function buildMissingCoverageCells(completed: PersistedCaptureArtifact[]): CoverageCellSummary[] {
    const coverage = new Set(completed.map((artifact) => `${artifact.profile.region.key}:${artifact.profile.category.key}`));
    const missing: CoverageCellSummary[] = [];

    for (const region of RESEARCH_REGIONS) {
        for (const category of CORE_CATEGORY_DEFINITIONS) {
            const key = `${region.key}:${category.key}`;
            if (!coverage.has(key)) {
                missing.push({
                    regionKey: region.key,
                    categoryKey: category.key,
                    count: 0,
                });
            }
        }
    }

    return missing;
}

export function summarizeCaptureRun(
    requestedProfiles: SyntheticResearchProfile[],
    completed: PersistedCaptureArtifact[],
    failed: Array<{ profileId: string; error: string }>,
): CaptureRunSummary {
    const uploadAttemptCount = completed.filter((artifact) => artifact.upload !== null).length;
    const uploadSuccessCount = completed.filter((artifact) => artifact.upload?.ok).length;

    return {
        totalProfilesRequested: requestedProfiles.length,
        completedCount: completed.length,
        failedCount: failed.length,
        uploadAttemptCount,
        uploadSuccessCount,
        lowRecommendationProfiles: completed
            .filter((artifact) => artifact.summary.recommendationCount < 3)
            .map((artifact) => artifact.profile.id),
        lowSearchResultProfiles: completed
            .filter((artifact) => artifact.summary.searchItemCount < 5)
            .map((artifact) => artifact.profile.id),
        coverageCells: buildCoverageCells(completed),
        missingCoverageCells: buildMissingCoverageCells(completed),
    };
}

export async function runSyntheticCaptureMatrix(
    profiles: SyntheticResearchProfile[],
    options: CaptureRuntimeOptions,
): Promise<CaptureRunResult> {
    const completed: PersistedCaptureArtifact[] = [];
    const failed: Array<{ profileId: string; error: string }> = [];

    for (const profile of profiles) {
        try {
            const artifact = await captureYouTubeProfile(profile, options);
            completed.push(await persistCaptureArtifact(artifact, options));
        } catch (error) {
            failed.push({
                profileId: profile.id,
                error: error instanceof Error ? error.message : 'unknown-error',
            });
        }
    }

    await mkdir(options.outputDir, { recursive: true });
    const summary = summarizeCaptureRun(profiles, completed, failed);
    const summaryPath = path.join(options.outputDir, 'run-summary.json');
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    return {
        completed,
        failed,
        summary,
        summaryPath,
    };
}
