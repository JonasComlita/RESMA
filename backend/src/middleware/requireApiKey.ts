import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { createError } from './errorHandler.js';
import type { AuthRequest } from './authenticate.js';
import {
    getApiKeyQuotaSnapshot,
    hasApiKeyScopes,
    parseApiKey,
    recordApiKeyUsage,
    verifyApiKeyHash,
} from '../services/apiKeys.js';

export interface ApiKeyAuthContext {
    id: string;
    userId: string;
    name: string;
    lookupId: string;
    keyPrefix: string;
    scopes: string[];
    dailyQuota: number;
    monthlyQuota: number;
}

export interface ApiKeyRequest extends AuthRequest {
    apiKey?: ApiKeyAuthContext;
    authMode?: 'jwt' | 'api_key';
}

export interface RequireApiKeyOptions {
    routeKey: string;
    requiredScopes?: string[];
}

function readApiKeyFromRequest(req: Request) {
    const directHeader = req.header('x-api-key');
    if (directHeader) {
        return directHeader;
    }

    const authorization = req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
        return null;
    }

    return authorization.slice('Bearer '.length).trim();
}

export function requireApiKey(options: RequireApiKeyOptions) {
    const requiredScopes = options.requiredScopes ?? [];

    return async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
        try {
            const providedKey = readApiKeyFromRequest(req);
            if (!providedKey) {
                return next(createError('API key required', 401));
            }

            const parsedKey = parseApiKey(providedKey);
            if (!parsedKey) {
                return next(createError('Invalid API key format', 401));
            }

            const apiKey = await prisma.apiKey.findUnique({
                where: { lookupId: parsedKey.lookupId },
                select: {
                    id: true,
                    userId: true,
                    name: true,
                    lookupId: true,
                    keyHash: true,
                    keyPrefix: true,
                    status: true,
                    scopes: true,
                    dailyQuota: true,
                    monthlyQuota: true,
                    expiresAt: true,
                    revokedAt: true,
                },
            });

            if (!apiKey || apiKey.status !== 'ACTIVE') {
                return next(createError('Invalid API key', 401));
            }

            if (!verifyApiKeyHash(apiKey.keyHash, parsedKey.rawKey)) {
                return next(createError('Invalid API key', 401));
            }

            const now = new Date();
            if (apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt <= now)) {
                return next(createError('API key is no longer active', 403));
            }

            if (!hasApiKeyScopes(apiKey, requiredScopes)) {
                return next(createError('API key does not include the required scope', 403));
            }

            const quota = await getApiKeyQuotaSnapshot(apiKey.id, apiKey, now);
            if (quota.daily.remaining <= 0) {
                return res.status(429).json({
                    success: false,
                    error: 'API key daily quota exceeded',
                    details: quota,
                });
            }

            if (quota.monthly.remaining <= 0) {
                return res.status(429).json({
                    success: false,
                    error: 'API key monthly quota exceeded',
                    details: quota,
                });
            }

            req.apiKey = {
                id: apiKey.id,
                userId: apiKey.userId,
                name: apiKey.name,
                lookupId: apiKey.lookupId,
                keyPrefix: apiKey.keyPrefix,
                scopes: apiKey.scopes,
                dailyQuota: apiKey.dailyQuota,
                monthlyQuota: apiKey.monthlyQuota,
            };
            req.userId = apiKey.userId;
            req.authMode = 'api_key';

            res.on('finish', () => {
                void recordApiKeyUsage({
                    apiKeyId: apiKey.id,
                    routeKey: options.routeKey,
                    statusCode: res.statusCode,
                    ipAddress: req.ip || req.socket.remoteAddress || null,
                }).catch((error) => {
                    console.error('Failed to record API key usage:', error);
                });
            });

            next();
        } catch (error) {
            next(error);
        }
    };
}
