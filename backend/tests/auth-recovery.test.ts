import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    feedSnapshot: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    feedItem: {
      findFirst: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    creator: {
      count: vi.fn(),
    },
  },
}));

describe('Pseudonymous auth recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a pseudonymous contributor and returns a recovery code', async () => {
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'user-1',
      anonymousId: 'anon-1',
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
    } as any);

    const res = await request(app)
      .post('/auth/register')
      .send({ password: 'supersecret123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.anonymousId).toBe('anon-1');
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.recoveryCode).toMatch(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);

    const createArgs = vi.mocked(prisma.user.create).mock.calls[0]?.[0];
    expect(createArgs?.data.passwordHash).toEqual(expect.any(String));
    expect(createArgs?.data.recoveryCodeHash).toMatch(/^\$2[aby]\$/);
    expect(createArgs?.data.recoveryCodeLookupHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('recovers a pseudonymous contributor account with a saved recovery code', async () => {
    const recoveryCodeHash = await bcrypt.hash('ABCDEFGHIJKLMNOP', 4);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      anonymousId: 'anon-1',
      passwordHash: 'old-hash',
      recoveryCodeHash,
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'user-1',
      anonymousId: 'anon-1',
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
    } as any);

    const res = await request(app)
      .post('/auth/recover')
      .send({
        recoveryCode: 'ABCD-EFGH-IJKL-MNOP',
        newPassword: 'evenbetter123',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.user.anonymousId).toBe('anon-1');
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.recoveryCode).toMatch(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);

    const findArgs = vi.mocked(prisma.user.findUnique).mock.calls[0]?.[0];
    expect(findArgs?.where.recoveryCodeLookupHash).toMatch(/^[a-f0-9]{64}$/);

    const updateArgs = vi.mocked(prisma.user.update).mock.calls[0]?.[0];
    expect(updateArgs?.data.passwordHash).toEqual(expect.any(String));
    expect(updateArgs?.data.recoveryCodeHash).toMatch(/^\$2[aby]\$/);
    expect(updateArgs?.data.recoveryCodeLookupHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deletes a contributor account only when the typed anonymous ID matches', async () => {
    const token = jwt.sign({ userId: 'user-1' }, config.jwt.secret);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      anonymousId: 'anon-1',
    } as any);
    vi.mocked(prisma.user.delete).mockResolvedValue({
      id: 'user-1',
    } as any);

    const mismatch = await request(app)
      .post('/auth/delete-account')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmAnonymousId: 'wrong-id' });

    expect(mismatch.status).toBe(400);
    expect(vi.mocked(prisma.user.delete)).not.toHaveBeenCalled();

    const success = await request(app)
      .post('/auth/delete-account')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmAnonymousId: 'anon-1' });

    expect(success.status).toBe(200);
    expect(success.body.data.deleted).toBe(true);
    expect(vi.mocked(prisma.user.delete)).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });
});
