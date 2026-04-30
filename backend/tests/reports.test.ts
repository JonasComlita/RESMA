import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        user: {
            findUnique: vi.fn(),
            count: vi.fn(),
        },
        agencyReportPreset: {
            findMany: vi.fn(),
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

vi.mock('../src/services/agencyReports.js', async () => {
    const actual = await vi.importActual<typeof import('../src/services/agencyReports.js')>('../src/services/agencyReports.js');
    return {
        ...actual,
        createAgencyReportPreset: vi.fn(),
        listAgencyReportPresetsForUser: vi.fn(),
        loadAgencyReportRunForUser: vi.fn(),
        createAgencyReportShare: vi.fn(),
        resolveAgencyReportShare: vi.fn(),
        serializeStoredAgencyReport: vi.fn(),
        markAgencyReportExportAccess: vi.fn(),
        markAgencyReportShareViewed: vi.fn(),
    };
});

const { prisma } = await import('../src/lib/prisma.js');
const {
    createAgencyReportPreset,
    listAgencyReportPresetsForUser,
    resolveAgencyReportShare,
    serializeStoredAgencyReport,
    markAgencyReportExportAccess,
    markAgencyReportShareViewed,
} = await import('../src/services/agencyReports.js');
const { default: app } = await import('../src/index');

function makeAuthToken(userId = 'user-1') {
    return jwt.sign({ userId }, config.jwt.secret);
}

describe('Agency report routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.user.findUnique).mockResolvedValue({
            id: 'user-1',
            accessPackage: 'AGENCY_PILOT',
        } as any);
    });

    it('creates saved report presets within the caller package', async () => {
        vi.mocked(createAgencyReportPreset).mockResolvedValue({
            id: 'preset-1',
            name: 'Weekly audience brief',
            reportType: 'AUDIENCE_OPPORTUNITY_BRIEF',
            accessPackage: 'AGENCY_PILOT',
            platform: 'youtube',
            reportConfig: {
                platform: 'youtube',
                targetVideoId: 'target-1',
            },
            freshnessTier: 'priority',
            allowedExportFormats: ['json', 'llm', 'markdown', 'client-report'],
            lastRunAt: null,
            createdAt: new Date('2026-04-24T21:00:00.000Z'),
            updatedAt: new Date('2026-04-24T21:00:00.000Z'),
        } as any);

        const response = await request(app)
            .post('/reports/presets')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                name: 'Weekly audience brief',
                reportType: 'AUDIENCE_OPPORTUNITY_BRIEF',
                reportConfig: {
                    platform: 'youtube',
                    targetVideoId: 'target-1',
                    freshnessTier: 'priority',
                },
                allowedExportFormats: ['json', 'client-report'],
            });

        expect(response.status).toBe(201);
        expect(response.body.data.preset.reportType).toBe('AUDIENCE_OPPORTUNITY_BRIEF');
        expect(response.body.data.packageAccess.accessPackage).toBe('AGENCY_PILOT');
        expect(createAgencyReportPreset).toHaveBeenCalledWith(expect.objectContaining({
            accessPackage: 'AGENCY_PILOT',
            reportType: 'AUDIENCE_OPPORTUNITY_BRIEF',
        }));
    });

    it('serves shared reports as read-only curated exports', async () => {
        vi.mocked(resolveAgencyReportShare).mockResolvedValue({
            id: 'share-1',
            tokenPrefix: 'resma_share_123',
            description: 'Client delivery',
            expiresAt: null,
            status: 'ACTIVE',
            reportRun: {
                id: 'run-1',
                accessPackage: 'AGENCY_PILOT',
                availableExportFormats: ['json', 'client-report'],
                resultPayload: {
                    title: 'Audience Opportunity Brief',
                    exports: {
                        clientReport: {
                            title: 'Audience Opportunity Brief',
                        },
                    },
                },
            },
        } as any);
        vi.mocked(serializeStoredAgencyReport).mockReturnValue({
            format: 'client-report',
            content: {
                title: 'Audience Opportunity Brief',
                privacyMode: 'aggregate-only',
            },
        } as any);

        const response = await request(app)
            .get('/shared-reports/resma_share_example?format=client-report');

        expect(response.status).toBe(200);
        expect(response.body.meta.shareMode).toBe('read-only');
        expect(response.body.data.export.content.privacyMode).toBe('aggregate-only');
        expect(markAgencyReportShareViewed).toHaveBeenCalledWith({
            shareId: 'share-1',
            reportRunId: 'run-1',
        });
        expect(markAgencyReportExportAccess).toHaveBeenCalledWith(expect.objectContaining({
            reportRunId: 'run-1',
            reportShareId: 'share-1',
            format: 'client-report',
        }));
    });
    it('handles errors on GET /reports/packages/me', async () => {
        vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Database error'));

        const response = await request(app)
            .get('/reports/packages/me')
            .set('Authorization', `Bearer ${makeAuthToken()}`);

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Internal server error');
    });

    it('handles errors on GET /reports/presets', async () => {
        vi.mocked(listAgencyReportPresetsForUser).mockRejectedValue(new Error('Preset loading error'));

        const response = await request(app)
            .get('/reports/presets')
            .set('Authorization', `Bearer ${makeAuthToken()}`);

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Internal server error');
    });
});
