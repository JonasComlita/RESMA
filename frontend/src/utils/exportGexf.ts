import type { RecommendationMapResult, TraversalEdge } from '../types/recommendationMap';

interface MergedGexfEdge {
    fromVideoId: string;
    toVideoId: string;
    confidence: number;
    count: number;
    avgRank: number;
    traversal: 'bfs' | 'dfs' | 'both';
}

function escapeXml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function attvalue(attribute: string, value: string | number | null) {
    if (value === null) return null;
    return `<attvalue for="${escapeXml(attribute)}" value="${escapeXml(String(value))}" />`;
}

function attvalues(values: Array<string | null>) {
    const presentValues = values.filter((value): value is string => value !== null);
    if (presentValues.length === 0) return '';
    return `<attvalues>${presentValues.join('')}</attvalues>`;
}

function traversalLabel(isBfs: boolean, isDfs: boolean): 'bfs' | 'dfs' | 'both' {
    if (isBfs && isDfs) return 'both';
    return isBfs ? 'bfs' : 'dfs';
}

function mergeEdges(map: RecommendationMapResult): MergedGexfEdge[] {
    const mergedEdges = new Map<string, MergedGexfEdge & { bfs: boolean; dfs: boolean; rankTotal: number; rankWeight: number }>();

    const absorb = (edge: TraversalEdge, traversal: 'bfs' | 'dfs') => {
        const key = `${edge.fromVideoId}::${edge.toVideoId}`;
        const current = mergedEdges.get(key);
        const count = Math.max(0, edge.count);

        if (!current) {
            mergedEdges.set(key, {
                fromVideoId: edge.fromVideoId,
                toVideoId: edge.toVideoId,
                confidence: edge.confidence,
                count,
                avgRank: edge.avgRank,
                traversal,
                bfs: traversal === 'bfs',
                dfs: traversal === 'dfs',
                rankTotal: edge.avgRank * Math.max(1, count),
                rankWeight: Math.max(1, count),
            });
            return;
        }

        current.confidence = Math.max(current.confidence, edge.confidence);
        current.count += count;
        current.rankTotal += edge.avgRank * Math.max(1, count);
        current.rankWeight += Math.max(1, count);
        current.bfs = current.bfs || traversal === 'bfs';
        current.dfs = current.dfs || traversal === 'dfs';
        current.traversal = traversalLabel(current.bfs, current.dfs);
        current.avgRank = current.rankTotal / current.rankWeight;
    };

    for (const edge of map.bfs.edges) {
        absorb(edge, 'bfs');
    }

    for (const edge of map.dfs.edges) {
        absorb(edge, 'dfs');
    }

    return Array.from(mergedEdges.values()).map((edge) => ({
        fromVideoId: edge.fromVideoId,
        toVideoId: edge.toVideoId,
        confidence: edge.confidence,
        count: edge.count,
        avgRank: edge.avgRank,
        traversal: edge.traversal,
    }));
}

export function exportGexf(map: RecommendationMapResult) {
    const lastModifiedDate = new Date().toISOString().slice(0, 10);
    const description = `Seed video ${map.seedVideoId} on ${map.platform}`;
    const edges = mergeEdges(map);

    const nodeAttributes = [
        '<attributes class="node">',
        '<attribute id="title" title="title" attrtype="string" />',
        '<attribute id="channel" title="channel" attrtype="string" />',
        '<attribute id="bfsDepth" title="bfsDepth" attrtype="integer" />',
        '<attribute id="dfsDepth" title="dfsDepth" attrtype="integer" />',
        '<attribute id="discoveredBy" title="discoveredBy" attrtype="string" />',
        '</attributes>',
    ].join('');

    const edgeAttributes = [
        '<attributes class="edge">',
        '<attribute id="weight" title="weight" attrtype="float" />',
        '<attribute id="count" title="count" attrtype="integer" />',
        '<attribute id="avgRank" title="avgRank" attrtype="float" />',
        '<attribute id="traversal" title="traversal" attrtype="string" />',
        '</attributes>',
    ].join('');

    const nodesXml = map.combinedNodes.map((node) => {
        const values = attvalues([
            attvalue('title', node.title),
            attvalue('channel', node.channel),
            attvalue('bfsDepth', node.bfsDepth),
            attvalue('dfsDepth', node.dfsDepth),
            attvalue('discoveredBy', node.discoveredBy),
        ]);

        return `<node id="${escapeXml(node.videoId)}" label="${escapeXml(node.videoId)}">${values}</node>`;
    }).join('');

    const edgesXml = edges.map((edge, index) => {
        const edgeId = `e${index}`;
        const values = attvalues([
            attvalue('weight', edge.confidence),
            attvalue('count', edge.count),
            attvalue('avgRank', edge.avgRank),
            attvalue('traversal', edge.traversal),
        ]);

        return `<edge id="${edgeId}" source="${escapeXml(edge.fromVideoId)}" target="${escapeXml(edge.toVideoId)}" weight="${escapeXml(String(edge.confidence))}">${values}</edge>`;
    }).join('');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gexf xmlns="http://gexf.net/1.3" version="1.3">',
        `<meta lastmodifieddate="${lastModifiedDate}">`,
        '<creator>RESMA Observatory</creator>',
        `<description>${escapeXml(description)}</description>`,
        '</meta>',
        '<graph mode="static" defaultedgetype="directed">',
        nodeAttributes,
        edgeAttributes,
        `<nodes>${nodesXml}</nodes>`,
        `<edges>${edgesXml}</edges>`,
        '</graph>',
        '</gexf>',
    ].join('');
}
