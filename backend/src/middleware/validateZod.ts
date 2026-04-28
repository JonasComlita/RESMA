import type { NextFunction, Request, Response } from 'express';
import { z, type ZodType } from 'zod';
import { createError } from './errorHandler.js';

interface ZodValidationOptions {
    body?: ZodType;
    query?: ZodType;
    params?: ZodType;
}

/**
 * Express middleware that validates request body, query, and/or params
 * against Zod schemas. Returns 400 with the first validation error message
 * on failure, or attaches parsed (typed) data to req on success.
 */
export function validateZod(schemas: ZodValidationOptions) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const targets: Array<{ label: string; schema: ZodType; data: unknown }> = [];

        if (schemas.body) {
            targets.push({ label: 'body', schema: schemas.body, data: req.body });
        }
        if (schemas.query) {
            targets.push({ label: 'query', schema: schemas.query, data: req.query });
        }
        if (schemas.params) {
            targets.push({ label: 'params', schema: schemas.params, data: req.params });
        }

        for (const { label, schema, data } of targets) {
            const result = schema.safeParse(data);
            if (!result.success) {
                const firstIssue = result.error.issues[0];
                const path = firstIssue?.path?.join('.') || label;
                const message = firstIssue?.message || 'Invalid request';
                return next(createError(`${path}: ${message}`, 400));
            }

            // Overwrite with parsed (coerced/defaulted) values
            if (label === 'body') {
                req.body = result.data;
            } else if (label === 'query') {
                (req as any).query = result.data;
            } else if (label === 'params') {
                (req as any).params = result.data;
            }
        }

        next();
    };
}
