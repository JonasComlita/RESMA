import rateLimit from 'express-rate-limit';

function parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildLimiter(windowMs: number, max: number) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
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
