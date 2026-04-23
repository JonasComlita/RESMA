import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/authenticate.js';

process.env.PREMIUM_CACHE_TTL_MS = '60000';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        user: {
            findUnique: vi.fn(),
        },
    },
}));

const { prisma } = await import('../src/lib/prisma.js');
const { requirePremium, resetPremiumTierCacheForTests } = await import('../src/middleware/requirePremium.js');

describe('requirePremium', () => {
    beforeEach(() => {
        resetPremiumTierCacheForTests();
        vi.clearAllMocks();
    });

    it('uses a short-lived cache for repeated premium checks on the same user', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            subscriptionTier: 'PREMIUM',
        } as any);

        const next = vi.fn();
        const req = { userId: 'user-1' } as AuthRequest;

        await requirePremium(req, {} as Response, next);
        await requirePremium(req, {} as Response, next);

        expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenNthCalledWith(1);
        expect(next).toHaveBeenNthCalledWith(2);
    });

    it('caches non-premium tiers and keeps denying access consistently', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            subscriptionTier: 'FREE',
        } as any);

        const firstNext = vi.fn();
        const secondNext = vi.fn();
        const req = { userId: 'user-2' } as AuthRequest;

        await requirePremium(req, {} as Response, firstNext);
        await requirePremium(req, {} as Response, secondNext);

        expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
        expect(firstNext).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Premium subscription required for this feature',
                statusCode: 403,
            })
        );
        expect(secondNext).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Premium subscription required for this feature',
                statusCode: 403,
            })
        );
    });

    it('rejects unauthenticated requests before touching the database', async () => {
        const next = vi.fn();

        await requirePremium({} as AuthRequest, {} as Response, next);

        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Authentication required',
                statusCode: 401,
            })
        );
    });
});
