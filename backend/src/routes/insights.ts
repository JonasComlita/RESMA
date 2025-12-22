import { Router } from 'express';
import { getFeedInsights } from '../services/insights.js';

const router = Router();

// GET /insights?platform=platformName
router.get('/', async (req, res) => {
  const { platform } = req.query;
  try {
    const insights = await getFeedInsights({ platform: platform as string | undefined });
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

export default router;
