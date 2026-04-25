import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_JWT_SECRET = 'dev-secret-change-me';
const DEFAULT_API_KEY_PEPPER = 'dev-api-key-pepper-change-me';
const DEFAULT_RECOVERY_CODE_PEPPER = DEFAULT_API_KEY_PEPPER;
const DISALLOWED_PRODUCTION_JWT_SECRETS = new Set([
    DEFAULT_JWT_SECRET,
    'your-super-secret-jwt-key-change-in-production',
]);
const DISALLOWED_PRODUCTION_API_KEY_PEPPERS = new Set([
    DEFAULT_API_KEY_PEPPER,
    'change-me-before-production',
]);

const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const apiKeyPepper = process.env.API_KEY_PEPPER || DEFAULT_API_KEY_PEPPER;
const recoveryCodePepper = process.env.RECOVERY_CODE_PEPPER || apiKeyPepper;
const publicApiBaseUrl = process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || '3001'}`;

if (process.env.NODE_ENV === 'production' && DISALLOWED_PRODUCTION_JWT_SECRETS.has(jwtSecret)) {
    throw new Error('JWT_SECRET must be set to a non-default value in production');
}

if (process.env.NODE_ENV === 'production' && DISALLOWED_PRODUCTION_API_KEY_PEPPERS.has(apiKeyPepper)) {
    throw new Error('API_KEY_PEPPER must be set to a non-default value in production');
}

if (
    process.env.NODE_ENV === 'production' &&
    (recoveryCodePepper === DEFAULT_RECOVERY_CODE_PEPPER ||
        DISALLOWED_PRODUCTION_API_KEY_PEPPERS.has(recoveryCodePepper))
) {
    throw new Error('RECOVERY_CODE_PEPPER or API_KEY_PEPPER must be set to a non-default value in production');
}

if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_API_BASE_URL) {
    throw new Error('PUBLIC_API_BASE_URL must be set in production');
}

export const config = {
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    jwt: {
        secret: jwtSecret,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },

    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    },

    database: {
        url: process.env.DATABASE_URL,
    },

    premium: {
        cacheTtlMs: parseInt(process.env.PREMIUM_CACHE_TTL_MS || '30000', 10),
        cacheMaxEntries: parseInt(process.env.PREMIUM_CACHE_MAX_ENTRIES || '10000', 10),
    },

    apiKeys: {
        pepper: apiKeyPepper,
        prefix: process.env.API_KEY_PREFIX || (process.env.NODE_ENV === 'production' ? 'resma_live' : 'resma_test'),
        defaultDailyQuota: parseInt(process.env.API_KEY_DEFAULT_DAILY_QUOTA || '500', 10),
        defaultMonthlyQuota: parseInt(process.env.API_KEY_DEFAULT_MONTHLY_QUOTA || '10000', 10),
    },

    api: {
        publicBaseUrl: publicApiBaseUrl,
    },

    recoveryCodes: {
        pepper: recoveryCodePepper,
        bcryptCost: parseInt(process.env.RECOVERY_CODE_BCRYPT_COST || '12', 10),
    },

    analytics: {
        datasetCacheTtlMs: parseInt(process.env.ANALYTICS_DATASET_CACHE_TTL_MS || '30000', 10),
        materializedCacheTtlMs: parseInt(process.env.ANALYTICS_MATERIALIZED_CACHE_TTL_MS || '30000', 10),
        evaluationCacheTtlMs: parseInt(process.env.ANALYTICS_EVALUATION_CACHE_TTL_MS || '30000', 10),
    },
};
