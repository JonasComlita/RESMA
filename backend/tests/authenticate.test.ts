import { describe, expect, it, vi, beforeEach } from 'vitest';
import { authenticate, AuthRequest } from '../src/middleware/authenticate.js';
import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';

describe('authenticate middleware', () => {
    let mockReq: Partial<AuthRequest>;
    let mockRes: Partial<Response>;
    let nextFunction: NextFunction;

    beforeEach(() => {
        mockReq = {
            headers: {}
        };
        mockRes = {};
        nextFunction = vi.fn();
    });

    it('returns 401 if Authorization header is missing', () => {
        authenticate(mockReq as AuthRequest, mockRes as Response, nextFunction);

        expect(nextFunction).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Authorization token required',
                statusCode: 401
            })
        );
    });

    it('returns 401 if Authorization header does not start with Bearer', () => {
        mockReq.headers = { authorization: 'Basic some_token' };

        authenticate(mockReq as AuthRequest, mockRes as Response, nextFunction);

        expect(nextFunction).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Authorization token required',
                statusCode: 401
            })
        );
    });

    it('returns 401 if token is invalid', () => {
        mockReq.headers = { authorization: 'Bearer invalid_token' };

        authenticate(mockReq as AuthRequest, mockRes as Response, nextFunction);

        expect(nextFunction).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Invalid or expired token',
                statusCode: 401
            })
        );
    });

    it('returns 401 if token is expired', () => {
        // Create an expired token
        const expiredToken = jwt.sign({ userId: 'test-user' }, config.jwt.secret, { expiresIn: '-1h' });
        mockReq.headers = { authorization: `Bearer ${expiredToken}` };

        authenticate(mockReq as AuthRequest, mockRes as Response, nextFunction);

        expect(nextFunction).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Invalid or expired token',
                statusCode: 401
            })
        );
    });

    it('sets req.userId and calls next() if token is valid', () => {
        const validToken = jwt.sign({ userId: 'test-user' }, config.jwt.secret);
        mockReq.headers = { authorization: `Bearer ${validToken}` };

        authenticate(mockReq as AuthRequest, mockRes as Response, nextFunction);

        expect(mockReq.userId).toBe('test-user');
        expect(nextFunction).toHaveBeenCalledWith();
        // ensure it was called without an error
        const mockCall = (nextFunction as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(mockCall[0]).toBeUndefined();
    });
});
