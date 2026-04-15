import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { createError } from './errorHandler.js';
import { AuthRequest } from './authenticate.js';

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

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: { subscriptionTier: true },
        });

        if (!user) {
            return next(createError('User not found', 404));
        }

        if (user.subscriptionTier !== 'PREMIUM') {
            return next(createError('Premium subscription required for this feature', 403));
        }

        next();
    } catch (error) {
        next(error);
    }
}
