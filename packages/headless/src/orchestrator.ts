import path from 'node:path';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { captureYouTubeProfile } from './youtube.js';
import { captureTikTokProfile } from './tiktok.js';
import { captureRedditProfile } from './reddit.js';
import { uploadCapturePayload } from './uploader.js';
import {
    CORE_CATEGORY_DEFINITIONS,
    RESEARCH_REGIONS,
} from './profiles.js';
import type {
    CaptureArtifact,
    CaptureModeContext,
    CaptureRunSummary,
    CaptureRunResult,
    CaptureRuntimeOptions,
    CoverageCellSummary,
    PersistedCaptureArtifact,
    SyntheticResearchProfile,
} from './types.js';
import { createDefaultCaptureModeContext } from './researchAccounts.js';

function artifactFilename(profileId: string, capturedAt: string): string {
    const safeTimestamp = capturedAt.replace(/[:.]/g, '-');
    return `${safeTimestamp}-${profileId}.json`;
}

function summaryPathFor(outputDir: string): string {
    return path.join(outputDir, 'run-summary.json');
}

async function persistCaptureArtifact(
    artifact: CaptureArtifact,
    options: CaptureRuntimeOptions,
): Promise<PersistedCaptureArtifact> {
    await mkdir(options.outputDir, { recursive: true });

    const capturedAt = artifact.payload.sessionMetadata.capturedAt ?? new Date().toISOString();
    const artifactPath = path.join(options.outputDir, artifactFilename(artifact.profile.id, capturedAt));

    let upload = null;
    if (options.upload && options.apiBaseUrl && options.authToken) {
        upload = await uploadCapturePayload(artifact.payload, {
            apiBaseUrl: options.apiBaseUrl,
            authToken: options.authToken,
        });
    }

    await writeFile(
        artifactPath,
        JSON.stringify(
            {
                profile: artifact.profile,
                summary: artifact.summary,
                warnings: artifact.warnings,
                payload: artifact.payload,
                upload,
            },
            null,
            2,
        ),
        'utf8',
    );

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

function buildMissingCoverageCells(successfulArtifacts: PersistedCaptureArtifact[]): CoverageCellSummary[] {
    const coverage = new Set(successfulArtifacts.map((artifact) => `${artifact.profile.region.key}:${artifact.profile.category.key}`));
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
    successfulArtifacts: PersistedCaptureArtifact[],
    failed: Array<{ profileId: string; error: string }>,
    resumedCount = 0,
): CaptureRunSummary {
    const uploadAttemptCount = successfulArtifacts.filter((artifact) => artifact.upload !== null).length;
    const uploadSuccessCount = successfulArtifacts.filter((artifact) => artifact.upload?.ok).length;

    return {
        totalProfilesRequested: requestedProfiles.length,
        completedCount: successfulArtifacts.length,
        failedCount: failed.length,
        resumedCount,
        uploadAttemptCount,
        uploadSuccessCount,
        lowRecommendationProfiles: successfulArtifacts
            .filter((artifact) => artifact.summary.recommendationCount < 3)
            .map((artifact) => artifact.profile.id),
        lowSearchResultProfiles: successfulArtifacts
            .filter((artifact) => artifact.summary.searchItemCount < 5)
            .map((artifact) => artifact.profile.id),
        coverageCells: buildCoverageCells(successfulArtifacts),
        missingCoverageCells: buildMissingCoverageCells(successfulArtifacts),
    };
}

async function loadPersistedArtifact(artifactPath: string): Promise<PersistedCaptureArtifact | null> {
    try {
        const raw = JSON.parse(await readFile(artifactPath, 'utf8')) as Partial<PersistedCaptureArtifact>;
        if (!raw || typeof raw !== 'object' || !raw.profile || !raw.payload || !raw.summary) {
            return null;
        }

        const captureMode = (raw.captureMode ?? createDefaultCaptureModeContext()) as CaptureModeContext;

        return {
            captureMode,
            profile: raw.profile as PersistedCaptureArtifact['profile'],
            payload: raw.payload as PersistedCaptureArtifact['payload'],
            summary: raw.summary as PersistedCaptureArtifact['summary'],
            warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
            artifactPath,
            upload: (raw.upload ?? null) as PersistedCaptureArtifact['upload'],
        };
    } catch {
        return null;
    }
}

async function loadExistingArtifacts(
    profiles: SyntheticResearchProfile[],
    outputDir: string,
): Promise<PersistedCaptureArtifact[]> {
    const requestedIds = new Set(profiles.map((profile) => profile.id));

    let entries: string[] = [];
    try {
        entries = await readdir(outputDir);
    } catch {
        return [];
    }

    const candidates = entries
        .filter((entry) => entry.endsWith('.json') && entry !== 'run-summary.json')
        .map((entry) => path.join(outputDir, entry));

    const latestByProfile = new Map<string, { artifact: PersistedCaptureArtifact; mtimeMs: number }>();

    for (const artifactPath of candidates) {
        const artifact = await loadPersistedArtifact(artifactPath);
        if (!artifact || !requestedIds.has(artifact.profile.id)) {
            continue;
        }

        const artifactStat = await stat(artifactPath).catch(() => null);
        const mtimeMs = artifactStat?.mtimeMs ?? 0;
        const existing = latestByProfile.get(artifact.profile.id);
        if (!existing || mtimeMs >= existing.mtimeMs) {
            latestByProfile.set(artifact.profile.id, { artifact, mtimeMs });
        }
    }

    return profiles
        .map((profile) => latestByProfile.get(profile.id)?.artifact ?? null)
        .filter((artifact): artifact is PersistedCaptureArtifact => Boolean(artifact));
}

async function writeRunSummary(
    requestedProfiles: SyntheticResearchProfile[],
    successfulArtifacts: PersistedCaptureArtifact[],
    failed: Array<{ profileId: string; error: string }>,
    summaryPath: string,
    resumedCount = 0,
): Promise<CaptureRunSummary> {
    const summary = summarizeCaptureRun(requestedProfiles, successfulArtifacts, failed, resumedCount);
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    return summary;
}

export async function runSyntheticCaptureMatrix(
    profiles: SyntheticResearchProfile[],
    options: CaptureRuntimeOptions,
): Promise<CaptureRunResult> {
    await mkdir(options.outputDir, { recursive: true });

    const completed: PersistedCaptureArtifact[] = [];
    const resumed = options.resumeExisting === false
        ? []
        : await loadExistingArtifacts(profiles, options.outputDir);
    const failed: Array<{ profileId: string; error: string }> = [];
    const summaryPath = summaryPathFor(options.outputDir);
    const resumedIds = new Set(resumed.map((artifact) => artifact.profile.id));
    const remainingProfiles = profiles.filter((profile) => !resumedIds.has(profile.id));

    if (resumed.length > 0) {
        console.log(`Resuming run with ${resumed.length} existing artifact(s) already present.`);
    }

    await writeRunSummary(profiles, [...resumed], failed, summaryPath, resumed.length);

    for (const profile of remainingProfiles) {
        const started = resumed.length + completed.length + failed.length + 1;
        console.log(`[${started}/${profiles.length}] Capturing ${profile.id}...`);
        try {
            let artifact: CaptureArtifact;
            switch (profile.platform) {
                case 'tiktok':
                    artifact = await captureTikTokProfile(profile, options);
                    break;
                case 'reddit':
                    artifact = await captureRedditProfile(profile, options);
                    break;
                case 'youtube':
                default:
                    artifact = await captureYouTubeProfile(profile, options);
                    break;
            }
            const persisted = await persistCaptureArtifact(artifact, options);
            completed.push(persisted);
            console.log(`[${resumed.length + completed.length}/${profiles.length}] Finished ${profile.id}.`);
        } catch (error) {
            failed.push({
                profileId: profile.id,
                error: error instanceof Error ? error.message : 'unknown-error',
            });
            console.error(`[${resumed.length + completed.length + failed.length}/${profiles.length}] Failed ${profile.id}: ${error instanceof Error ? error.message : error}`);
        }

        await writeRunSummary(profiles, [...resumed, ...completed], failed, summaryPath, resumed.length);
    }

    const summary = await writeRunSummary(profiles, [...resumed, ...completed], failed, summaryPath, resumed.length);

    return {
        completed,
        resumed,
        failed,
        summary,
        summaryPath,
    };
}
