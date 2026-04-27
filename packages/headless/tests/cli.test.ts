import { describe, expect, it } from 'vitest';
import { buildSyntheticProfiles } from '../src/profiles.js';
import {
    filterProfiles,
    parseArgs,
    resolveGovernedResearchAccountSelection,
} from '../src/cli.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('cli profile filtering behavior', () => {
    it('supports comma and whitespace separated list flags in the source parser', async () => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const source = await fs.readFile(path.resolve(__dirname, '../src/cli.ts'), 'utf8');
        expect(source).toContain('.split(/[,\\s]+/)');
    });

    it('treats --limit semantics as per-cell instead of global', () => {
        const filtered = filterProfiles(buildSyntheticProfiles(2), {
            regions: ['us', 'uk'],
            categories: ['technology', 'music'],
            profileIds: [],
            variantsPerRegionCategory: 2,
            limitPerCell: 1,
            maxProfiles: null,
            outputDir: '/tmp/out',
            outputDirProvided: false,
            profileStorageDir: '/tmp/profiles',
            profileStorageDirProvided: false,
            upload: false,
            profileTimeoutMs: null,
            enableGovernedResearchAccountMode: false,
            researchAccountConfigPath: undefined,
            researchAccountId: undefined,
            headless: true,
            resumeExisting: true,
        });

        expect(filtered).toHaveLength(4);
        expect(filtered.map((profile) => `${profile.region.key}:${profile.category.key}`)).toEqual([
            'us:music',
            'us:technology',
            'uk:music',
            'uk:technology',
        ]);
    });

    it('supports a separate global cap with --max-profiles semantics', () => {
        const filtered = filterProfiles(buildSyntheticProfiles(2), {
            regions: ['us', 'uk'],
            categories: ['technology', 'music'],
            profileIds: [],
            variantsPerRegionCategory: 2,
            limitPerCell: 1,
            maxProfiles: 2,
            outputDir: '/tmp/out',
            outputDirProvided: false,
            profileStorageDir: '/tmp/profiles',
            profileStorageDirProvided: false,
            upload: false,
            profileTimeoutMs: null,
            enableGovernedResearchAccountMode: false,
            researchAccountConfigPath: undefined,
            researchAccountId: undefined,
            headless: true,
            resumeExisting: true,
        });

        expect(filtered).toHaveLength(2);
    });

    it('requires explicit opt-in before any governed research-account selection is used', async () => {
        await expect(resolveGovernedResearchAccountSelection({
            enableGovernedResearchAccountMode: false,
            researchAccountConfigPath: path.resolve('missing.json'),
            researchAccountId: 'yt-observatory-us-1',
        }, buildSyntheticProfiles(1).slice(0, 1))).resolves.toEqual({
            captureMode: {
                mode: 'synthetic-logged-out',
                captureIdentity: 'signed-out-synthetic',
            },
        });
    });

    it('rejects research-account flags unless the explicit opt-in flag is present', () => {
        expect(() => parseArgs([
            '--research-account-config',
            'C:/local/research-accounts.json',
            '--research-account',
            'yt-observatory-us-1',
        ])).toThrow(/enable-governed-research-account-mode/i);
    });

    it('requires an explicit enable flag to load governed research-account selections', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'resma-headless-cli-'));
        const configPath = path.join(tempDir, 'research-accounts.json');

        await writeFile(configPath, JSON.stringify({
            version: 1,
            accounts: [
                {
                    id: 'yt-paused-local',
                    label: 'Paused Local Account',
                    platform: 'youtube',
                    researchPurpose: 'Passive observatory testing.',
                    notes: [],
                    allowedCaptureMode: 'passive-observation-only',
                    credentialSource: {
                        kind: 'persistent-user-data-dir',
                        reference: 'local',
                        path: tempDir,
                    },
                    status: 'active',
                    runScope: 'orchestrated',
                },
            ],
        }, null, 2), 'utf8');

        const resolved = await resolveGovernedResearchAccountSelection({
            enableGovernedResearchAccountMode: true,
            researchAccountConfigPath: configPath,
            researchAccountId: 'yt-paused-local',
        }, buildSyntheticProfiles(1).slice(0, 1));

        expect(resolved.captureMode?.mode).toBe('research-account');
        expect(resolved.researchAccount?.id).toBe('yt-paused-local');
    });
});
