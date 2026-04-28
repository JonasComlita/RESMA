import type { NextFunction, Response } from 'express';
import {
    coercePlatformFeedPayload,
    getFeedItemLimitError,
    type PlatformFeedPayload,
    type SupportedPlatform,
} from '@resma/shared';
import type { AuthRequest } from './authenticate.js';
import { createError } from './errorHandler.js';
import { logIngestWarn } from '../services/ingestObservability.js';

export interface ValidatedFeedRequest extends AuthRequest {
    validatedFeedPayload?: PlatformFeedPayload;
}

interface ValidateIngestPayloadOptions {
    platform: SupportedPlatform;
    routeLabel: string;
    allowAnyPlatform?: boolean;
}

export function validateIngestPayload(options: ValidateIngestPayloadOptions) {
    return (req: ValidatedFeedRequest, _res: Response, next: NextFunction) => {
        const requestedPlatform = typeof req.body?.platform === 'string'
            ? req.body.platform.trim().toLowerCase()
            : null;
        
        if (!options.allowAnyPlatform && requestedPlatform && requestedPlatform !== options.platform) {
            logIngestWarn(`Contract validation failed for ${options.routeLabel}`, req, {
                reason: `payload requested explicit platform outside the ${options.routeLabel} ${options.platform} gateway`,
            });
            return next(createError('Payload failed contract validation', 400));
        }

        const feedLimitError = getFeedItemLimitError(req.body);
        if (feedLimitError) {
            logIngestWarn(`Feed item limit exceeded for ${options.routeLabel}`, req, {
                reason: feedLimitError,
            });
            return next(createError(feedLimitError, 400));
        }

        const validPayload = coercePlatformFeedPayload(req.body, {
            expectedPlatform: (options.allowAnyPlatform && requestedPlatform) ? requestedPlatform as SupportedPlatform : options.platform,
            requireFullFeedValidity: true,
        });
        if (!validPayload) {
            logIngestWarn(`Contract validation failed for ${options.routeLabel}`, req, {
                reason: 'payload failed shared contract coercion',
            });
            return next(createError('Payload failed contract validation', 400));
        }

        req.validatedFeedPayload = validPayload;
        next();
    };
}
