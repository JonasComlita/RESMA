import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildSyntheticProfiles } from './profiles.js';
import { runSyntheticCaptureMatrix } from './orchestrator.js';
import type { CaptureRuntimeOptions, SyntheticResearchProfile } from './types.js';

interface ParsedArgs {
    regions: string[];
    categories: string[];
    profileIds: string[];
    variantsPerRegionCategory: number;
    limitPerCell: number | null;
    maxProfiles: number | null;
    outputDir: string;
    profileStorageDir: string;
    profileTimeoutMs: number | null;
    apiBaseUrl?: string;
    authToken?: string;
    resumeExisting: boolean;
    upload: boolean;
    headless: boolean;
    browserChannel?: string;
}

function printUsage() {
    console.log([
        'Usage: pnpm --filter @resma/headless capture [options]',
        '',
        'Options:',
        '  --region us,uk              Limit regions by key',
        '  --category technology       Limit categories by key slug',
        '  --profile yt-us-technology  Run a specific profile id',
        '  --variants-per-pair 1       Profiles per region/category cell',
        '  --limit 1                   Keep up to N profiles per region/category cell',
        '  --max-profiles 8            Stop after N total profiles globally',
        '  --output-dir .captures      Capture artifact output directory',
        '  --profile-storage-dir .profiles  Persistent browser state directory',
        '  --timeout-ms 180000         Per-profile timeout before the browser is closed',
        '  --no-resume                 Do not reuse existing artifacts in the output directory',
        '  --upload                    POST captures to the existing ingest routes',
        '  --api-url http://localhost:3001',
        '  --token <jwt>',
        '  --headful                   Run headed instead of headless',
        '  --browser-channel chrome    Use a locally installed browser channel',
    ].join('\n'));
}

