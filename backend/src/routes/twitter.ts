import { Router } from 'express';
import { saveTwitterFeedData } from '../services/twitter.js';

const router = Router();

// POST /api/twitter/feed - Receive and process Twitter feed data
router.post('/feed', async (req, res) => {
    try {
        const feed = req.body?.feed;
        const userId = req.user?.id || undefined; // If using auth middleware
        if (!Array.isArray(feed) || feed.length === 0) {
            return res.status(400).json({ message: 'No feed data provided' });
        }
        const snapshot = await saveTwitterFeedData(feed, userId);
        res.status(201).json({ message: 'Feed data saved', snapshotId: snapshot?.id });
    } catch (err) {
        res.status(500).json({ message: 'Failed to save Twitter feed', error: (err as Error).message });
    }
});

export default router;
