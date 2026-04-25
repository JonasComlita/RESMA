import { Router } from 'express';
import { body, param } from 'express-validator';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/authenticate.js';
import { createError } from '../middleware/errorHandler.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
    createApiKey,
    loadApiKeyUsageSummaries,
    normalizeApiKeyScopes,
} from '../services/apiKeys.js';
import { getPackageEntitlements } from '../services/packageAccess.js';

export const apiKeysRouter: Router = Router();

apiKeysRouter.use(authenticate);

apiKeysRouter.get('/', async (req: AuthRequest, res, next) => {
    try {
        const apiKeys = await prisma.apiKey.findMany({
            where: {
                userId: req.userId,
            },
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                name: true,
                accessPackage: true,
                lookupId: true,
                keyPrefix: true,
                status: true,
                scopes: true,
                dailyQuota: true,
                monthlyQuota: true,
                totalRequests: true,
                lastUsedAt: true,
                createdAt: true,
                updatedAt: true,
                expiresAt: true,
                revokedAt: true,
            },
        });

        const usageById = await loadApiKeyUsageSummaries(apiKeys.map((apiKey) => apiKey.id));

        res.json({
            success: true,
            data: {
                apiKeys: apiKeys.map((apiKey) => ({
                    ...apiKey,
                    usage: usageById.get(apiKey.id) ?? null,
                    entitlements: getPackageEntitlements(apiKey.accessPackage),
                })),
            },
        });
    } catch (error) {
        next(error);
    }
});

apiKeysRouter.post(
    '/',
    ...validateRequest([
        body('name')
            .trim()
            .isLength({ min: 3, max: 80 })
            .withMessage('name must be between 3 and 80 characters'),
        body('scopes')
            .optional()
            .isArray({ min: 1 })
            .withMessage('scopes must be a non-empty array'),
        body('scopes.*')
            .optional()
            .isString()
            .withMessage('scopes must contain strings'),
        body('dailyQuota')
            .optional()
            .isInt({ min: 1, max: 1_000_000 })
            .withMessage('dailyQuota must be between 1 and 1000000'),
        body('monthlyQuota')
            .optional()
            .isInt({ min: 1, max: 10_000_000 })
            .withMessage('monthlyQuota must be between 1 and 10000000'),
        body('expiresAt')
            .optional()
            .isISO8601()
            .withMessage('expiresAt must be a valid ISO-8601 datetime'),
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
            if (expiresAt && expiresAt <= new Date()) {
                return next(createError('expiresAt must be in the future', 400));
            }

            const user = await prisma.user.findUnique({
                where: { id: req.userId },
                select: {
                    id: true,
                    accessPackage: true,
                },
            });

            if (!user) {
                return next(createError('User not found', 404));
            }

            const entitlements = getPackageEntitlements(user.accessPackage);
            const requestedScopes = normalizeApiKeyScopes(req.body.scopes, entitlements.allowedScopes);
            if (requestedScopes.length === 0) {
                return next(createError(`Package ${user.accessPackage} does not allow the requested scopes`, 403));
            }

            const created = await createApiKey({
                userId: req.userId!,
                accessPackage: user.accessPackage,
                name: String(req.body.name).trim(),
                scopes: requestedScopes,
                dailyQuota: req.body.dailyQuota ? Number(req.body.dailyQuota) : undefined,
                monthlyQuota: req.body.monthlyQuota ? Number(req.body.monthlyQuota) : undefined,
                expiresAt,
            });

            res.status(201).json({
                success: true,
                data: {
                    apiKey: created.record,
                    secret: created.apiKey,
                    preview: created.preview,
                    entitlements: getPackageEntitlements(created.record.accessPackage),
                    note: 'This secret is only returned once. Store it now.',
                },
            });
        } catch (error) {
            next(error);
        }
    },
);

apiKeysRouter.delete(
    '/:apiKeyId',
    ...validateRequest([
        param('apiKeyId')
            .isUUID()
            .withMessage('apiKeyId must be a valid UUID'),
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const existing = await prisma.apiKey.findFirst({
                where: {
                    id: req.params.apiKeyId,
                    userId: req.userId,
                },
                select: {
                    id: true,
                    status: true,
                },
            });

            if (!existing) {
                return next(createError('API key not found', 404));
            }

            if (existing.status === 'REVOKED') {
                return res.json({
                    success: true,
                    data: {
                        revoked: true,
                        alreadyRevoked: true,
                    },
                });
            }

            await prisma.apiKey.update({
                where: { id: existing.id },
                data: {
                    status: 'REVOKED',
                    revokedAt: new Date(),
                },
            });

            res.json({
                success: true,
                data: {
                    revoked: true,
                    apiKeyId: existing.id,
                },
            });
        } catch (error) {
            next(error);
        }
    },
);
