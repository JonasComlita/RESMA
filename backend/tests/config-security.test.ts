import { afterEach, describe, expect, it, vi } from 'vitest';

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;

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

        const { config } = await import('../src/config');

        expect(config.jwt.secret).toBe('production-secret');
    });
});
