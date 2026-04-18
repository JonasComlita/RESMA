import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Deprecated anonymous ingestion service stubs', () => {
    it('removes legacy Instagram, YouTube, and Twitter service files', () => {
        const instagramStub = fileURLToPath(new URL('../src/services/instagram.ts', import.meta.url));
        const twitterStub = fileURLToPath(new URL('../src/services/twitter.ts', import.meta.url));
        const youtubeStub = fileURLToPath(new URL('../src/services/youtube.ts', import.meta.url));

        expect(existsSync(instagramStub)).toBe(false);
        expect(existsSync(twitterStub)).toBe(false);
        expect(existsSync(youtubeStub)).toBe(false);
    });
});
