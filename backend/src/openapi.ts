import { config } from './config.js';

const analysisFormatParameter = {
    name: 'format',
    in: 'query',
    schema: {
        type: 'string',
        enum: ['json', 'llm', 'markdown', 'client-report'],
        default: 'json',
    },
    description: 'Preferred response/export shape. Availability is package-dependent.',
} as const;

const platformParameter = {
    name: 'platform',
    in: 'query',
    schema: {
        type: 'string',
        enum: ['youtube', 'instagram', 'twitter', 'tiktok'],
        default: 'youtube',
    },
} as const;

export function buildOpenApiDocument() {
    return {
        openapi: '3.1.0',
        info: {
            title: 'RESMA Programmatic and Agency Report API',
            version: '0.2.0',
            summary: 'Stable aggregate-only machine surface for analysis, agency report delivery, and AI workflows.',
            description: [
                'RESMA exposes aggregate-only observatory intelligence for AI clients, agency operators, and premium programmatic consumers.',
                'The API is a delivery channel for package-gated aggregate intelligence, not a raw contributor-data surface.',
                'Contributor-level feeds, per-user traces, and raw audience exports are intentionally excluded.',
            ].join(' '),
        },
        servers: [
            {
                url: config.api.publicBaseUrl,
                description: config.nodeEnv === 'production' ? 'Production API server' : 'Local development server',
            },
        ],
        tags: [
            { name: 'Docs', description: 'Machine-readable API discovery' },
            { name: 'API Keys', description: 'JWT-authenticated API key management and package-aware provisioning' },
            { name: 'Programmatic Analysis', description: 'Aggregate-only AI and machine analysis endpoints' },
            { name: 'Agency Reports', description: 'JWT-authenticated white-glove report preset, run, export, and share workflows' },
            { name: 'Shared Reports', description: 'Read-only share links for aggregate client-facing report delivery' },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
                apiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-api-key',
                    description: 'Programmatic API key. `Authorization: Bearer <api-key>` is also accepted.',
                },
            },
            parameters: {
                format: analysisFormatParameter,
                platform: platformParameter,
            },
            schemas: {
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', const: false },
                        error: { type: 'string' },
                        details: { type: ['object', 'null'], additionalProperties: true },
                    },
                    required: ['success', 'error'],
                },
                PackageAccess: {
                    type: 'object',
                    properties: {
                        accessPackage: {
                            type: 'string',
                            enum: ['CONTRIBUTOR_FREE', 'CREATOR_PRO', 'AGENCY_PILOT', 'ENTERPRISE'],
                        },
                        label: { type: 'string' },
                        allowedFormats: { type: 'array', items: { type: 'string' } },
                        allowedExportFormats: { type: 'array', items: { type: 'string' } },
                        allowedReportTypes: { type: 'array', items: { type: 'string' } },
                        allowedPlatforms: { type: 'array', items: { type: 'string' } },
                        allowedFreshnessTiers: { type: 'array', items: { type: 'string' } },
                        maxSavedPresets: { type: 'integer' },
                        maxTrackedVideoIds: { type: 'integer' },
                        maxShareLinksPerRun: { type: 'integer' },
                        canCreateShares: { type: 'boolean' },
                        canUseMcp: { type: 'boolean' },
                    },
                    required: ['accessPackage', 'label'],
                    additionalProperties: true,
                },
                SuccessEnvelope: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', const: true },
                        data: { type: 'object', additionalProperties: true },
                        meta: { type: 'object', additionalProperties: true },
                        format: { type: 'string', enum: ['llm', 'markdown', 'client-report'] },
                        llm: {
                            type: 'object',
                            properties: {
                                kind: { type: 'string' },
                                title: { type: 'string' },
                                bullets: { type: 'array', items: { type: 'string' } },
                                markdown: { type: 'string' },
                                followUpQuestions: { type: 'array', items: { type: 'string' } },
                                caveats: { type: 'array', items: { type: 'string' } },
                            },
                            additionalProperties: false,
                        },
                        export: {
                            type: 'object',
                            properties: {
                                format: { type: 'string' },
                                content: {
                                    oneOf: [
                                        { type: 'string' },
                                        { type: 'object', additionalProperties: true },
                                    ],
                                },
                            },
                            additionalProperties: true,
                        },
                    },
                    required: ['success', 'data'],
                    additionalProperties: true,
                },
            },
        },
        paths: {
            '/docs/openapi.json': {
                get: {
                    tags: ['Docs'],
                    summary: 'Get the RESMA OpenAPI document',
                    operationId: 'getOpenApiDocument',
                    responses: {
                        '200': {
                            description: 'OpenAPI document',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        additionalProperties: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/api-keys': {
                get: {
                    tags: ['API Keys'],
                    summary: 'List API keys for the authenticated user',
                    operationId: 'listApiKeys',
                    security: [{ bearerAuth: [] }],
                    responses: {
                        '200': {
                            description: 'Current API keys and quota snapshots',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                        '401': {
                            description: 'Missing or invalid JWT',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
                post: {
                    tags: ['API Keys'],
                    summary: 'Create a new API key scoped to the caller package',
                    operationId: 'createApiKey',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string', minLength: 3, maxLength: 80 },
                                        scopes: { type: 'array', items: { type: 'string' } },
                                        dailyQuota: { type: 'integer', minimum: 1 },
                                        monthlyQuota: { type: 'integer', minimum: 1 },
                                        expiresAt: { type: 'string', format: 'date-time' },
                                    },
                                    required: ['name'],
                                },
                            },
                        },
                    },
                    responses: {
                        '201': {
                            description: 'API key created. Secret is returned once.',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                        '400': {
                            description: 'Validation error',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
            },
            '/api-keys/{apiKeyId}': {
                delete: {
                    tags: ['API Keys'],
                    summary: 'Revoke an API key',
                    operationId: 'revokeApiKey',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'apiKeyId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                        },
                    ],
                    responses: {
                        '200': {
                            description: 'Key revoked',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                        '404': {
                            description: 'Key not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
            },
            '/reports/packages/me': {
                get: {
                    tags: ['Agency Reports'],
                    summary: 'Get the authenticated user package entitlements',
                    operationId: 'getReportPackageAccess',
                    security: [{ bearerAuth: [] }],
                    responses: {
                        '200': {
                            description: 'Package access metadata',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
            },
            '/reports/presets': {
                get: {
                    tags: ['Agency Reports'],
                    summary: 'List saved agency report presets',
                    operationId: 'listAgencyReportPresets',
                    security: [{ bearerAuth: [] }],
                    responses: {
                        '200': {
                            description: 'Saved presets',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
                post: {
                    tags: ['Agency Reports'],
                    summary: 'Create an agency report preset',
                    operationId: 'createAgencyReportPreset',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string', minLength: 3, maxLength: 120 },
                                        reportType: {
                                            type: 'string',
                                            enum: ['AUDIENCE_OPPORTUNITY_BRIEF', 'COMPETITOR_REACH_SNAPSHOT', 'RECOMMENDATION_GAP_REPORT'],
                                        },
                                        reportConfig: { type: 'object', additionalProperties: true },
                                        allowedExportFormats: {
                                            type: 'array',
                                            items: { type: 'string', enum: ['json', 'llm', 'markdown', 'client-report'] },
                                        },
                                    },
                                    required: ['name', 'reportType', 'reportConfig'],
                                },
                            },
                        },
                    },
                    responses: {
                        '201': {
                            description: 'Preset created',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
            },
            '/reports/presets/{presetId}/run': {
                post: {
                    tags: ['Agency Reports'],
                    summary: 'Generate a reproducible report run from a preset',
                    operationId: 'runAgencyReportPreset',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'presetId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                        },
                    ],
                    responses: {
                        '201': {
                            description: 'Report run created',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
            },
            '/reports/runs': {
                get: {
                    tags: ['Agency Reports'],
                    summary: 'List generated report runs',
                    operationId: 'listAgencyReportRuns',
                    security: [{ bearerAuth: [] }],
                    responses: {
                        '200': {
                            description: 'Report runs',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
            },
            '/reports/runs/{reportRunId}': {
                get: {
                    tags: ['Agency Reports'],
                    summary: 'Get a stored report run with operator payload',
                    operationId: 'getAgencyReportRun',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'reportRunId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                        },
                    ],
                    responses: {
                        '200': {
                            description: 'Report run',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
            },
            '/reports/runs/{reportRunId}/export': {
                get: {
                    tags: ['Agency Reports'],
                    summary: 'Export a stored report run in a package-allowed format',
                    operationId: 'exportAgencyReportRun',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'reportRunId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                        },
                        { $ref: '#/components/parameters/format' },
                    ],
                    responses: {
                        '200': {
                            description: 'Curated aggregate report export',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
            },
            '/reports/runs/{reportRunId}/shares': {
                get: {
                    tags: ['Agency Reports'],
                    summary: 'List active share links for a report run',
                    operationId: 'listAgencyReportShares',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'reportRunId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                        },
                    ],
                    responses: {
                        '200': {
                            description: 'Active share links',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
                post: {
                    tags: ['Agency Reports'],
                    summary: 'Create a read-only shared report link',
                    operationId: 'createAgencyReportShare',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'reportRunId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                        },
                    ],
                    requestBody: {
                        required: false,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        description: { type: 'string', maxLength: 160 },
                                        expiresAt: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '201': {
                            description: 'Share link created',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
            },
            '/reports/shares/{shareId}': {
                delete: {
                    tags: ['Agency Reports'],
                    summary: 'Revoke a share link',
                    operationId: 'revokeAgencyReportShare',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'shareId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                        },
                    ],
                    responses: {
                        '200': {
                            description: 'Share revoked',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                    },
                },
            },
            '/shared-reports/{shareToken}': {
                get: {
                    tags: ['Shared Reports'],
                    summary: 'Read a shared aggregate report export',
                    operationId: 'getSharedAgencyReport',
                    parameters: [
                        {
                            name: 'shareToken',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                        { $ref: '#/components/parameters/format' },
                    ],
                    responses: {
                        '200': {
                            description: 'Shared read-only report export',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/SuccessEnvelope' },
                                },
                            },
                        },
                        '404': {
                            description: 'Shared report not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
            },
            '/api/v1/analysis/audience-forecast': {
                get: {
                    tags: ['Programmatic Analysis'],
                    summary: 'Generate an aggregate-only audience forecast',
                    operationId: 'getAudienceForecast',
                    security: [{ apiKeyAuth: [] }],
                    parameters: [
                        { name: 'targetVideoId', in: 'query', required: true, schema: { type: 'string' } },
                        { name: 'seedVideoId', in: 'query', required: false, schema: { type: 'string' } },
                        { $ref: '#/components/parameters/platform' },
                        { name: 'maxDepth', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 6, default: 3 } },
                        { name: 'beamWidth', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 120, default: 30 } },
                        { $ref: '#/components/parameters/format' },
                    ],
                    responses: {
                        '200': { description: 'Audience forecast', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } },
                        '401': { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
                        '403': { description: 'Package or scope does not allow this route', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
                        '429': { description: 'API key quota exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
                    },
                },
            },
            '/api/v1/analysis/recommendation-map': {
                get: {
                    tags: ['Programmatic Analysis'],
                    summary: 'Build a machine-consumable recommendation map',
                    operationId: 'getRecommendationMap',
                    security: [{ apiKeyAuth: [] }],
                    parameters: [
                        { name: 'seedVideoId', in: 'query', required: true, schema: { type: 'string' } },
                        { $ref: '#/components/parameters/platform' },
                        { name: 'maxDepth', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 8, default: 3 } },
                        { name: 'maxNodes', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 300, default: 40 } },
                        { name: 'cohortId', in: 'query', required: false, schema: { type: 'string' } },
                        { $ref: '#/components/parameters/format' },
                    ],
                    responses: {
                        '200': { description: 'Recommendation map', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } },
                    },
                },
            },
            '/api/v1/analysis/go-to-market-brief': {
                get: {
                    tags: ['Programmatic Analysis'],
                    summary: 'Generate a cohort-level go-to-market brief',
                    operationId: 'getGoToMarketBrief',
                    security: [{ apiKeyAuth: [] }],
                    parameters: [
                        { name: 'targetVideoId', in: 'query', required: true, schema: { type: 'string' } },
                        { name: 'seedVideoId', in: 'query', required: false, schema: { type: 'string' } },
                        { $ref: '#/components/parameters/platform' },
                        { name: 'maxDepth', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 6, default: 3 } },
                        { name: 'beamWidth', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 120, default: 30 } },
                        { name: 'topCohorts', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 12, default: 5 } },
                        { name: 'maxPathsPerCohort', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10, default: 3 } },
                        { name: 'pathBranchLimit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 25, default: 6 } },
                        { $ref: '#/components/parameters/format' },
                    ],
                    responses: {
                        '200': { description: 'Go-to-market brief', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } },
                    },
                },
            },
            '/api/v1/analysis/data-quality': {
                get: {
                    tags: ['Programmatic Analysis'],
                    summary: 'Inspect aggregate recommendation-data quality',
                    operationId: 'getDataQualityDiagnostics',
                    security: [{ apiKeyAuth: [] }],
                    parameters: [
                        { $ref: '#/components/parameters/platform' },
                        { name: 'windowHours', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 4320, default: 336 } },
                        { $ref: '#/components/parameters/format' },
                    ],
                    responses: {
                        '200': { description: 'Data quality diagnostics', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } },
                    },
                },
            },
            '/api/v1/analysis/stats': {
                get: {
                    tags: ['Programmatic Analysis'],
                    summary: 'Return aggregate observatory counts',
                    operationId: 'getObservatoryStats',
                    security: [{ apiKeyAuth: [] }],
                    parameters: [{ $ref: '#/components/parameters/format' }],
                    responses: {
                        '200': { description: 'Observatory stats', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } },
                    },
                },
            },
            '/api/v1/reports/runs/{reportRunId}/export': {
                get: {
                    tags: ['Programmatic Analysis'],
                    summary: 'Read a saved report export through an API key',
                    operationId: 'getProgrammaticAgencyReportExport',
                    security: [{ apiKeyAuth: [] }],
                    parameters: [
                        {
                            name: 'reportRunId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                        },
                        { $ref: '#/components/parameters/format' },
                    ],
                    responses: {
                        '200': { description: 'Programmatic aggregate report export', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } },
                        '403': { description: 'Package or scope does not allow report export', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
                    },
                },
            },
        },
    } as const;
}
