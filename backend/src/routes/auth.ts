import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { validateZod } from '../middleware/validateZod.js';
import { logger } from '../lib/logger.js';

export const authRouter: Router = Router();

const RECOVERY_CODE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Zod schemas ──────────────────────────────────────────────────────────

const registerSchema = z.object({
    password: z.string().min(8, 'Password must be at least 8 characters').max(100, 'Password is too long'),
});

const loginSchema = z.object({
    anonymousId: z.string().min(1, 'Anonymous ID required'),
    password: z.string().min(1, 'Password required').max(100, 'Password is too long'),
});

const recoverSchema = z.object({
    recoveryCode: z.string().min(1, 'Recovery code required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters').max(100, 'New password is too long'),
});

const deleteAccountSchema = z.object({
    confirmAnonymousId: z.string().min(1, 'Contributor ID confirmation required'),
});

// ── Helpers ──────────────────────────────────────────────────────────────

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

function hashLegacyRecoveryCode(recoveryCode: string) {
    return createHash('sha256').update(recoveryCode).digest('hex');
}

function getRecoveryCodeLookupHash(recoveryCode: string) {
    return createHmac('sha256', config.recoveryCodes.pepper)
        .update(recoveryCode)
        .digest('hex');
}

async function hashRecoveryCode(recoveryCode: string) {
    return bcrypt.hash(recoveryCode, config.recoveryCodes.bcryptCost);
}

async function verifyRecoveryCode(recoveryCode: string, storedHash: string | null) {
    if (!storedHash) {
        return false;
    }

    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
        return bcrypt.compare(recoveryCode, storedHash);
    }

    return storedHash === hashLegacyRecoveryCode(recoveryCode);
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

function recoveryCodeExpiresAt() {
    return new Date(Date.now() + RECOVERY_CODE_TTL_MS);
}

// ── Routes ───────────────────────────────────────────────────────────────

// Register new user
authRouter.post(
    '/register',
    validateZod({ body: registerSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { password } = req.body;
            const passwordHash = await bcrypt.hash(password, 12);
            const recoveryCode = generateRecoveryCode();
            const normalizedRecoveryCode = normalizeRecoveryCode(recoveryCode)!;
            const recoveryCodeHash = await hashRecoveryCode(normalizedRecoveryCode);
            const userData: Prisma.UserCreateInput = {
                passwordHash,
                recoveryCodeHash,
                recoveryCodeLookupHash: getRecoveryCodeLookupHash(normalizedRecoveryCode),
                recoveryCodeExpiresAt: recoveryCodeExpiresAt(),
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
    validateZod({ body: loginSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
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
    validateZod({ body: recoverSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const normalizedRecoveryCode = normalizeRecoveryCode(req.body.recoveryCode);
            if (!normalizedRecoveryCode) {
                return next(createError('Invalid recovery code', 401));
            }

            const recoveryCodeLookupHash = getRecoveryCodeLookupHash(normalizedRecoveryCode);
            let user = await prisma.user.findUnique({
                where: { recoveryCodeLookupHash },
            });

            if (!user) {
                user = await prisma.user.findUnique({
                    where: { recoveryCodeHash: hashLegacyRecoveryCode(normalizedRecoveryCode) },
                });
            }

            if (!user || !(await verifyRecoveryCode(normalizedRecoveryCode, user.recoveryCodeHash))) {
                return next(createError('Invalid recovery code', 401));
            }

            // Enforce time-bound expiration (Security Standard §5)
            if (user.recoveryCodeExpiresAt && user.recoveryCodeExpiresAt < new Date()) {
                logger.warn({ userId: user.id }, 'Expired recovery code used');
                return next(createError('Recovery code has expired. Please contact support or request a new one.', 401));
            }

            const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
            const nextRecoveryCode = generateRecoveryCode();
            const normalizedNextRecoveryCode = normalizeRecoveryCode(nextRecoveryCode)!;
            const updatedUserData: Prisma.UserUpdateInput = {
                passwordHash,
                recoveryCodeHash: await hashRecoveryCode(normalizedNextRecoveryCode),
                recoveryCodeLookupHash: getRecoveryCodeLookupHash(normalizedNextRecoveryCode),
                recoveryCodeExpiresAt: recoveryCodeExpiresAt(),
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
    validateZod({ body: deleteAccountSchema }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
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
