import type { Server } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { authRouter } from './routes/auth.js';
import { feedsRouter } from './routes/feeds.js';
import { analysisRouter } from './routes/analysis.js';
import { creatorsRouter } from './routes/creators.js';
import { errorHandler } from './middleware/errorHandler.js';
import { msgpackParser } from './middleware/msgpackParser.js';
import {
    createAuthRateLimiter,
    createIngestRateLimiter,
} from './middleware/rateLimit.js';
import youtubeRouter from './routes/youtube.js';
import instagramRouter from './routes/instagram.js';
import insightsRouter from './routes/insights.js';
import twitterRouter from './routes/twitter.js';

const app: express.Express = express();
const HEALTH_CACHE_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
let server: Server | null = null;
let shutdownInFlight = false;
let cachedHealth:
    | {
        expiresAt: number;
        payload: {
            ok: boolean;
            checkedAt: string;
            latencyMs: number;
            error?: string;
        };
    }
    | null = null;

async function checkDatabaseHealth() {
    const now = Date.now();
    if (cachedHealth && cachedHealth.expiresAt > now) {
        return cachedHealth.payload;
    }

    const startedAt = now;

    try {
        await prisma.$queryRaw`SELECT 1`;
        const payload = {
            ok: true,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
        };
        cachedHealth = {
            expiresAt: Date.now() + HEALTH_CACHE_MS,
            payload,
        };
        return payload;
    } catch (error) {
        const payload = {
            ok: false,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : 'Unknown database health check failure',
        };
        cachedHealth = {
            expiresAt: Date.now() + Math.min(HEALTH_CACHE_MS, 3_000),
            payload,
        };
        return payload;
    }
}

async function shutdown(signal: string) {
    if (shutdownInFlight) {
        return;
    }
    shutdownInFlight = true;
    console.info(`Received ${signal}, shutting down RESMA API...`);

    let exitCode = 0;

    try {
        if (server) {
            await Promise.race([
                new Promise<void>((resolve, reject) => {
                    server?.close((error) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve();
                    });
                }),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('Timed out while closing HTTP server')), SHUTDOWN_TIMEOUT_MS);
                }),
            ]);
        }
    } catch (error) {
        exitCode = 1;
        console.error('HTTP shutdown failed:', error);
    }

    try {
        await prisma.$disconnect();
    } catch (error) {
        exitCode = 1;
        console.error('Prisma disconnect failed:', error);
    }

    process.exit(exitCode);
}

// Middleware
app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(morgan('dev'));

// Body parsers - MessagePack first (for compressed requests), then JSON fallback
app.use(msgpackParser);
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', async (_req, res) => {
    const timestamp = new Date().toISOString();
    const database = await checkDatabaseHealth();
    const status = database.ok ? 'ok' : 'degraded';

    res.status(database.ok ? 200 : 503).json({
        status,
        timestamp,
        services: {
            database,
        },
    });
});

// Routes
app.use('/auth/login', createAuthRateLimiter());
app.use('/auth/register', createAuthRateLimiter());
app.use('/auth/recover', createAuthRateLimiter());
app.use('/auth/delete-account', createAuthRateLimiter());
app.use('/auth', authRouter);
app.use('/feeds', createIngestRateLimiter(), feedsRouter);
app.use('/analysis', analysisRouter);
app.use('/creators', creatorsRouter);
app.use('/youtube/feed', createIngestRateLimiter());
app.use('/youtube', youtubeRouter);
app.use('/insights', insightsRouter);
app.use('/instagram/feed', createIngestRateLimiter());
app.use('/instagram', instagramRouter);
app.use('/twitter/feed', createIngestRateLimiter());
app.use('/twitter', twitterRouter);

// Error handling
app.use(errorHandler);

const isExecutedDirectly = typeof require !== 'undefined'
    && typeof module !== 'undefined'
    && require.main === module;

// Start server only when executed directly (not during tests/imports)
if (isExecutedDirectly) {
    server = app.listen(config.port, () => {
        console.log(`RESMA API running on port ${config.port}`);
        console.log(`   Environment: ${config.nodeEnv}`);
    });

    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

export default app;
