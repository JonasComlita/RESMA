import type { AccessPackage, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export const REPORT_FORMATS = ['json', 'llm', 'markdown', 'client-report'] as const;
export type ReportFormat = typeof REPORT_FORMATS[number];

export const FRESHNESS_TIERS = ['standard', 'priority', 'continuous'] as const;
export type FreshnessTier = typeof FRESHNESS_TIERS[number];

export const PROGRAMMATIC_ANALYSIS_ROUTE_KEYS = [
    'analysis.stats',
    'analysis.data-quality',
    'analysis.audience-forecast',
    'analysis.recommendation-map',
    'analysis.go-to-market-brief',
] as const;
export type ProgrammaticAnalysisRouteKey = typeof PROGRAMMATIC_ANALYSIS_ROUTE_KEYS[number];

export const REPORT_ROUTE_KEYS = [
    'reports.presets.read',
    'reports.presets.write',
    'reports.runs.read',
    'reports.runs.write',
    'reports.shares.write',
    'reports.shares.read',
    'reports.exports.read',
    'reports.client-delivery.read',
    'mcp.read',
] as const;
export type ReportRouteKey = typeof REPORT_ROUTE_KEYS[number];

export type AccessRouteKey = ProgrammaticAnalysisRouteKey | ReportRouteKey;

export const AGENCY_REPORT_TYPES = [
    'AUDIENCE_OPPORTUNITY_BRIEF',
    'COMPETITOR_REACH_SNAPSHOT',
    'RECOMMENDATION_GAP_REPORT',
] as const;
export type AgencyReportType = typeof AGENCY_REPORT_TYPES[number];

export interface PackageEntitlements {
    accessPackage: AccessPackage;
    label: string;
    allowedScopes: string[];
    allowedAnalysisRoutes: ProgrammaticAnalysisRouteKey[];
    allowedFormats: ReportFormat[];
    allowedExportFormats: ReportFormat[];
    allowedReportTypes: AgencyReportType[];
    allowedPlatforms: string[];
    allowedFreshnessTiers: FreshnessTier[];
    maxSavedPresets: number;
    maxTrackedVideoIds: number;
    maxShareLinksPerRun: number;
    defaultDailyQuota: number;
    defaultMonthlyQuota: number;
    canCreateShares: boolean;
    canUseMcp: boolean;
}

const ALL_PLATFORMS = ['youtube', 'instagram', 'twitter', 'tiktok'];

export const PACKAGE_ORDER: AccessPackage[] = [
    'CONTRIBUTOR_FREE',
    'CREATOR_PRO',
    'AGENCY_PILOT',
    'ENTERPRISE',
];

const PACKAGE_ENTITLEMENTS: Record<AccessPackage, PackageEntitlements> = {
    CONTRIBUTOR_FREE: {
        accessPackage: 'CONTRIBUTOR_FREE',
        label: 'Contributor Free',
        allowedScopes: ['analysis:read'],
        allowedAnalysisRoutes: ['analysis.stats'],
        allowedFormats: ['json', 'llm'],
        allowedExportFormats: ['json', 'llm'],
        allowedReportTypes: [],
        allowedPlatforms: ALL_PLATFORMS,
        allowedFreshnessTiers: ['standard'],
        maxSavedPresets: 0,
        maxTrackedVideoIds: 0,
        maxShareLinksPerRun: 0,
        defaultDailyQuota: 100,
        defaultMonthlyQuota: 1000,
        canCreateShares: false,
        canUseMcp: false,
    },
    CREATOR_PRO: {
        accessPackage: 'CREATOR_PRO',
        label: 'Creator Pro',
        allowedScopes: ['analysis:read'],
        allowedAnalysisRoutes: [
            'analysis.stats',
            'analysis.data-quality',
            'analysis.audience-forecast',
            'analysis.recommendation-map',
            'analysis.go-to-market-brief',
        ],
        allowedFormats: ['json', 'llm', 'markdown'],
        allowedExportFormats: ['json', 'llm', 'markdown'],
        allowedReportTypes: [],
        allowedPlatforms: ALL_PLATFORMS,
        allowedFreshnessTiers: ['standard'],
        maxSavedPresets: 0,
        maxTrackedVideoIds: 0,
        maxShareLinksPerRun: 0,
        defaultDailyQuota: 500,
        defaultMonthlyQuota: 10000,
        canCreateShares: false,
        canUseMcp: true,
    },
    AGENCY_PILOT: {
        accessPackage: 'AGENCY_PILOT',
        label: 'Agency Pilot',
        allowedScopes: ['analysis:read', 'reports:read'],
        allowedAnalysisRoutes: [
            'analysis.stats',
            'analysis.data-quality',
            'analysis.audience-forecast',
            'analysis.recommendation-map',
            'analysis.go-to-market-brief',
        ],
        allowedFormats: ['json', 'llm', 'markdown', 'client-report'],
        allowedExportFormats: ['json', 'llm', 'markdown', 'client-report'],
        allowedReportTypes: [
            'AUDIENCE_OPPORTUNITY_BRIEF',
            'COMPETITOR_REACH_SNAPSHOT',
            'RECOMMENDATION_GAP_REPORT',
        ],
        allowedPlatforms: ALL_PLATFORMS,
        allowedFreshnessTiers: ['standard', 'priority'],
        maxSavedPresets: 12,
        maxTrackedVideoIds: 8,
        maxShareLinksPerRun: 25,
        defaultDailyQuota: 1500,
        defaultMonthlyQuota: 25000,
        canCreateShares: true,
        canUseMcp: true,
    },
    ENTERPRISE: {
        accessPackage: 'ENTERPRISE',
        label: 'Enterprise',
        allowedScopes: ['analysis:read', 'reports:read'],
        allowedAnalysisRoutes: [
            'analysis.stats',
            'analysis.data-quality',
            'analysis.audience-forecast',
            'analysis.recommendation-map',
            'analysis.go-to-market-brief',
        ],
        allowedFormats: ['json', 'llm', 'markdown', 'client-report'],
        allowedExportFormats: ['json', 'llm', 'markdown', 'client-report'],
        allowedReportTypes: [
            'AUDIENCE_OPPORTUNITY_BRIEF',
            'COMPETITOR_REACH_SNAPSHOT',
            'RECOMMENDATION_GAP_REPORT',
        ],
        allowedPlatforms: ALL_PLATFORMS,
        allowedFreshnessTiers: ['standard', 'priority', 'continuous'],
        maxSavedPresets: 100,
        maxTrackedVideoIds: 50,
        maxShareLinksPerRun: 250,
        defaultDailyQuota: 10000,
        defaultMonthlyQuota: 250000,
        canCreateShares: true,
        canUseMcp: true,
    },
};

export function getPackageEntitlements(accessPackage: AccessPackage): PackageEntitlements {
    return PACKAGE_ENTITLEMENTS[accessPackage];
}

export function accessPackageIncludes(currentPackage: AccessPackage, requiredPackage: AccessPackage) {
    return PACKAGE_ORDER.indexOf(currentPackage) >= PACKAGE_ORDER.indexOf(requiredPackage);
}

export function normalizeReportFormat(rawValue: unknown): ReportFormat {
    if (typeof rawValue !== 'string') {
        return 'json';
    }

    const normalized = rawValue.trim().toLowerCase();
    return REPORT_FORMATS.includes(normalized as ReportFormat) ? normalized as ReportFormat : 'json';
}

export function normalizeFreshnessTier(rawValue: unknown): FreshnessTier {
    if (typeof rawValue !== 'string') {
        return 'standard';
    }

    const normalized = rawValue.trim().toLowerCase();
    return FRESHNESS_TIERS.includes(normalized as FreshnessTier) ? normalized as FreshnessTier : 'standard';
}

export function isAnalysisRouteAllowed(accessPackage: AccessPackage, routeKey: ProgrammaticAnalysisRouteKey) {
    return getPackageEntitlements(accessPackage).allowedAnalysisRoutes.includes(routeKey);
}

export function isReportRouteAllowed(accessPackage: AccessPackage, routeKey: ReportRouteKey) {
    const entitlements = getPackageEntitlements(accessPackage);

    if (routeKey === 'reports.presets.read' || routeKey === 'reports.runs.read' || routeKey === 'reports.exports.read') {
        return entitlements.maxSavedPresets > 0;
    }

    if (routeKey === 'reports.presets.write' || routeKey === 'reports.runs.write') {
        return entitlements.maxSavedPresets > 0;
    }

    if (routeKey === 'reports.shares.write' || routeKey === 'reports.shares.read' || routeKey === 'reports.client-delivery.read') {
        return entitlements.canCreateShares;
    }

    if (routeKey === 'mcp.read') {
        return entitlements.canUseMcp;
    }

    return false;
}

export function isAccessRouteAllowed(accessPackage: AccessPackage, routeKey: AccessRouteKey) {
    if (PROGRAMMATIC_ANALYSIS_ROUTE_KEYS.includes(routeKey as ProgrammaticAnalysisRouteKey)) {
        return isAnalysisRouteAllowed(accessPackage, routeKey as ProgrammaticAnalysisRouteKey);
    }

    return isReportRouteAllowed(accessPackage, routeKey as ReportRouteKey);
}

export function isFormatAllowed(accessPackage: AccessPackage, format: ReportFormat) {
    return getPackageEntitlements(accessPackage).allowedFormats.includes(format);
}

export function isExportFormatAllowed(accessPackage: AccessPackage, format: ReportFormat) {
    return getPackageEntitlements(accessPackage).allowedExportFormats.includes(format);
}

export function isReportTypeAllowed(accessPackage: AccessPackage, reportType: AgencyReportType) {
    return getPackageEntitlements(accessPackage).allowedReportTypes.includes(reportType);
}

export function isPlatformAllowed(accessPackage: AccessPackage, platform: string) {
    return getPackageEntitlements(accessPackage).allowedPlatforms.includes(platform);
}

export function isFreshnessTierAllowed(accessPackage: AccessPackage, freshnessTier: FreshnessTier) {
    return getPackageEntitlements(accessPackage).allowedFreshnessTiers.includes(freshnessTier);
}

export function packageMetadata(accessPackage: AccessPackage) {
    const entitlements = getPackageEntitlements(accessPackage);
    return {
        accessPackage: entitlements.accessPackage,
        label: entitlements.label,
        allowedFormats: entitlements.allowedFormats,
        allowedExportFormats: entitlements.allowedExportFormats,
        allowedReportTypes: entitlements.allowedReportTypes,
        allowedPlatforms: entitlements.allowedPlatforms,
        allowedFreshnessTiers: entitlements.allowedFreshnessTiers,
        maxSavedPresets: entitlements.maxSavedPresets,
        maxTrackedVideoIds: entitlements.maxTrackedVideoIds,
        maxShareLinksPerRun: entitlements.maxShareLinksPerRun,
        canCreateShares: entitlements.canCreateShares,
        canUseMcp: entitlements.canUseMcp,
    };
}

export async function loadUserAccessPackage(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            accessPackage: true,
        },
    });

    if (!user) {
        return null;
    }

    return {
        userId: user.id,
        accessPackage: user.accessPackage,
        entitlements: getPackageEntitlements(user.accessPackage),
    };
}

export function defaultAccessPackageForUser(user: Pick<User, 'accessPackage' | 'subscriptionTier' | 'userType'>): AccessPackage {
    if (user.accessPackage) {
        return user.accessPackage;
    }

    if (user.subscriptionTier === 'PREMIUM') {
        return 'CREATOR_PRO';
    }

    return 'CONTRIBUTOR_FREE';
}
