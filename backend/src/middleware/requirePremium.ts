import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { createError } from './errorHandler.js';
import { AuthRequest } from './authenticate.js';

interface PremiumCacheEntry {
    subscriptionTier: string;
    expiresAt: number;
}

const premiumTierCache = new Map<string, PremiumCacheEntry>();

function getCachedTier(userId: string): string | null {
    const cached = premiumTierCache.get(userId);
    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        premiumTierCache.delete(userId);
        return null;
    }

    return cached.subscriptionTier;
}

function setCachedTier(userId: string, subscriptionTier: string) {
    premiumTierCache.set(userId, {
        subscriptionTier,
        expiresAt: Date.now() + config.premium.cacheTtlMs,
    });
}

export function resetPremiumTierCacheForTests() {
    premiumTierCache.clear();
}

/**
 * Middleware to require premium subscription for creator features
 */
export async function requirePremium(
    req: AuthRequest,
    res: Response,
    next: NextFunction
) {
    try {
        if (!req.userId) {
            return next(createError('Authentication required', 401));
        }

        const cachedTier = getCachedTier(req.userId);
        if (cachedTier) {
            if (cachedTier !== 'PREMIUM') {
                return next(createError('Premium subscription required for this feature', 403));
            }

            return next();
        }

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: { subscriptionTier: true },
        });

        if (!user) {
            return next(createError('User not found', 404));
        }

        setCachedTier(req.userId, user.subscriptionTier);

        if (user.subscriptionTier !== 'PREMIUM') {
            return next(createError('Premium subscription required for this feature', 403));
        }

        next();
    } catch (error) {
        next(error);
    }
}
