import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_JWT_SECRET = 'dev-secret-change-me';
const DISALLOWED_PRODUCTION_JWT_SECRETS = new Set([
    DEFAULT_JWT_SECRET,
    'your-super-secret-jwt-key-change-in-production',
]);

const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (process.env.NODE_ENV === 'production' && DISALLOWED_PRODUCTION_JWT_SECRETS.has(jwtSecret)) {
    throw new Error('JWT_SECRET must be set to a non-default value in production');
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
    },

    analytics: {
        datasetCacheTtlMs: parseInt(process.env.ANALYTICS_DATASET_CACHE_TTL_MS || '30000', 10),
        materializedCacheTtlMs: parseInt(process.env.ANALYTICS_MATERIALIZED_CACHE_TTL_MS || '30000', 10),
        evaluationCacheTtlMs: parseInt(process.env.ANALYTICS_EVALUATION_CACHE_TTL_MS || '30000', 10),
    },
};
