import { describe, expect, it } from 'vitest';
import {
    buildSyntheticProfiles,
    CORE_CATEGORY_DEFINITIONS,
    RESEARCH_REGIONS,
} from '../src/profiles.js';

describe('buildSyntheticProfiles', () => {
    it('covers every region and category combination at least once', () => {
        const profiles = buildSyntheticProfiles();
        expect(profiles).toHaveLength(RESEARCH_REGIONS.length * CORE_CATEGORY_DEFINITIONS.length);

        for (const region of RESEARCH_REGIONS) {
            const categoriesForRegion = new Set(
                profiles
                    .filter((profile) => profile.region.key === region.key)
                    .map((profile) => profile.category.key),
            );
            expect(categoriesForRegion.size).toBe(CORE_CATEGORY_DEFINITIONS.length);
        }
    });
});
