import dotenv from 'dotenv';
dotenv.config();

export const DEFAULT_JWT_SECRET = 'dev-secret-change-me';

const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (process.env.NODE_ENV === 'production' && jwtSecret === DEFAULT_JWT_SECRET) {
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
};