function parseListFlag(value: string): string[] {
    return value
        .split(/[,\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function readFlagValue(args: string[], index: number): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${args[index]}`);
    }
    return value;
}

function parseArgs(argv: string[]): ParsedArgs {
    const parsed: ParsedArgs = {
        regions: [],
        categories: [],
        profileIds: [],
        variantsPerRegionCategory: 1,
        limitPerCell: null,
        maxProfiles: null,
        outputDir: path.resolve(process.cwd(), '.captures', 'headless'),
        profileStorageDir: path.resolve(process.cwd(), '.captures', 'profiles'),
        profileTimeoutMs: null,
        apiBaseUrl: process.env.RESMA_API_URL,
        authToken: process.env.RESMA_TOKEN,
        resumeExisting: true,
        upload: false,
        headless: true,
        browserChannel: process.env.RESMA_BROWSER_CHANNEL,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        switch (argument) {
            case '--region':
                parsed.regions = parseListFlag(readFlagValue(argv, index));
                index += 1;
                break;
            case '--category':
                parsed.categories = parseListFlag(readFlagValue(argv, index));
                index += 1;
                break;
            case '--profile':
                parsed.profileIds = parseListFlag(readFlagValue(argv, index));
                index += 1;
                break;
            case '--variants-per-pair':
                parsed.variantsPerRegionCategory = Number.parseInt(readFlagValue(argv, index), 10);
                index += 1;
                break;
            case '--limit':
                parsed.limitPerCell = Number.parseInt(readFlagValue(argv, index), 10);
                index += 1;
                break;
            case '--max-profiles':
                parsed.maxProfiles = Number.parseInt(readFlagValue(argv, index), 10);
                index += 1;
                break;
            case '--output-dir':
                parsed.outputDir = path.resolve(process.cwd(), readFlagValue(argv, index));
                index += 1;
                break;
            case '--profile-storage-dir':
                parsed.profileStorageDir = path.resolve(process.cwd(), readFlagValue(argv, index));
                index += 1;
                break;
            case '--timeout-ms':
                parsed.profileTimeoutMs = Number.parseInt(readFlagValue(argv, index), 10);
                index += 1;
                break;
            case '--api-url':
                parsed.apiBaseUrl = readFlagValue(argv, index);
                index += 1;
                break;
            case '--token':
                parsed.authToken = readFlagValue(argv, index);
                index += 1;
                break;
            case '--no-resume':
                parsed.resumeExisting = false;
                break;
            case '--upload':
                parsed.upload = true;
                break;
            case '--headful':
                parsed.headless = false;
                break;
            case '--browser-channel':
                parsed.browserChannel = readFlagValue(argv, index);
                index += 1;
                break;
            case '--help':
            case '-h':
                printUsage();
                process.exit(0);
                break;
            default:
                break;
        }
    }

    if (!Number.isFinite(parsed.variantsPerRegionCategory) || parsed.variantsPerRegionCategory < 1) {
        throw new Error('--variants-per-pair must be at least 1');
    }

    if (parsed.limitPerCell !== null && (!Number.isFinite(parsed.limitPerCell) || parsed.limitPerCell < 1)) {
        throw new Error('--limit must be at least 1 when provided');
    }

    if (parsed.maxProfiles !== null && (!Number.isFinite(parsed.maxProfiles) || parsed.maxProfiles < 1)) {
        throw new Error('--max-profiles must be at least 1 when provided');
    }

    if (parsed.profileTimeoutMs !== null && (!Number.isFinite(parsed.profileTimeoutMs) || parsed.profileTimeoutMs < 1_000)) {
        throw new Error('--timeout-ms must be at least 1000 when provided');
    }

    if (parsed.upload && (!parsed.apiBaseUrl || !parsed.authToken)) {
        throw new Error('--upload requires both --api-url and --token (or RESMA_API_URL / RESMA_TOKEN)');
    }

    return parsed;
}

function applyPerCellLimit(profiles: SyntheticResearchProfile[], limitPerCell: number | null): SyntheticResearchProfile[] {
    if (limitPerCell === null) {
        return profiles;
    }

    const counts = new Map<string, number>();
    const limited: SyntheticResearchProfile[] = [];

    for (const profile of profiles) {
        const key = `${profile.region.key}:${profile.category.key}`;
        const count = counts.get(key) ?? 0;
        if (count >= limitPerCell) {
            continue;
        }
        counts.set(key, count + 1);
        limited.push(profile);
    }

    return limited;
}

export function filterProfiles(profiles: SyntheticResearchProfile[], args: ParsedArgs): SyntheticResearchProfile[] {
    let filtered = profiles;

    if (args.profileIds.length > 0) {
        filtered = filtered.filter((profile) => args.profileIds.includes(profile.id));
    }

    if (args.regions.length > 0) {
        const regionKeys = new Set(args.regions);
        filtered = filtered.filter((profile) => regionKeys.has(profile.region.key));
    }

    if (args.categories.length > 0) {
        const categoryKeys = new Set(args.categories);
        filtered = filtered.filter((profile) => categoryKeys.has(profile.category.key));
    }

    filtered = applyPerCellLimit(filtered, args.limitPerCell);

    if (args.maxProfiles !== null) {
        filtered = filtered.slice(0, args.maxProfiles);
    }

    return filtered;
}

export async function main() {
    const commandAndArgs = process.argv.slice(2);
    const command = commandAndArgs[0] === 'capture' ? 'capture' : 'capture';
    const parsed = parseArgs(commandAndArgs[0] === 'capture' ? commandAndArgs.slice(1) : commandAndArgs);

    if (command !== 'capture') {
        throw new Error(`Unsupported command "${command}"`);
    }

    const profiles = filterProfiles(
        buildSyntheticProfiles(parsed.variantsPerRegionCategory),
        parsed,
    );

    if (profiles.length === 0) {
        throw new Error('No synthetic profiles matched the requested filters.');
    }

    const runtimeOptions: CaptureRuntimeOptions = {
        apiBaseUrl: parsed.apiBaseUrl,
        authToken: parsed.authToken,
        browserChannel: parsed.browserChannel,
        headless: parsed.headless,
        outputDir: parsed.outputDir,
        profileStorageDir: parsed.profileStorageDir,
        profileTimeoutMs: parsed.profileTimeoutMs ?? undefined,
        resumeExisting: parsed.resumeExisting,
        upload: parsed.upload,
    };

    console.log(`Running ${profiles.length} synthetic profile capture(s)...`);
    const result = await runSyntheticCaptureMatrix(profiles, runtimeOptions);

    for (const existing of result.resumed) {
        console.log(`RESUMED ${existing.profile.id}`);
    }

    for (const completed of result.completed) {
        console.log([
            `OK ${completed.profile.id}`,
            `  artifact: ${completed.artifactPath}`,
            `  items: ${completed.payload.feed.length}`,
            completed.upload ? `  upload: ${completed.upload.status} ${completed.upload.ok ? 'ok' : 'failed'}` : '  upload: skipped',
        ].join('\n'));
    }

    for (const failure of result.failed) {
        console.error(`FAIL ${failure.profileId}: ${failure.error}`);
    }

    console.log([
        'Run summary:',
        `  summary: ${result.summaryPath}`,
        `  completed: ${result.summary.completedCount}/${result.summary.totalProfilesRequested}`,
        `  resumed: ${result.summary.resumedCount}`,
        `  low recommendations: ${result.summary.lowRecommendationProfiles.length}`,
        `  missing coverage cells: ${result.summary.missingCoverageCells.length}`,
    ].join('\n'));

    if (result.failed.length > 0) {
        process.exitCode = 1;
    }
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
    void main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        printUsage();
        process.exit(1);
    });
}
