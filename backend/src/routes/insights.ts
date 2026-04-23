import { Router } from 'express';
import { query } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { createUserAnalysisRateLimiter } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { generateFeedInsights } from '../services/insights.js';

const router: Router = Router();
const userAnalysisRateLimiter = createUserAnalysisRateLimiter();

// GET /insights?snapshotId=... (legacy compatibility route)
router.get(
  '/',
  authenticate,
  userAnalysisRateLimiter,
  ...validateRequest([
    query('snapshotId')
      .trim()
      .notEmpty()
      .withMessage('snapshotId is required'),
  ]),
  async (req: AuthRequest, res, next) => {
    const snapshotId = typeof req.query.snapshotId === 'string' ? req.query.snapshotId.trim() : '';

    try {
      const insights = await generateFeedInsights(req.userId!, snapshotId);
      res.json(insights);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
