/**
 * RESMA - Browser Extension Serialization Utilities
 * 
 * Provides MessagePack serialization for efficient data transmission
 * from the browser extension to the backend API.
 * 
 * Note: We use MessagePack-only in the browser (no Zstandard compression)
 * because fzstd is decompressor-only. The backend adds Zstandard compression
 * for storage. MessagePack alone provides ~80% size reduction vs JSON.
 */

import { encode, decode } from '@msgpack/msgpack';

/**
 * Magic bytes to identify MessagePack data (without Zstandard)
 * "MSGP" for MessagePack-only format from extension
 */
const MSGPACK_MAGIC = new Uint8Array([0x4d, 0x53, 0x47, 0x50]); // "MSGP"

/**
 * Serialize data to MessagePack format
 * Returns a Uint8Array suitable for transmission via fetch
 * 
 * @param data - Any JSON-serializable data
 * @returns Uint8Array containing MSGP magic + MessagePack data
 */
export function packData<T>(data: T): Uint8Array {
    // Encode to MessagePack
    const msgpackData = encode(data);

    // Prepend magic bytes
    const result = new Uint8Array(MSGPACK_MAGIC.length + msgpackData.byteLength);
    result.set(MSGPACK_MAGIC, 0);
    result.set(new Uint8Array(msgpackData), MSGPACK_MAGIC.length);

    return result;
}

/**
 * Deserialize MessagePack data
 * 
 * @param data - Uint8Array containing MSGP magic + MessagePack
 * @returns Deserialized object
 */
export function unpackData<T>(data: Uint8Array): T {
    // Verify magic bytes
    const magic = data.slice(0, 4);
    if (!arraysEqual(magic, MSGPACK_MAGIC)) {
        throw new Error('Invalid data format: missing MSGP magic bytes');
    }

    // Extract MessagePack data (skip magic bytes)
    const msgpackData = data.slice(4);

    // Decode MessagePack
    return decode(msgpackData) as T;
}

/**
 * Check if data is in our MessagePack format
 */
export function isMessagePack(data: Uint8Array): boolean {
    if (data.length < 4) return false;
    return arraysEqual(data.slice(0, 4), MSGPACK_MAGIC);
}

/**
 * Helper to compare Uint8Arrays
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Get compression statistics for debugging/logging
 */
export function getCompressionStats(originalJson: string, packed: Uint8Array): {
    jsonBytes: number;
    packedBytes: number;
    savingsPercent: number;
} {
    const jsonBytes = new TextEncoder().encode(originalJson).length;
    const packedBytes = packed.length;
    const savingsPercent = ((jsonBytes - packedBytes) / jsonBytes) * 100;

    return { jsonBytes, packedBytes, savingsPercent };
}

/**
 * Create a fetch body with MessagePack
 * Returns headers and body for use with fetch()
 */
export function createPackedRequest<T>(data: T): {
    headers: Record<string, string>;
    body: ArrayBuffer;
} {
    const packed = packData(data);
    return {
        headers: {
            'Content-Type': 'application/x-msgpack',
        },
        body: packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
    };
}
