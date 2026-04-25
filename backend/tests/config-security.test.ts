import { afterEach, describe, expect, it, vi } from 'vitest';

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;
const originalApiKeyPepper = process.env.API_KEY_PEPPER;
const originalRecoveryCodePepper = process.env.RECOVERY_CODE_PEPPER;
const originalPublicApiBaseUrl = process.env.PUBLIC_API_BASE_URL;

afterEach(() => {
    vi.resetModules();
    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalJwtSecret === undefined) {
        delete process.env.JWT_SECRET;
    } else {
        process.env.JWT_SECRET = originalJwtSecret;
    }

    if (originalApiKeyPepper === undefined) {
        delete process.env.API_KEY_PEPPER;
    } else {
        process.env.API_KEY_PEPPER = originalApiKeyPepper;
    }

    if (originalRecoveryCodePepper === undefined) {
        delete process.env.RECOVERY_CODE_PEPPER;
    } else {
        process.env.RECOVERY_CODE_PEPPER = originalRecoveryCodePepper;
    }

    if (originalPublicApiBaseUrl === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
    } else {
        process.env.PUBLIC_API_BASE_URL = originalPublicApiBaseUrl;
    }
});

describe('JWT secret enforcement', () => {
    it('refuses to load production config with the default JWT secret', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.JWT_SECRET;

        await expect(import('../src/config')).rejects.toThrow(
            /JWT_SECRET must be set to a non-default value in production/
        );
    });

    it('allows production config with an explicit JWT secret', async () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'production-secret';
        process.env.API_KEY_PEPPER = 'production-api-key-pepper';
        process.env.PUBLIC_API_BASE_URL = 'https://api.resma.example';

        const { config } = await import('../src/config');

        expect(config.jwt.secret).toBe('production-secret');
        expect(config.api.publicBaseUrl).toBe('https://api.resma.example');
    });

    it('refuses to load production config with default recovery code pepper', async () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'production-secret';
        process.env.API_KEY_PEPPER = 'production-api-key-pepper';
        process.env.RECOVERY_CODE_PEPPER = 'change-me-before-production';
        process.env.PUBLIC_API_BASE_URL = 'https://api.resma.example';

        await expect(import('../src/config')).rejects.toThrow(
            /RECOVERY_CODE_PEPPER or API_KEY_PEPPER must be set to a non-default value in production/
        );
    });

    it('refuses to load production config without a public API base URL', async () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'production-secret';
        process.env.API_KEY_PEPPER = 'production-api-key-pepper';
        delete process.env.PUBLIC_API_BASE_URL;

        await expect(import('../src/config')).rejects.toThrow(
            /PUBLIC_API_BASE_URL must be set in production/
        );
    });
});
