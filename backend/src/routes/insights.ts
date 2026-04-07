import { Router, Request, Response } from 'express';
import { generateFeedInsights } from '../services/insights.js';

const router: Router = Router();

// GET /insights?snapshotId=... (legacy compatibility route)
router.get('/', async (req: Request, res: Response) => {
  const snapshotId = typeof req.query.snapshotId === 'string' ? req.query.snapshotId.trim() : '';
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  if (!snapshotId || !userId) {
    return res.status(400).json({ error: 'snapshotId and userId are required' });
  }

  try {
    const insights = await generateFeedInsights(userId, snapshotId);
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

export default router;
