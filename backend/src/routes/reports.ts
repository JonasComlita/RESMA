import { Router } from 'express';
import { body, param, query } from 'express-validator';
import type { AccessPackage } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/authenticate.js';
import { createError } from '../middleware/errorHandler.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
    AgencyReportInputError,
    createAgencyReportPreset,
    createAgencyReportShare,
    ensureStoredPayload,
    listAgencyReportPresetsForUser,
    listAgencyReportRunsForUser,
    loadAgencyReportRunForUser,
    markAgencyReportExportAccess,
    markAgencyReportShareViewed,
    resolveAgencyReportShare,
    revokeAgencyReportShare,
    runAgencyReportPreset,
    serializeStoredAgencyReport,
    summarizeStoredAgencyReport,
} from '../services/agencyReports.js';
import {
    AGENCY_REPORT_TYPES,
    REPORT_FORMATS,
    isExportFormatAllowed,
    normalizeReportFormat,
    packageMetadata,
    type AgencyReportType,
} from '../services/packageAccess.js';

export const reportsRouter: Router = Router();
export const sharedReportsRouter: Router = Router();

const reportFormatValidation = query('format')
    .optional()
    .isIn(Array.from(REPORT_FORMATS))
    .withMessage(`format must be one of ${REPORT_FORMATS.join(', ')}`);

async function loadAuthenticatedUserAccessPackage(userId: string | undefined) {
    if (!userId) {
        throw createError('Authorization token required', 401);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            accessPackage: true,
        },
    });

    if (!user) {
        throw createError('User not found', 404);
    }

    return user;
}

function serializePreset(preset: {
    id: string;
    name: string;
    reportType: string;
    accessPackage: AccessPackage;
    platform: string;
    reportConfig: unknown;
    freshnessTier: string;
    allowedExportFormats: string[];
    lastRunAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: preset.id,
        name: preset.name,
        reportType: preset.reportType,
        accessPackage: preset.accessPackage,
        platform: preset.platform,
        freshnessTier: preset.freshnessTier,
        allowedExportFormats: preset.allowedExportFormats,
        reportConfig: preset.reportConfig,
        lastRunAt: preset.lastRunAt,
        createdAt: preset.createdAt,
        updatedAt: preset.updatedAt,
    };
}

function serializeRun(run: Awaited<ReturnType<typeof loadAgencyReportRunForUser>>) {
    if (!run) {
        return null;
    }

    const payload = ensureStoredPayload(run.resultPayload);
    return {
        id: run.id,
        presetId: run.presetId,
        reportType: run.reportType,
        accessPackage: run.accessPackage,
        platform: run.platform,
        reportTitle: run.reportTitle,
        freshnessTier: run.freshnessTier,
        availableExportFormats: run.availableExportFormats,
        qualityGateStatus: run.qualityGateStatus,
        watermarkKey: run.watermarkKey,
        latestDataAt: run.latestDataAt,
        generatedAt: run.generatedAt,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        preview: summarizeStoredAgencyReport(payload),
        storedPayload: payload,
        shares: run.shares.map((share) => ({
            id: share.id,
            tokenPrefix: share.tokenPrefix,
            description: share.description,
            expiresAt: share.expiresAt,
            lastAccessedAt: share.lastAccessedAt,
            status: share.status,
            createdAt: share.createdAt,
            revokedAt: share.revokedAt,
        })),
    };
}

reportsRouter.use(authenticate);

reportsRouter.get('/packages/me', async (req: AuthRequest, res, next) => {
    try {
        const user = await loadAuthenticatedUserAccessPackage(req.userId);
        res.json({
            success: true,
            data: {
                packageAccess: packageMetadata(user.accessPackage),
            },
        });
    } catch (error) {
        next(error);
    }
});

reportsRouter.get('/presets', async (req: AuthRequest, res, next) => {
    try {
        const user = await loadAuthenticatedUserAccessPackage(req.userId);
        const presets = await listAgencyReportPresetsForUser(user.id);

        res.json({
            success: true,
            data: {
                presets: presets.map(serializePreset),
                packageAccess: packageMetadata(user.accessPackage),
            },
        });
    } catch (error) {
        next(error);
    }
});

