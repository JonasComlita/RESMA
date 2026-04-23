import { createHash } from 'crypto';
import { asRecord, sanitizeString } from '../lib/ingestUtils.js';

const DEFAULT_FINGERPRINT_LIMIT = 35;
const DEFAULT_SESSION_GAP_MS = 25 * 60 * 1000;
const DEFAULT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export interface SnapshotFingerprint {
    key: string;
    hash: string;
    orderedVideoIds: string[];
}

interface FingerprintItem {
    videoId: unknown;
    positionInFeed?: unknown;
}

interface BuildSessionQualityMetadataInput {
    userId: string;
    platform: string;
    capturedAt: Date;
    feedItems: FingerprintItem[];
    existingMetadata?: unknown;
    fingerprintLimit?: number;
    sessionGapMs?: number;
    duplicateWindowMs?: number;
}

function normalizePosition(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.round(value));
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return Math.max(0, parsed);
        }
    }
    return fallback;
}

function shortHash(value: string): string {
    return createHash('sha1').update(value).digest('hex').slice(0, 16);
}

export function buildSnapshotFingerprint(
    items: FingerprintItem[],
    fingerprintLimit = DEFAULT_FINGERPRINT_LIMIT
): SnapshotFingerprint {
    const orderedVideoIds = items
        .map((item, index) => ({
            videoId: sanitizeString(item.videoId),
            position: normalizePosition(item.positionInFeed, index),
            index,
        }))
        .filter((item): item is { videoId: string; position: number; index: number } => Boolean(item.videoId))
        .sort((left, right) => left.position - right.position || left.index - right.index)
        .map((item) => item.videoId)
        .slice(0, fingerprintLimit);

    const key = orderedVideoIds.join('|');
    const hash = shortHash(key);

    return { key, hash, orderedVideoIds };
}

export function buildSessionQualityMetadata(input: BuildSessionQualityMetadataInput): Record<string, unknown> {
    const existing = asRecord(input.existingMetadata);
    const existingQuality = asRecord(existing.quality);
    const fingerprint = buildSnapshotFingerprint(input.feedItems, input.fingerprintLimit);
    const sessionGapMs = input.sessionGapMs ?? DEFAULT_SESSION_GAP_MS;
    const duplicateWindowMs = input.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS;
    const capturedAtMs = input.capturedAt.getTime();
    const sessionWindowStartMs = capturedAtMs - (capturedAtMs % sessionGapMs);

    const sourceSessionId =
        sanitizeString(existing.sessionId)
        || sanitizeString(existing.sessionKey)
        || sanitizeString(existing.clientSessionId);

    const stitchedSessionKey = sourceSessionId
        ? `${input.platform}:${shortHash(`${input.userId}:${sourceSessionId}`)}`
        : `${input.platform}:${shortHash(input.userId)}:${sessionWindowStartMs}`;

    const quality = {
        ...existingQuality,
        schemaVersion: 1,
        parserVersion: 'strict-v1',
        fingerprintHash: fingerprint.hash,
        fingerprintKey: fingerprint.key,
        fingerprintSize: fingerprint.orderedVideoIds.length,
        fingerprintSample: fingerprint.orderedVideoIds.slice(0, 8),
        sessionGapMs,
        duplicateWindowMs,
        stitchedSessionKey,
        sessionWindowStart: new Date(sessionWindowStartMs).toISOString(),
        sessionWindowEnd: new Date(sessionWindowStartMs + sessionGapMs).toISOString(),
        computedAt: input.capturedAt.toISOString(),
    };

    return {
        ...existing,
        quality,
    };
}
