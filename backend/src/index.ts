import type { Server } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
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
import redditRouter from './routes/reddit.js';
import { apiKeysRouter } from './routes/apiKeys.js';
import { programmaticApiRouter } from './routes/programmaticApi.js';
import { reportsRouter, sharedReportsRouter } from './routes/reports.js';
import { buildOpenApiDocument } from './openapi.js';

const app: express.Express = express();
app.set('trust proxy', 1);

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
    logger.info(`Received ${signal}, shutting down RESMA API...`);

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
        logger.error({ err: error }, 'HTTP shutdown failed');
    }

    try {
        await prisma.$disconnect();
    } catch (error) {
        exitCode = 1;
        logger.error({ err: error }, 'Prisma disconnect failed');
    }

    process.exit(exitCode);
}

// Middleware
app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(pinoHttp({ logger }));

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
app.use('/api/v1', programmaticApiRouter);
app.use('/api-keys', apiKeysRouter);
app.use('/reports', reportsRouter);
app.use('/shared-reports', sharedReportsRouter);
app.use('/creators', creatorsRouter);
app.use('/youtube/feed', createIngestRateLimiter());
app.use('/youtube', youtubeRouter);
app.use('/insights', insightsRouter);
app.use('/instagram/feed', createIngestRateLimiter());
app.use('/instagram', instagramRouter);
app.use('/twitter/feed', createIngestRateLimiter());
app.use('/twitter', twitterRouter);
app.use('/reddit/feed', createIngestRateLimiter());
app.use('/reddit', redditRouter);
app.get('/docs/openapi.json', (_req, res) => {
    res.json(buildOpenApiDocument());
});
app.get('/docs', (_req, res) => {
    res.type('html').send([
        '<!doctype html>',
        '<html lang="en">',
        '<head><meta charset="utf-8"><title>RESMA API Docs</title></head>',
        '<body>',
        '<h1>RESMA Programmatic API</h1>',
        '<p>Aggregate-only machine endpoints live under <code>/api/v1/analysis/*</code> and agency report delivery lives under <code>/reports/*</code>.</p>',
        '<ul>',
        '<li><a href="/docs/openapi.json">OpenAPI JSON</a></li>',
        '<li>Repository guide: <code>docs/api/README.md</code></li>',
        '<li>JWT key management routes: <code>/api-keys</code></li>',
        '<li>JWT agency report routes: <code>/reports</code></li>',
        '<li>Read-only share routes: <code>/shared-reports/:shareToken</code></li>',
        '</ul>',
        '</body>',
        '</html>',
    ].join(''));
});

// Error handling
app.use(errorHandler);

const isExecutedDirectly = process.argv[1]?.endsWith('index.ts')
    || process.argv[1]?.endsWith('index.js')
    || (typeof require !== 'undefined'
        && typeof module !== 'undefined'
        && require.main === module);

// Start server only when executed directly (not during tests/imports)
if (isExecutedDirectly) {
    server = app.listen(config.port, () => {
        logger.info({ port: config.port, env: config.nodeEnv }, 'RESMA API running');
    });

    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

export default app;