reportsRouter.post(
    '/presets',
    ...validateRequest([
        body('name')
            .trim()
            .isLength({ min: 3, max: 120 })
            .withMessage('name must be between 3 and 120 characters'),
        body('reportType')
            .isIn(Array.from(AGENCY_REPORT_TYPES))
            .withMessage(`reportType must be one of ${AGENCY_REPORT_TYPES.join(', ')}`),
        body('reportConfig')
            .custom((value) => value && typeof value === 'object' && !Array.isArray(value))
            .withMessage('reportConfig must be an object'),
        body('allowedExportFormats')
            .optional()
            .isArray({ min: 1 })
            .withMessage('allowedExportFormats must be a non-empty array'),
        body('allowedExportFormats.*')
            .optional()
            .isIn(Array.from(REPORT_FORMATS))
            .withMessage(`allowedExportFormats entries must be one of ${REPORT_FORMATS.join(', ')}`),
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const user = await loadAuthenticatedUserAccessPackage(req.userId);
            const preset = await createAgencyReportPreset({
                userId: user.id,
                accessPackage: user.accessPackage,
                name: String(req.body.name).trim(),
                reportType: String(req.body.reportType).trim().toUpperCase() as AgencyReportType,
                reportConfig: req.body.reportConfig,
                allowedExportFormats: req.body.allowedExportFormats,
            });

            res.status(201).json({
                success: true,
                data: {
                    preset: serializePreset(preset),
                    packageAccess: packageMetadata(user.accessPackage),
                },
            });
        } catch (error) {
            if (error instanceof AgencyReportInputError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    details: error.details,
                });
            }

            next(error);
        }
    },
);

reportsRouter.post(
    '/presets/:presetId/run',
    ...validateRequest([
        param('presetId')
            .isUUID()
            .withMessage('presetId must be a valid UUID'),
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const user = await loadAuthenticatedUserAccessPackage(req.userId);
            const reportRun = await runAgencyReportPreset({
                presetId: req.params.presetId,
                userId: user.id,
                accessPackage: user.accessPackage,
            });
            const hydrated = await loadAgencyReportRunForUser(reportRun.id, user.id);

            res.status(201).json({
                success: true,
                data: {
                    run: serializeRun(hydrated),
                    packageAccess: packageMetadata(user.accessPackage),
                },
            });
        } catch (error) {
            if (error instanceof AgencyReportInputError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    details: error.details,
                });
            }

            next(error);
        }
    },
);

reportsRouter.get('/runs', async (req: AuthRequest, res, next) => {
    try {
        const user = await loadAuthenticatedUserAccessPackage(req.userId);
        const runs = await listAgencyReportRunsForUser(user.id);

        res.json({
            success: true,
            data: {
                runs,
                packageAccess: packageMetadata(user.accessPackage),
            },
        });
    } catch (error) {
        next(error);
    }
});

reportsRouter.get(
    '/runs/:reportRunId',
    ...validateRequest([
        param('reportRunId')
            .isUUID()
            .withMessage('reportRunId must be a valid UUID'),
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const user = await loadAuthenticatedUserAccessPackage(req.userId);
            const run = await loadAgencyReportRunForUser(req.params.reportRunId, user.id);

            if (!run) {
                return next(createError('Report run not found', 404));
            }

            res.json({
                success: true,
                data: {
                    run: serializeRun(run),
                    packageAccess: packageMetadata(user.accessPackage),
                },
            });
        } catch (error) {
            next(error);
        }
    },
);

reportsRouter.get(
    '/runs/:reportRunId/export',
    ...validateRequest([
        param('reportRunId')
            .isUUID()
            .withMessage('reportRunId must be a valid UUID'),
        reportFormatValidation,
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const user = await loadAuthenticatedUserAccessPackage(req.userId);
            const run = await loadAgencyReportRunForUser(req.params.reportRunId, user.id);

            if (!run) {
                return next(createError('Report run not found', 404));
            }

            const format = normalizeReportFormat(req.query.format ?? 'json');
            if (!run.availableExportFormats.includes(format) || !isExportFormatAllowed(user.accessPackage, format)) {
                return next(createError(`Package ${user.accessPackage} does not allow ${format} export`, 403));
            }

            const payload = ensureStoredPayload(run.resultPayload);
            await markAgencyReportExportAccess({
                userId: user.id,
                reportRunId: run.id,
                format,
            });

            res.json({
                success: true,
                data: {
                    reportRunId: run.id,
                    export: serializeStoredAgencyReport(payload, format),
                    packageAccess: packageMetadata(user.accessPackage),
                },
            });
        } catch (error) {
            next(error);
        }
    },
);

