import { Request } from 'express';

export interface IngestReplayResponse {
    statusCode: number;
    body: unknown;
}

const COMPLETED_TTL_MS = 10 * 60 * 1000;
export const INGEST_REPLAY_MAX_COMPLETED_RESPONSES = 500;
export const INGEST_REPLAY_MAX_BODY_BYTES = 64 * 1024;

const completedResponses = new Map<string, { expiresAt: number; response: IngestReplayResponse }>();
const inflightResponses = new Map<string, Promise<IngestReplayResponse>>();

function trimHeader(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
        return trimHeader(value[0]);
    }
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function getUploadId(req: Request): string | null {
    return trimHeader(req.headers['x-resma-upload-id']);
}

function pruneExpiredResponses() {
    const now = Date.now();
    for (const [key, value] of completedResponses.entries()) {
        if (value.expiresAt <= now) {
            completedResponses.delete(key);
        }
    }
}

function estimateBodyBytes(body: unknown): number {
    if (body === null || body === undefined) {
        return 0;
    }
    if (typeof body === 'string') {
        return Buffer.byteLength(body, 'utf-8');
    }
    try {
        return Buffer.byteLength(JSON.stringify(body), 'utf-8');
    } catch {
        return INGEST_REPLAY_MAX_BODY_BYTES + 1;
    }
}

function shouldCacheCompletedResponse(response: IngestReplayResponse): boolean {
    return estimateBodyBytes(response.body) <= INGEST_REPLAY_MAX_BODY_BYTES;
}

function enforceCompletedResponseLimit() {
    while (completedResponses.size > INGEST_REPLAY_MAX_COMPLETED_RESPONSES) {
        const oldestKey = completedResponses.keys().next().value;
        if (!oldestKey) {
            break;
        }
        completedResponses.delete(oldestKey);
    }
}

export function resetIngestReplayGuardForTests() {
    completedResponses.clear();
    inflightResponses.clear();
}

export function getReplayKey(req: Request, userId: string | undefined): string | null {
    if (!userId) {
        return null;
    }

    const uploadId = getUploadId(req);
    if (!uploadId) {
        return null;
    }

    return `${userId}:${req.path}:${uploadId}`;
}

export async function withIngestReplayGuard(
    replayKey: string | null,
    producer: () => Promise<IngestReplayResponse>
): Promise<{ replayed: boolean; response: IngestReplayResponse }> {
    if (!replayKey) {
        return { replayed: false, response: await producer() };
    }

    pruneExpiredResponses();

    const completed = completedResponses.get(replayKey);
    if (completed) {
        return { replayed: true, response: completed.response };
    }

    const inflight = inflightResponses.get(replayKey);
    if (inflight) {
        return { replayed: true, response: await inflight };
    }

    const producingResponse = (async () => {
        const response = await producer();
        if (shouldCacheCompletedResponse(response)) {
            completedResponses.set(replayKey, {
                expiresAt: Date.now() + COMPLETED_TTL_MS,
                response,
            });
            enforceCompletedResponseLimit();
        }
        return response;
    })();

    inflightResponses.set(replayKey, producingResponse);

    try {
        const response = await producingResponse;
        return { replayed: false, response };
    } finally {
        inflightResponses.delete(replayKey);
    }
}
