import { Router } from 'express';
import { saveInstagramFeedData } from '../services/instagram.js';
import rateLimit from 'express-rate-limit';

const router = Router();

// Basic rate limiting (e.g., 30 requests per 10 minutes per IP)
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(limiter);

// POST /instagram/feed - receive Instagram feed data
router.post('/feed', async (req, res) => {
  // CORS origin check (placeholder, customize as needed)
  const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:5173'];
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }

  const { feed } = req.body;
  if (!Array.isArray(feed) || feed.length === 0) {
    return res.status(400).json({ error: 'Invalid feed data' });
  }
  // Validate feed item structure
  for (const item of feed) {
    if (typeof item !== 'object' || !item.postId || !item.caption) {
      return res.status(400).json({ error: 'Invalid feed item structure' });
    }
  }
  try {
    const snapshot = await saveInstagramFeedData(feed);
    res.status(201).json({ message: 'Instagram feed data saved', snapshot });
  } catch (err) {
    console.error('Failed to save Instagram feed data:', err);
    res.status(500).json({ error: 'Failed to save Instagram feed data' });
  }
});

export default router;