reportsRouter.post(
    '/runs/:reportRunId/shares',
    ...validateRequest([
        param('reportRunId')
            .isUUID()
            .withMessage('reportRunId must be a valid UUID'),
        body('description')
            .optional()
            .isString()
            .isLength({ min: 1, max: 160 })
            .withMessage('description must be between 1 and 160 characters'),
        body('expiresAt')
            .optional()
            .isISO8601()
            .withMessage('expiresAt must be a valid ISO-8601 datetime'),
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const user = await loadAuthenticatedUserAccessPackage(req.userId);
            const run = await loadAgencyReportRunForUser(req.params.reportRunId, user.id);

            if (!run) {
                return next(createError('Report run not found', 404));
            }

            const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
            if (expiresAt && expiresAt <= new Date()) {
                return next(createError('expiresAt must be in the future', 400));
            }

            const { share, token } = await createAgencyReportShare({
                reportRunId: run.id,
                userId: user.id,
                accessPackage: user.accessPackage,
                description: typeof req.body.description === 'string' ? req.body.description.trim() : undefined,
                expiresAt,
            });

            res.status(201).json({
                success: true,
                data: {
                    share: {
                        id: share.id,
                        tokenPrefix: share.tokenPrefix,
                        description: share.description,
                        expiresAt: share.expiresAt,
                        status: share.status,
                        createdAt: share.createdAt,
                        shareUrl: `/shared-reports/${token}`,
                    },
                    shareToken: token,
                    packageAccess: packageMetadata(user.accessPackage),
                },
            });
        } catch (error) {
            if (error instanceof AgencyReportInputError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    details: error.details,
                });
            }

            next(error);
        }
    },
);

reportsRouter.get(
    '/runs/:reportRunId/shares',
    ...validateRequest([
        param('reportRunId')
            .isUUID()
            .withMessage('reportRunId must be a valid UUID'),
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const user = await loadAuthenticatedUserAccessPackage(req.userId);
            const run = await loadAgencyReportRunForUser(req.params.reportRunId, user.id);

            if (!run) {
                return next(createError('Report run not found', 404));
            }

            res.json({
                success: true,
                data: {
                    shares: run.shares.map((share) => ({
                        id: share.id,
                        tokenPrefix: share.tokenPrefix,
                        description: share.description,
                        expiresAt: share.expiresAt,
                        lastAccessedAt: share.lastAccessedAt,
                        status: share.status,
                        createdAt: share.createdAt,
                        revokedAt: share.revokedAt,
                    })),
                    packageAccess: packageMetadata(user.accessPackage),
                },
            });
        } catch (error) {
            next(error);
        }
    },
);

reportsRouter.delete(
    '/shares/:shareId',
    ...validateRequest([
        param('shareId')
            .isUUID()
            .withMessage('shareId must be a valid UUID'),
    ]),
    async (req: AuthRequest, res, next) => {
        try {
            const user = await loadAuthenticatedUserAccessPackage(req.userId);
            const share = await revokeAgencyReportShare({
                shareId: req.params.shareId,
                userId: user.id,
            });

            res.json({
                success: true,
                data: {
                    share: {
                        id: share.id,
                        status: share.status,
                        revokedAt: share.revokedAt,
                    },
                },
            });
        } catch (error) {
            if (error instanceof AgencyReportInputError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    details: error.details,
                });
            }

            next(error);
        }
    },
);

sharedReportsRouter.get(
    '/:shareToken',
    ...validateRequest([
        param('shareToken')
            .isString()
            .isLength({ min: 12 })
            .withMessage('shareToken is invalid'),
        reportFormatValidation,
    ]),
    async (req, res, next) => {
        try {
            const share = await resolveAgencyReportShare(req.params.shareToken);

            if (!share || share.status !== 'ACTIVE') {
                return next(createError('Shared report not found', 404));
            }

            if (share.expiresAt && share.expiresAt <= new Date()) {
                return next(createError('Shared report has expired', 410));
            }

            const payload = ensureStoredPayload(share.reportRun.resultPayload);
            const format = req.query.format
                ? normalizeReportFormat(req.query.format)
                : 'client-report';
            const allowedByRun = share.reportRun.availableExportFormats.includes(format);
            const allowedByPackage = isExportFormatAllowed(share.reportRun.accessPackage, format);
            if (!allowedByRun || !allowedByPackage) {
                return next(createError(`Shared report does not allow ${format} export`, 403));
            }

            await Promise.all([
                markAgencyReportShareViewed({
                    shareId: share.id,
                    reportRunId: share.reportRun.id,
                }),
                markAgencyReportExportAccess({
                    reportRunId: share.reportRun.id,
                    reportShareId: share.id,
                    format,
                }),
            ]);

            res.json({
                success: true,
                data: {
                    reportRunId: share.reportRun.id,
                    share: {
                        id: share.id,
                        tokenPrefix: share.tokenPrefix,
                        description: share.description,
                        expiresAt: share.expiresAt,
                    },
                    export: serializeStoredAgencyReport(payload, format),
                    packageAccess: packageMetadata(share.reportRun.accessPackage),
                },
                meta: {
                    privacyMode: 'aggregate-only',
                    shareMode: 'read-only',
                },
            });
        } catch (error) {
            next(error);
        }
    },
);
