import { createHash, randomBytes } from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';

export const authRouter: Router = Router();

function createSessionToken(userId: string) {
    return jwt.sign({ userId }, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
    });
}

function normalizeRecoveryCode(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized.length >= 12 ? normalized : null;
}

function hashRecoveryCode(recoveryCode: string) {
    return createHash('sha256').update(recoveryCode).digest('hex');
}

function generateRecoveryCode() {
    const raw = randomBytes(12)
        .toString('base64url')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 16)
        .padEnd(16, 'X');

    return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}

// Register new user
authRouter.post(
    '/register',
    [
        body('password')
            .isLength({ min: 8 })
            .withMessage('Password must be at least 8 characters'),
    ],
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            const { password } = req.body;
            const passwordHash = await bcrypt.hash(password, 12);
            const recoveryCode = generateRecoveryCode();
            const recoveryCodeHash = hashRecoveryCode(normalizeRecoveryCode(recoveryCode)!);
            const userData: Prisma.UserCreateInput = {
                passwordHash,
                recoveryCodeHash,
            };

            const user = await prisma.user.create({
                data: userData,
                select: { id: true, anonymousId: true, createdAt: true },
            });

            const token = createSessionToken(user.id);

            res.status(201).json({
                success: true,
                data: {
                    user: {
                        anonymousId: user.anonymousId,
                        createdAt: user.createdAt,
                    },
                    recoveryCode,
                    token,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// Login
authRouter.post(
    '/login',
    [
        body('anonymousId').notEmpty().withMessage('Anonymous ID required'),
        body('password').notEmpty().withMessage('Password required'),
    ],
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            const { anonymousId, password } = req.body;

            const user = await prisma.user.findUnique({
                where: { anonymousId },
            });

            if (!user) {
                return next(createError('Invalid credentials', 401));
            }

            const isValidPassword = await bcrypt.compare(password, user.passwordHash);
            if (!isValidPassword) {
                return next(createError('Invalid credentials', 401));
            }

            const token = createSessionToken(user.id);

            res.json({
                success: true,
                data: {
                    user: {
                        anonymousId: user.anonymousId,
                        createdAt: user.createdAt,
                    },
                    token,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// Recover account with a saved recovery code and rotate credentials
authRouter.post(
    '/recover',
    [
        body('recoveryCode').notEmpty().withMessage('Recovery code required'),
        body('newPassword')
            .isLength({ min: 8 })
            .withMessage('New password must be at least 8 characters'),
    ],
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            const normalizedRecoveryCode = normalizeRecoveryCode(req.body.recoveryCode);
            if (!normalizedRecoveryCode) {
                return next(createError('Invalid recovery code', 401));
            }

            const userLookup: Prisma.UserWhereUniqueInput = {
                recoveryCodeHash: hashRecoveryCode(normalizedRecoveryCode),
            };
            const user = await prisma.user.findUnique({
                where: userLookup,
            });

            if (!user) {
                return next(createError('Invalid recovery code', 401));
            }

            const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
            const nextRecoveryCode = generateRecoveryCode();
            const updatedUserData: Prisma.UserUpdateInput = {
                passwordHash,
                recoveryCodeHash: hashRecoveryCode(normalizeRecoveryCode(nextRecoveryCode)!),
            };
            const updatedUser = await prisma.user.update({
                where: { id: user.id },
                data: updatedUserData,
                select: { id: true, anonymousId: true, createdAt: true },
            });

            const token = createSessionToken(updatedUser.id);

            res.json({
                success: true,
                data: {
                    user: {
                        anonymousId: updatedUser.anonymousId,
                        createdAt: updatedUser.createdAt,
                    },
                    recoveryCode: nextRecoveryCode,
                    token,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// Delete contributor account and all owned snapshots/items
authRouter.post(
    '/delete-account',
    authenticate,
    [
        body('confirmAnonymousId').notEmpty().withMessage('Contributor ID confirmation required'),
    ],
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            const user = await prisma.user.findUnique({
                where: { id: req.userId },
                select: {
                    id: true,
                    anonymousId: true,
                },
            });

            if (!user) {
                return next(createError('User not found', 404));
            }

            if (req.body.confirmAnonymousId !== user.anonymousId) {
                return next(createError('Contributor ID confirmation did not match your account.', 400));
            }

            await prisma.user.delete({
                where: { id: user.id },
            });

            res.json({
                success: true,
                data: {
                    deleted: true,
                    anonymousId: user.anonymousId,
                },
                message: 'Contributor account and all associated observatory data deleted.',
            });
        } catch (error) {
            next(error);
        }
    }
);

// Get current user
authRouter.get('/me', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                anonymousId: true,
                createdAt: true,
                preferences: true,
                contributeToCreatorInsights: true,
                _count: {
                    select: {
                        feedSnapshots: true,

                    },
                },
            },
        });

        if (!user) {
            return next(createError('User not found', 404));
        }

        res.json({
            success: true,
            data: { user },
        });
    } catch (error) {
        next(error);
    }
});
