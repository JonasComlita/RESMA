import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { feedsRouter } from './routes/feeds.js';
import { analysisRouter } from './routes/analysis.js';
import { creatorsRouter } from './routes/creators.js';
import { errorHandler } from './middleware/errorHandler.js';
import { msgpackParser } from './middleware/msgpackParser.js';
import {
    createAnalysisRateLimiter,
    createAuthRateLimiter,
    createIngestRateLimiter,
} from './middleware/rateLimit.js';
import youtubeRouter from './routes/youtube.js';
import instagramRouter from './routes/instagram.js';
import insightsRouter from './routes/insights.js';
import twitterRouter from './routes/twitter.js';

const app: express.Express = express();

// Middleware
app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(morgan('dev'));

// Body parsers - MessagePack first (for compressed requests), then JSON fallback
app.use(msgpackParser);
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth/login', createAuthRateLimiter());
app.use('/auth/register', createAuthRateLimiter());
app.use('/auth/recover', createAuthRateLimiter());
app.use('/auth/delete-account', createAuthRateLimiter());
app.use('/auth', authRouter);
app.use('/feeds', createIngestRateLimiter(), feedsRouter);
app.use('/analysis/similar', createAnalysisRateLimiter());
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
    app.listen(config.port, () => {
        console.log(`RESMA API running on port ${config.port}`);
        console.log(`   Environment: ${config.nodeEnv}`);
    });
}

export default app;
