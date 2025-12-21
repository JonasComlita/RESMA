import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';

export const authRouter = Router();

// Register new user
authRouter.post(
    '/register',
    [
        body('password')
            .isLength({ min: 8 })
            .withMessage('Password must be at least 8 characters'),
    ],
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            const { password } = req.body;
            const passwordHash = await bcrypt.hash(password, 12);

            const user = await prisma.user.create({
                data: { passwordHash },
                select: { id: true, anonymousId: true, createdAt: true },
            });

            const token = jwt.sign({ userId: user.id }, config.jwt.secret, {
                expiresIn: config.jwt.expiresIn,
            });

            res.status(201).json({
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

// Login
authRouter.post(
    '/login',
    [
        body('anonymousId').notEmpty().withMessage('Anonymous ID required'),
        body('password').notEmpty().withMessage('Password required'),
    ],
    async (req, res, next) => {
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

            const token = jwt.sign({ userId: user.id }, config.jwt.secret, {
                expiresIn: config.jwt.expiresIn,
            });

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

// Get current user
authRouter.get('/me', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                anonymousId: true,
                createdAt: true,
                preferences: true,
                _count: {
                    select: {
                        feedSnapshots: true,
                        forumPosts: true,
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
