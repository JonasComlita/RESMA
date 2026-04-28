import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const RESMA_API_BASE_URL = process.env.RESMA_API_BASE_URL || 'http://localhost:3001';
const RESMA_API_KEY = process.env.RESMA_API_KEY;

type ToolResultPayload = {
    success: boolean;
    data?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    llm?: {
        title?: string;
        bullets?: string[];
        markdown?: string;
        followUpQuestions?: string[];
        caveats?: string[];
    };
    error?: string;
    details?: Record<string, unknown>;
};

function buildQuery(params: Record<string, unknown>) {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') {
            continue;
        }

        search.set(key, String(value));
    }

    const query = search.toString();
    return query.length > 0 ? `?${query}` : '';
}

async function callResma(pathname: string, query: Record<string, unknown>) {
    if (!RESMA_API_KEY) {
        throw new Error('RESMA_API_KEY is required to use the RESMA MCP server');
    }

    const response = await fetch(`${RESMA_API_BASE_URL}${pathname}${buildQuery(query)}`, {
        headers: {
            'x-api-key': RESMA_API_KEY,
            'accept': 'application/json',
        },
    });

    const payload = await response.json() as ToolResultPayload;
    if (!response.ok || !payload.success) {
        throw new Error(payload.error || `RESMA API request failed with status ${response.status}`);
    }

    return payload;
}

function toolSuccess(payload: ToolResultPayload) {
    const text = payload.llm?.markdown
        || payload.llm?.bullets?.join('\n')
        || JSON.stringify(payload.data ?? {}, null, 2);

    return {
        content: [{ type: 'text' as const, text }],
        structuredContent: {
            data: payload.data ?? {},
            meta: payload.meta ?? {},
            llm: payload.llm ?? {},
        },
    };
}

function toolFailure(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown MCP tool failure';
    return {
        isError: true,
        content: [{ type: 'text' as const, text: message }],
    };
}

const server = new McpServer(
    {
        name: 'resma-mcp',
        version: '0.1.0',
    },
    {
        instructions: [
            'Use these tools for aggregate-only observatory analysis and agency-ready report delivery.',
            'Do not infer raw contributor-level behavior from these outputs.',
            'If a quality gate is degraded, say so plainly before making recommendations.',
            'Treat RESMA as independent pre-impression intelligence, not as an ad-buying or audience-sync platform.',
        ].join(' '),
    },
);

// @ts-ignore deep instantiation bug in TS 7.0 beta
server.registerTool(
    'audience_forecast',
    {
        title: 'Audience Forecast',
        description: 'Aggregate-only forecast for how a target video may travel across observed cohorts.',
        inputSchema: {
            targetVideoId: z.string().min(1),
            seedVideoId: z.string().optional(),
            platform: z.enum(['youtube', 'instagram', 'twitter', 'tiktok']).optional(),
            maxDepth: z.number().int().min(1).max(6).optional(),
            beamWidth: z.number().int().min(5).max(120).optional(),
        },
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async (args) => {
        try {
            const payload = await callResma('/api/v1/analysis/audience-forecast', {
                ...args,
                format: 'llm',
            });
            return toolSuccess(payload);
        } catch (error) {
            return toolFailure(error);
        }
    },
);

// @ts-ignore deep instantiation bug in TS 7.0 beta
server.registerTool(
    'recommendation_map',
    {
        title: 'Recommendation Map',
        description: 'Combined BFS/DFS recommendation map for a seed video, scoped to personal or cohort observatory data.',
        inputSchema: {
            seedVideoId: z.string().min(1),
            platform: z.enum(['youtube', 'instagram', 'twitter', 'tiktok']).optional(),
            maxDepth: z.number().int().min(1).max(8).optional(),
            maxNodes: z.number().int().min(1).max(300).optional(),
            cohortId: z.string().optional(),
        },
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async (args) => {
        try {
            const payload = await callResma('/api/v1/analysis/recommendation-map', {
                ...args,
                format: 'llm',
            });
            return toolSuccess(payload);
        } catch (error) {
            return toolFailure(error);
        }
    },
);

// @ts-ignore deep instantiation bug in TS 7.0 beta
server.registerTool(
    'go_to_market_brief',
    {
        title: 'Go-to-Market Brief',
        description: 'Aggregate cohort brief for creator strategy and audience targeting.',
        inputSchema: {
            targetVideoId: z.string().min(1),
            seedVideoId: z.string().optional(),
            platform: z.enum(['youtube', 'instagram', 'twitter', 'tiktok']).optional(),
            maxDepth: z.number().int().min(1).max(6).optional(),
            beamWidth: z.number().int().min(5).max(120).optional(),
            topCohorts: z.number().int().min(1).max(12).optional(),
            maxPathsPerCohort: z.number().int().min(1).max(10).optional(),
            pathBranchLimit: z.number().int().min(1).max(25).optional(),
        },
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async (args) => {
        try {
            const payload = await callResma('/api/v1/analysis/go-to-market-brief', {
                ...args,
                format: 'llm',
            });
            return toolSuccess(payload);
        } catch (error) {
            return toolFailure(error);
        }
    },
);

// @ts-ignore deep instantiation bug in TS 7.0 beta
server.registerTool(
    'data_quality',
    {
        title: 'Data Quality',
        description: 'Aggregate observatory quality diagnostics for recommendation parsing, stitching, and cohort stability.',
        inputSchema: {
            platform: z.enum(['youtube', 'instagram', 'twitter', 'tiktok']).optional(),
            windowHours: z.number().int().min(1).max(24 * 180).optional(),
        },
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async (args) => {
        try {
            const payload = await callResma('/api/v1/analysis/data-quality', {
                ...args,
                format: 'llm',
            });
            return toolSuccess(payload);
        } catch (error) {
            return toolFailure(error);
        }
    },
);

// @ts-ignore deep instantiation bug in TS 7.0 beta
server.registerTool(
    'observatory_stats',
    {
        title: 'Observatory Stats',
        description: 'Top-level aggregate observatory counts for contributors, snapshots, feed items, and verified creators.',
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async () => {
        try {
            const payload = await callResma('/api/v1/analysis/stats', {
                format: 'llm',
            });
            return toolSuccess(payload);
        } catch (error) {
            return toolFailure(error);
        }
    },
);

// @ts-ignore deep instantiation bug in TS 7.0 beta
server.registerTool(
    'agency_report_export',
    {
        title: 'Agency Report Export',
        description: 'Read a saved aggregate report run in a delivery-friendly format for white-glove agency workflows.',
        inputSchema: {
            reportRunId: z.string().uuid(),
            format: z.enum(['json', 'llm', 'markdown', 'client-report']).optional(),
        },
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async (args) => {
        try {
            const payload = await callResma(`/api/v1/reports/runs/${args.reportRunId}/export`, {
                format: args.format ?? 'client-report',
            });
            return toolSuccess(payload);
        } catch (error) {
            return toolFailure(error);
        }
    },
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

void main();
