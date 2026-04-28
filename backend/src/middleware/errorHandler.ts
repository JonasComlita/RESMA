import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export interface ApiError extends Error {
    statusCode?: number;
}

export function errorHandler(
    err: ApiError,
    req: Request,
    res: Response,
    next: NextFunction
) {
    const statusCode = err.statusCode || 500;
    const message = statusCode >= 500
        ? 'Internal server error'
        : err.message || 'Internal server error';

    // Log full error details internally — never expose to client
    logger.error(
        {
            err,
            statusCode,
            method: req.method,
            url: req.originalUrl,
        },
        'Request error',
    );

    res.status(statusCode).json({
        success: false,
        error: message,
    });
}

export function createError(message: string, statusCode: number): ApiError {
    const error: ApiError = new Error(message);
    error.statusCode = statusCode;
    return error;
}
