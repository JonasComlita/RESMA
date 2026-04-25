import { describe, expect, it } from 'vitest';
import { buildSyntheticProfiles } from '../src/profiles.js';
import { filterProfiles } from '../src/cli.js';

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
            profileStorageDir: '/tmp/profiles',
            upload: false,
            headless: true,
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
            profileStorageDir: '/tmp/profiles',
            upload: false,
            headless: true,
        });

        expect(filtered).toHaveLength(2);
    });
});
