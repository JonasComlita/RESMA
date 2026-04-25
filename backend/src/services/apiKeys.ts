import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AccessPackage, ApiKey, Prisma } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { getPackageEntitlements } from './packageAccess.js';

export const DEFAULT_API_KEY_SCOPES = ['analysis:read'] as const;
export type ApiKeyScope = typeof DEFAULT_API_KEY_SCOPES[number];

export interface ParsedApiKey {
    rawKey: string;
    lookupId: string;
}

export interface ApiKeyQuotaSnapshot {
    daily: {
        limit: number;
        used: number;
        remaining: number;
    };
    monthly: {
        limit: number;
        used: number;
        remaining: number;
    };
}

export interface CreateApiKeyInput {
    userId: string;
    accessPackage: AccessPackage;
    name: string;
    scopes?: string[];
    dailyQuota?: number;
    monthlyQuota?: number;
    expiresAt?: Date | null;
}

export interface CreatedApiKeyRecord {
    apiKey: string;
    preview: string;
    record: {
        id: string;
        name: string;
        accessPackage: AccessPackage;
        lookupId: string;
        keyPrefix: string;
        scopes: string[];
        dailyQuota: number;
        monthlyQuota: number;
        createdAt: Date;
        expiresAt: Date | null;
    };
}

function startOfUtcDay(input = new Date()) {
    return new Date(Date.UTC(
        input.getUTCFullYear(),
        input.getUTCMonth(),
        input.getUTCDate(),
    ));
}

function startOfUtcMonth(input = new Date()) {
    return new Date(Date.UTC(
        input.getUTCFullYear(),
        input.getUTCMonth(),
        1,
    ));
}

function normalizeScope(scope: string) {
    return scope.trim().toLowerCase();
}

export function normalizeApiKeyScopes(scopes: string[] | undefined, allowedScopes?: readonly string[]): string[] {
    const values = scopes && scopes.length > 0 ? scopes : Array.from(DEFAULT_API_KEY_SCOPES);
    const normalizedValues = Array.from(new Set(values.map(normalizeScope).filter(Boolean)));

    if (!allowedScopes || allowedScopes.length === 0) {
        return normalizedValues;
    }

    const allowed = new Set(allowedScopes.map(normalizeScope));
    return normalizedValues.filter((scope) => allowed.has(scope));
}

export function buildApiKeyRawValue(lookupId: string, secret: string) {
    return `${config.apiKeys.prefix}.${lookupId}.${secret}`;
}

export function buildApiKeyPreview(rawKey: string) {
    if (rawKey.length <= 12) {
        return rawKey;
    }

    return `${rawKey.slice(0, 12)}...${rawKey.slice(-4)}`;
}

export function hashApiKey(rawKey: string) {
    return createHmac('sha256', config.apiKeys.pepper)
        .update(rawKey)
        .digest('hex');
}

export function parseApiKey(rawValue: unknown): ParsedApiKey | null {
    if (typeof rawValue !== 'string') {
        return null;
    }

    const rawKey = rawValue.trim();
    if (!rawKey.startsWith(`${config.apiKeys.prefix}.`)) {
        return null;
    }

    const parts = rawKey.split('.');
    if (parts.length < 3) {
        return null;
    }

    const lookupId = parts[1]?.trim();
    if (!lookupId) {
        return null;
    }

    return {
        rawKey,
        lookupId,
    };
}

