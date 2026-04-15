/**
 * RESMA - MessagePack Body Parser Middleware
 * 
 * Parses incoming requests with MessagePack content types:
 * - application/x-msgpack-zstd (MessagePack + Zstandard compressed)
 * - application/x-msgpack (MessagePack only, from browser extension)
 */

import { Request, Response, NextFunction } from 'express';
import { decode } from '@msgpack/msgpack';
import { decompressAndUnpack, isCompressedMsgpack } from '../services/serialization.js';

/**
 * Magic bytes for MessagePack-only format (from browser extension)
 * "MSGP" = [0x4d, 0x53, 0x47, 0x50]
 */
const MSGPACK_MAGIC = Buffer.from([0x4d, 0x53, 0x47, 0x50]);

/**
 * Check if buffer starts with MessagePack-only magic bytes
 */
function isPlainMsgpack(buffer: Buffer): boolean {
    if (buffer.length < 4) return false;
    return buffer.subarray(0, 4).equals(MSGPACK_MAGIC);
}

/**
 * Express middleware that parses MessagePack request bodies
 * 
 * Supports:
 * - application/x-msgpack-zstd (MessagePack + Zstandard)
 * - application/x-msgpack (MessagePack only)
 * - Falls through for other content types (JSON, etc.)
 */
export function msgpackParser(req: Request, res: Response, next: NextFunction) {
    const contentType = req.headers['content-type'];

    // Only handle our custom content types
    if (contentType !== 'application/x-msgpack-zstd' && contentType !== 'application/x-msgpack') {
        return next();
    }

    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
    });

    req.on('end', () => {
        try {
            const buffer = Buffer.concat(chunks);

            if (buffer.length === 0) {
                (req as any).body = {};
                return next();
            }

            let data: any;

            // Check for Zstandard-compressed format (RESM magic)
            if (isCompressedMsgpack(buffer)) {
                data = decompressAndUnpack(buffer);
                console.log(`[RESMA] Received zstd-compressed request: ${buffer.length}B`);
            }
            // Check for plain MessagePack format (MSGP magic)
            else if (isPlainMsgpack(buffer)) {
                const msgpackData = buffer.subarray(4);
                data = decode(msgpackData);
                console.log(`[RESMA] Received msgpack request: ${buffer.length}B`);
            }
            else {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid MessagePack format: missing magic bytes',
                });
            }

            (req as any).body = data;
            next();
        } catch (error) {
            console.error('[RESMA] Failed to parse MessagePack body:', error);
            return res.status(400).json({
                success: false,
                error: 'Failed to parse compressed request body',
            });
        }
    });

    req.on('error', (error) => {
        console.error('[RESMA] Request stream error:', error);
        return res.status(400).json({
            success: false,
            error: 'Request stream error',
        });
    });
}
