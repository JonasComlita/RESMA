import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        apiKey: {
            create: vi.fn(),
            findMany: vi.fn(),
            findFirst: vi.fn(),
            update: vi.fn(),
        },
        apiKeyUsageDaily: {
            groupBy: vi.fn(),
        },
        user: {
            findUnique: vi.fn(),
            count: vi.fn(),
        },
        agencyReportPreset: {
            findMany: vi.fn(),
            count: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            findFirst: vi.fn(),
        },
        agencyReportRun: {
            create: vi.fn(),
            findMany: vi.fn(),
            findFirst: vi.fn(),
        },
        agencyReportShare: {
            count: vi.fn(),
            create: vi.fn(),
            findUnique: vi.fn(),
            update: vi.fn(),
            findFirst: vi.fn(),
        },
        agencyReportAuditEvent: {
            create: vi.fn(),
        },
        feedSnapshot: {
            count: vi.fn(),
        },
        feedItem: {
            count: vi.fn(),
        },
        creator: {
            count: vi.fn(),
        },
        $queryRaw: vi.fn(),
    },
}));

const { prisma } = await import('../src/lib/prisma.js');
const { default: app } = await import('../src/index');

function makeAuthToken(userId = 'user-1') {
    return jwt.sign({ userId }, config.jwt.secret);
}

describe('API key management routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates an API key and stores only the hashed secret material', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            id: 'user-1',
            accessPackage: 'AGENCY_PILOT',
        } as any);
        vi.mocked(prisma.apiKey.create).mockImplementation(async ({ data }: any) => ({
            id: 'api-key-1',
            name: data.name,
            accessPackage: data.accessPackage,
            lookupId: data.lookupId,
            keyPrefix: data.keyPrefix,
            scopes: data.scopes,
            dailyQuota: data.dailyQuota,
            monthlyQuota: data.monthlyQuota,
            createdAt: new Date('2026-04-24T18:00:00.000Z'),
            expiresAt: null,
        }));

        const response = await request(app)
            .post('/api-keys')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                name: 'LLM CLI',
                scopes: ['analysis:read'],
            });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data.secret).toMatch(/^resma_test\./);
        expect(response.body.data.apiKey.name).toBe('LLM CLI');
        expect(response.body.data.apiKey.accessPackage).toBe('AGENCY_PILOT');
        expect(prisma.apiKey.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                accessPackage: 'AGENCY_PILOT',
                keyHash: expect.any(String),
                lookupId: expect.any(String),
                scopes: ['analysis:read'],
            }),
        }));
        expect(vi.mocked(prisma.apiKey.create).mock.calls[0]?.[0]?.data.keyHash)
            .not.toBe(response.body.data.secret);
    });

    it('revokes an owned API key', async () => {
        vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
            id: 'c1846c7a-2ab2-4f59-b1a8-1554e16d4f53',
            status: 'ACTIVE',
        } as any);
        vi.mocked(prisma.apiKey.update).mockResolvedValue({
            id: 'c1846c7a-2ab2-4f59-b1a8-1554e16d4f53',
            status: 'REVOKED',
        } as any);

        const response = await request(app)
            .delete('/api-keys/c1846c7a-2ab2-4f59-b1a8-1554e16d4f53')
            .set('Authorization', `Bearer ${makeAuthToken()}`);

        expect(response.status).toBe(200);
        expect(response.body.data.revoked).toBe(true);
        expect(prisma.apiKey.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'c1846c7a-2ab2-4f59-b1a8-1554e16d4f53' },
            data: expect.objectContaining({
                status: 'REVOKED',
            }),
        }));
    });
});