export function verifyApiKeyHash(expectedHash: string, rawKey: string) {
    const actualHash = hashApiKey(rawKey);
    const expectedBuffer = Buffer.from(expectedHash, 'utf-8');
    const actualBuffer = Buffer.from(actualHash, 'utf-8');

    if (expectedBuffer.length !== actualBuffer.length) {
        return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function hasApiKeyScopes(apiKey: Pick<ApiKey, 'scopes'>, requiredScopes: string[]) {
    if (requiredScopes.length === 0) {
        return true;
    }

    const granted = new Set(apiKey.scopes.map(normalizeScope));
    return requiredScopes.every((scope) => granted.has(normalizeScope(scope)));
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKeyRecord> {
    const entitlements = getPackageEntitlements(input.accessPackage);
    const lookupId = randomBytes(6).toString('base64url');
    const secret = randomBytes(24).toString('base64url');
    const apiKey = buildApiKeyRawValue(lookupId, secret);
    const keyHash = hashApiKey(apiKey);
    const scopes = normalizeApiKeyScopes(input.scopes, entitlements.allowedScopes);
    const dailyQuota = Math.min(
        input.dailyQuota ?? entitlements.defaultDailyQuota,
        entitlements.defaultDailyQuota,
    );
    const monthlyQuota = Math.min(
        input.monthlyQuota ?? entitlements.defaultMonthlyQuota,
        entitlements.defaultMonthlyQuota,
    );
    const created = await prisma.apiKey.create({
        data: {
            userId: input.userId,
            name: input.name,
            accessPackage: input.accessPackage,
            lookupId,
            keyPrefix: apiKey.slice(0, Math.min(apiKey.length, 18)),
            keyHash,
            scopes,
            dailyQuota,
            monthlyQuota,
            expiresAt: input.expiresAt ?? null,
        },
        select: {
            id: true,
            name: true,
            accessPackage: true,
            lookupId: true,
            keyPrefix: true,
            scopes: true,
            dailyQuota: true,
            monthlyQuota: true,
            createdAt: true,
            expiresAt: true,
        },
    });

    return {
        apiKey,
        preview: buildApiKeyPreview(apiKey),
        record: created,
    };
}

export async function getApiKeyQuotaSnapshot(
    apiKeyId: string,
    limits: Pick<ApiKey, 'dailyQuota' | 'monthlyQuota'>,
    now = new Date(),
): Promise<ApiKeyQuotaSnapshot> {
    const usageDate = startOfUtcDay(now);
    const monthStart = startOfUtcMonth(now);

    const [dailyUsage, monthlyUsage] = await Promise.all([
        prisma.apiKeyUsageDaily.aggregate({
            where: {
                apiKeyId,
                usageDate,
            },
            _sum: {
                requestCount: true,
            },
        }),
        prisma.apiKeyUsageDaily.aggregate({
            where: {
                apiKeyId,
                usageDate: {
                    gte: monthStart,
                    lte: usageDate,
                },
            },
            _sum: {
                requestCount: true,
            },
        }),
    ]);

    const dailyUsed = dailyUsage._sum.requestCount ?? 0;
    const monthlyUsed = monthlyUsage._sum.requestCount ?? 0;

    return {
        daily: {
            limit: limits.dailyQuota,
            used: dailyUsed,
            remaining: Math.max(0, limits.dailyQuota - dailyUsed),
        },
        monthly: {
            limit: limits.monthlyQuota,
            used: monthlyUsed,
            remaining: Math.max(0, limits.monthlyQuota - monthlyUsed),
        },
    };
}

export async function recordApiKeyUsage(args: {
    apiKeyId: string;
    routeKey: string;
    statusCode: number;
    ipAddress?: string | null;
    now?: Date;
}) {
    const now = args.now ?? new Date();
    const usageDate = startOfUtcDay(now);
    const succeeded = args.statusCode < 400;

    await prisma.$transaction([
        prisma.apiKey.update({
            where: { id: args.apiKeyId },
            data: {
                totalRequests: { increment: 1 },
                lastUsedAt: now,
                lastUsedIp: args.ipAddress ?? null,
            },
        }),
        prisma.apiKeyUsageDaily.upsert({
            where: {
                apiKeyId_usageDate_routeKey: {
                    apiKeyId: args.apiKeyId,
                    usageDate,
                    routeKey: args.routeKey,
                },
            },
            create: {
                apiKeyId: args.apiKeyId,
                usageDate,
                routeKey: args.routeKey,
                requestCount: 1,
                successCount: succeeded ? 1 : 0,
                errorCount: succeeded ? 0 : 1,
                lastRequestAt: now,
            },
            update: {
                requestCount: { increment: 1 },
                successCount: { increment: succeeded ? 1 : 0 },
                errorCount: { increment: succeeded ? 0 : 1 },
                lastRequestAt: now,
            },
        }),
    ]);
}

export async function loadApiKeyUsageSummaries(apiKeyIds: string[]) {
    if (apiKeyIds.length === 0) {
        return new Map<string, ApiKeyQuotaSnapshot>();
    }

    const now = new Date();
    const usageDate = startOfUtcDay(now);
    const monthStart = startOfUtcMonth(now);
    const [keys, dailyRows, monthlyRows] = await Promise.all([
        prisma.apiKey.findMany({
            where: {
                id: { in: apiKeyIds },
            },
            select: {
                id: true,
                dailyQuota: true,
                monthlyQuota: true,
            },
        }),
        prisma.apiKeyUsageDaily.groupBy({
            by: ['apiKeyId'],
            where: {
                apiKeyId: { in: apiKeyIds },
                usageDate,
            },
            _sum: {
                requestCount: true,
            },
        }),
        prisma.apiKeyUsageDaily.groupBy({
            by: ['apiKeyId'],
            where: {
                apiKeyId: { in: apiKeyIds },
                usageDate: {
                    gte: monthStart,
                    lte: usageDate,
                },
            },
            _sum: {
                requestCount: true,
            },
        }),
    ]);

    const dailyById = new Map(dailyRows.map((row) => [row.apiKeyId, row._sum.requestCount ?? 0]));
    const monthlyById = new Map(monthlyRows.map((row) => [row.apiKeyId, row._sum.requestCount ?? 0]));

    return new Map(
        keys.map((key) => [
            key.id,
            {
                daily: {
                    limit: key.dailyQuota,
                    used: dailyById.get(key.id) ?? 0,
                    remaining: Math.max(0, key.dailyQuota - (dailyById.get(key.id) ?? 0)),
                },
                monthly: {
                    limit: key.monthlyQuota,
                    used: monthlyById.get(key.id) ?? 0,
                    remaining: Math.max(0, key.monthlyQuota - (monthlyById.get(key.id) ?? 0)),
                },
            },
        ]),
    );
}

export type ApiKeyRecordForAuth = Prisma.ApiKeyGetPayload<{
    select: {
        id: true;
        userId: true;
        name: true;
        accessPackage: true;
        lookupId: true;
        keyHash: true;
        keyPrefix: true;
        status: true;
        scopes: true;
        dailyQuota: true;
        monthlyQuota: true;
        expiresAt: true;
        revokedAt: true;
    };
}>;
