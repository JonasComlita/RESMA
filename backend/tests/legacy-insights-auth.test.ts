import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateFeedInsights = vi.fn();

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        feedSnapshot: {
            create: vi.fn(),
            findMany: vi.fn(),
            count: vi.fn(),
            findFirst: vi.fn(),
            delete: vi.fn(),
        },
        feedItem: {
            findFirst: vi.fn(),
            groupBy: vi.fn(),
            count: vi.fn(),
            findMany: vi.fn(),
        },
        user: {
            count: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
        },
        creator: {
            count: vi.fn(),
        },
    },
}));

vi.mock('../src/services/insights.js', () => ({
    generateFeedInsights,
}));

const { config } = await import('../src/config');
const { default: app } = await import('../src/index');

function makeAuthToken(userId = 'test-user') {
    return jwt.sign({ userId }, config.jwt.secret);
}

describe('Legacy insights route hardening', () => {
    beforeEach(() => {
        generateFeedInsights.mockReset();
    });

    it('requires auth on GET /insights', async () => {
        const res = await request(app)
            .get('/insights')
            .query({ snapshotId: 'snapshot-1' });

        expect(res.status).toBe(401);
        expect(String(res.body.error)).toMatch(/Authorization token required|Invalid or expired token/);
    });

    it('uses the authenticated user instead of a caller-supplied userId query param', async () => {
        generateFeedInsights.mockResolvedValue({ reasons: [] });

        const res = await request(app)
            .get('/insights')
            .set('Authorization', `Bearer ${makeAuthToken('real-user')}`)
            .query({ snapshotId: 'snapshot-1', userId: 'attacker-user' });

        expect(res.status).toBe(200);
        expect(generateFeedInsights).toHaveBeenCalledWith('real-user', 'snapshot-1');
    });
});
