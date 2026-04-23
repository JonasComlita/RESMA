import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

function parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type KeyStrategy = 'ip' | 'user';

function rateLimitKey(req: Request, keyStrategy: KeyStrategy) {
    if (keyStrategy === 'user') {
        const userId = typeof (req as Request & { userId?: unknown }).userId === 'string'
            ? (req as Request & { userId?: string }).userId
            : null;
        if (userId) {
            return `user:${userId}`;
        }
    }

    return req.ip || req.socket.remoteAddress || 'unknown-ip';
}

function buildLimiter(windowMs: number, max: number, keyStrategy: KeyStrategy = 'ip') {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => rateLimitKey(req, keyStrategy),
        handler: (_req, res) => {
            res.status(429).json({
                success: false,
                error: 'Too many requests, please try again later.',
            });
        },
    });
}

export function createAuthRateLimiter() {
    return buildLimiter(
        parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
        parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 5)
    );
}

export function createIngestRateLimiter() {
    return buildLimiter(
        parsePositiveInt(process.env.INGEST_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
        parsePositiveInt(process.env.INGEST_RATE_LIMIT_MAX, 20)
    );
}

export function createAnalysisRateLimiter() {
    return buildLimiter(
        parsePositiveInt(process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000),
        parsePositiveInt(process.env.ANALYSIS_RATE_LIMIT_MAX, 15)
    );
}

export function createUserAnalysisRateLimiter() {
    return buildLimiter(
        parsePositiveInt(process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000),
        parsePositiveInt(process.env.ANALYSIS_RATE_LIMIT_MAX, 15),
        'user'
    );
}
