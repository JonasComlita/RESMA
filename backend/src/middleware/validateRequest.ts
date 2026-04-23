import type { NextFunction, Request, Response } from 'express';
import { validationResult, type ValidationChain } from 'express-validator';
import { createError } from './errorHandler.js';

export function validateRequest(validations: ValidationChain[]) {
    return [
        ...validations,
        (req: Request, _res: Response, next: NextFunction) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0]?.msg ?? 'Invalid request', 400));
            }

            next();
        },
    ];
}
