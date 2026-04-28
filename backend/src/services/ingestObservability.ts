import { Request } from 'express';
import { logger } from '../lib/logger.js';

export interface IngestRequestMeta {
    uploadId: string;
    uploadFormat: string;
    contentType: string;
    endpoint: string;
    method: string;
}

function headerValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return typeof value === 'string' ? value : null;
}

export function getIngestRequestMeta(req: Request): IngestRequestMeta {
    const uploadId = headerValue(req.headers['x-resma-upload-id']) ?? 'missing-upload-id';
    const uploadFormat = headerValue(req.headers['x-resma-upload-format']) ?? 'unknown';
    const contentType = headerValue(req.headers['content-type']) ?? 'unknown';

    return {
        uploadId,
        uploadFormat,
        contentType,
        endpoint: req.originalUrl || req.url || 'unknown',
        method: req.method,
    };
}

export function logIngestInfo(event: string, req: Request, extra?: Record<string, unknown>): void {
    const meta = getIngestRequestMeta(req);
    logger.info({
        ...meta,
        ...(extra ?? {}),
    }, `ingest.${event}`);
}

export function logIngestWarn(event: string, req: Request, extra?: Record<string, unknown>): void {
    const meta = getIngestRequestMeta(req);
    logger.warn({
        ...meta,
        ...(extra ?? {}),
    }, `ingest.${event}`);
}

export function logIngestError(event: string, req: Request, extra?: Record<string, unknown>): void {
    const meta = getIngestRequestMeta(req);
    logger.error({
        ...meta,
        ...(extra ?? {}),
    }, `ingest.${event}`);
}
