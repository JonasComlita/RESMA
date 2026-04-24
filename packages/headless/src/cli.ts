import path from 'node:path';
import process from 'node:process';
import { buildSyntheticProfiles } from './profiles.js';
import { runSyntheticCaptureMatrix } from './orchestrator.js';
import type { CaptureRuntimeOptions, SyntheticResearchProfile } from './types.js';

interface ParsedArgs {
    regions: string[];
    categories: string[];
    profileIds: string[];
    variantsPerRegionCategory: number;
    limit: number | null;
    outputDir: string;
    profileStorageDir: string;
    apiBaseUrl?: string;
    authToken?: string;
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
        '  --limit 1                   Stop after N profiles',
        '  --output-dir .captures      Capture artifact output directory',
        '  --profile-storage-dir .profiles  Persistent browser state directory',
        '  --upload                    POST captures to the existing ingest routes',
        '  --api-url http://localhost:3001',
        '  --token <jwt>',
        '  --headful                   Run headed instead of headless',
        '  --browser-channel chrome    Use a locally installed browser channel',
    ].join('\n'));
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
        limit: null,
        outputDir: path.resolve(process.cwd(), '.captures', 'headless'),
        profileStorageDir: path.resolve(process.cwd(), '.captures', 'profiles'),
        apiBaseUrl: process.env.RESMA_API_URL,
        authToken: process.env.RESMA_TOKEN,
        upload: false,
        headless: true,
        browserChannel: process.env.RESMA_BROWSER_CHANNEL,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        switch (argument) {
            case '--region':
                parsed.regions = readFlagValue(argv, index).split(',').map((value) => value.trim()).filter(Boolean);
                index += 1;
                break;
            case '--category':
                parsed.categories = readFlagValue(argv, index).split(',').map((value) => value.trim()).filter(Boolean);
                index += 1;
                break;
            case '--profile':
                parsed.profileIds = readFlagValue(argv, index).split(',').map((value) => value.trim()).filter(Boolean);
                index += 1;
                break;
            case '--variants-per-pair':
                parsed.variantsPerRegionCategory = Number.parseInt(readFlagValue(argv, index), 10);
                index += 1;
                break;
            case '--limit':
                parsed.limit = Number.parseInt(readFlagValue(argv, index), 10);
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
            case '--api-url':
                parsed.apiBaseUrl = readFlagValue(argv, index);
                index += 1;
                break;
            case '--token':
                parsed.authToken = readFlagValue(argv, index);
                index += 1;
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

    if (parsed.limit !== null && (!Number.isFinite(parsed.limit) || parsed.limit < 1)) {
        throw new Error('--limit must be at least 1 when provided');
    }

    if (parsed.upload && (!parsed.apiBaseUrl || !parsed.authToken)) {
        throw new Error('--upload requires both --api-url and --token (or RESMA_API_URL / RESMA_TOKEN)');
    }

    return parsed;
}

function filterProfiles(profiles: SyntheticResearchProfile[], args: ParsedArgs): SyntheticResearchProfile[] {
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

    if (args.limit !== null) {
        filtered = filtered.slice(0, args.limit);
    }

    return filtered;
}

async function main() {
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
        upload: parsed.upload,
    };

    console.log(`Running ${profiles.length} synthetic profile capture(s)...`);
    const result = await runSyntheticCaptureMatrix(profiles, runtimeOptions);

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
        `  low recommendations: ${result.summary.lowRecommendationProfiles.length}`,
        `  missing coverage cells: ${result.summary.missingCoverageCells.length}`,
    ].join('\n'));

    if (result.failed.length > 0) {
        process.exitCode = 1;
    }
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    printUsage();
    process.exit(1);
});
