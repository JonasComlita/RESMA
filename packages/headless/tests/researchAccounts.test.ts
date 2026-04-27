import { describe, expect, it } from 'vitest';
import {
    createDefaultCaptureModeContext,
    createGovernedResearchCaptureModeContext,
    mergeCaptureModeMetadata,
    parseGovernedResearchAccountConfig,
    resolveGovernedResearchAccount,
} from '../src/researchAccounts.js';

describe('governed research-account config and metadata', () => {
    const validConfig = {
        version: 1,
        accounts: [
            {
                id: 'yt-observatory-us-1',
                label: 'YouTube Observatory US 1',
                platform: 'youtube',
                researchPurpose: 'Recommendation drift checks for signed-in U.S. baseline.',
                notes: ['Manually provisioned by research ops.'],
                allowedCaptureMode: 'passive-observation-only',
                credentialSource: {
                    kind: 'persistent-user-data-dir',
                    reference: 'local-youtube-us-1',
                    path: 'C:/manual/research-accounts/youtube-us-1',
                },
                status: 'active',
                owner: {
                    operatorId: 'research-ops',
                    displayName: 'Research Ops',
                },
                runScope: 'orchestrated',
            },
        ],
    };

    it('parses a narrow governed research-account config', () => {
        const config = parseGovernedResearchAccountConfig(validConfig);
        expect(config.accounts[0]?.credentialSource.path).toContain('manual');
        expect(config.accounts[0]?.allowedCaptureMode).toBe('passive-observation-only');
    });

    it('rejects unsupported platforms and unsafe config values', () => {
        expect(() => parseGovernedResearchAccountConfig({
            version: 1,
            accounts: [
                {
                    ...validConfig.accounts[0],
                    platform: 'reddit',
                },
            ],
        })).toThrow(/not allowlisted/i);
    });

    it('keeps signed-out synthetic capture as the default metadata path', () => {
        const metadata = mergeCaptureModeMetadata(
            { uploadEvent: 'SYNTHETIC_YOUTUBE_SESSION' },
            createDefaultCaptureModeContext(),
        );

        expect(metadata.researchMode).toBe('synthetic-logged-out');
        expect(metadata.captureIdentity).toBe('signed-out-synthetic');
        expect(metadata.researchAccountId).toBeUndefined();
    });

    it('tags session metadata for governed research-account captures', () => {
        const config = parseGovernedResearchAccountConfig(validConfig);
        const account = resolveGovernedResearchAccount({
            accountId: 'yt-observatory-us-1',
            config,
            requestedPlatforms: ['youtube'],
        });

        const metadata = mergeCaptureModeMetadata(
            { uploadEvent: 'SYNTHETIC_YOUTUBE_SESSION' },
            createGovernedResearchCaptureModeContext(account),
        );

        expect(metadata.researchMode).toBe('research-account');
        expect(metadata.captureIdentity).toBe('signed-in-research-account');
        expect(metadata.researchAccountId).toBe('yt-observatory-us-1');
        expect(metadata.researchAccountCredentialSourceReference).toBe('local-youtube-us-1');
    });

    it('refuses local-manual-only accounts for orchestrated resolution', () => {
        const config = parseGovernedResearchAccountConfig({
            version: 1,
            accounts: [
                {
                    ...validConfig.accounts[0],
                    id: 'yt-local-only',
                    runScope: 'local-manual-only',
                },
            ],
        });

        expect(() => resolveGovernedResearchAccount({
            accountId: 'yt-local-only',
            config,
            requestedPlatforms: ['youtube'],
        })).toThrow(/local\/manual use/i);
    });
});
