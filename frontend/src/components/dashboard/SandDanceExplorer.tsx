import * as React from 'react';
import { lazy, Suspense, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '../ErrorBoundary';
import type { SandDance } from '@msrvida/sanddance-react';

interface SandDanceExplorerProps {
    data: Record<string, unknown>[];
    title?: string;
}

type SandDanceInsight = SandDance.specs.Insight;

function canUseWebGl2() {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
}

function firstKeyByType(row: Record<string, unknown>, type: 'number' | 'string') {
    return Object.keys(row).find((key) => typeof row[key] === type);
}

function buildInsight(data: Record<string, unknown>[]): SandDanceInsight {
    const firstRow = data[0] ?? {};
    const categoryColumn = firstKeyByType(firstRow, 'string') ?? Object.keys(firstRow)[0] ?? 'row';
    const primaryMetric = firstKeyByType(firstRow, 'number') ?? categoryColumn;
    const colorMetric = Object.keys(firstRow).find((key) => key !== primaryMetric && typeof firstRow[key] === 'number')
        ?? categoryColumn;

    return {
        chart: 'barchartV',
        view: '2d',
        scheme: 'tableau10',
        size: {
            width: 920,
            height: 420,
        },
        columns: {
            uid: Object.keys(firstRow).includes('cohortId') ? 'cohortId' : categoryColumn,
            x: categoryColumn,
            y: primaryMetric,
            color: colorMetric,
            sort: primaryMetric,
        },
    };
}

const LazySandDanceViewer = lazy(async () => {
    const [SandDanceReact, ReactDOM, vega] = await Promise.all([
        import('@msrvida/sanddance-react'),
        import('react-dom'),
        import('vega'),
    ]);

    SandDanceReact.use(
        React as unknown as Parameters<typeof SandDanceReact.use>[0],
        ReactDOM as unknown as Parameters<typeof SandDanceReact.use>[1],
        vega as unknown as Parameters<typeof SandDanceReact.use>[2]
    );

    function LoadedSandDanceViewer({ data }: SandDanceExplorerProps) {
        if (!canUseWebGl2()) {
            throw new Error('WebGL2 is required for the interactive explorer.');
        }

        const insight = useMemo(() => buildInsight(data), [data]);

        return (
            <SandDanceReact.Viewer
                data={data}
                insight={insight}
            />
        );
    }

    return {
        default: LoadedSandDanceViewer,
    };
});

export function SandDanceExplorer({ data, title = 'Interactive Explorer' }: SandDanceExplorerProps) {
    if (data.length === 0) {
        return (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                No aggregate rows are available for exploration.
            </div>
        );
    }

    return (
        <ErrorBoundary
            title="Interactive explorer failed to render."
            description="WebGL2 is required for the interactive explorer."
            resetKey={`${title}:${data.length}`}
        >
            <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                    <span className="text-xs text-gray-500">{data.length.toLocaleString()} aggregate row(s)</span>
                </div>
                <div className="min-h-[420px] overflow-x-auto">
                    <Suspense
                        fallback={(
                            <div className="flex h-[420px] items-center justify-center rounded-lg bg-gray-50 text-sm text-gray-500">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Loading interactive explorer...
                            </div>
                        )}
                    >
                        <LazySandDanceViewer data={data} title={title} />
                    </Suspense>
                </div>
            </div>
        </ErrorBoundary>
    );
}
