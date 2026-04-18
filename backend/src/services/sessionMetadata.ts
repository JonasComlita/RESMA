import { decompressAndUnpack, isCompressedMsgpack } from './serialization.js';

export type SessionMetadataDecodeStatus = 'missing' | 'decoded' | 'invalid';

export interface SessionMetadataDecodeResult {
    status: SessionMetadataDecodeStatus;
    metadata: Record<string, unknown> | null;
}

export function decodeSessionMetadataResult(data: Buffer | null): SessionMetadataDecodeResult {
    if (!data) {
        return {
            status: 'missing',
            metadata: null,
        };
    }

    try {
        const decoded = isCompressedMsgpack(data)
            ? decompressAndUnpack<unknown>(data)
            : JSON.parse(data.toString('utf-8'));

        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
            return {
                status: 'invalid',
                metadata: null,
            };
        }

        return {
            status: 'decoded',
            metadata: decoded as Record<string, unknown>,
        };
    } catch {
        return {
            status: 'invalid',
            metadata: null,
        };
    }
}
