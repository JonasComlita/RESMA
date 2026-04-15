import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { createError } from './errorHandler.js';

export interface AuthRequest extends Request {
    userId?: string;
}

interface JwtPayload {
    userId: string;
}

export function authenticate(
    req: AuthRequest,
    res: Response,
    next: NextFunction
) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(createError('Authorization token required', 401));
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
        req.userId = decoded.userId;
        next();
    } catch (error) {
        next(createError('Invalid or expired token', 401));
    }
}
