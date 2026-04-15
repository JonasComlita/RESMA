import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { generateFeedInsights } from '../services/insights.js';

const router: Router = Router();

// GET /insights?snapshotId=... (legacy compatibility route)
router.get('/', authenticate, async (req: AuthRequest, res, next) => {
  const snapshotId = typeof req.query.snapshotId === 'string' ? req.query.snapshotId.trim() : '';
  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshotId is required' });
  }

  try {
    const insights = await generateFeedInsights(req.userId!, snapshotId);
    res.json(insights);
  } catch (err) {
    next(err);
  }
});

export default router;
