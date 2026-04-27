import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma.js';
import { resetIngestReplayGuardForTests } from '../src/services/ingestReplayGuard.js';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        $transaction: vi.fn(),
        feedSnapshot: {
            create: vi.fn(),
            findMany: vi.fn(),
            count: vi.fn(),
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            delete: vi.fn(),
        },
        ingestEvent: {
            findUnique: vi.fn(),
            update: vi.fn(),
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
        },
        creator: {
            count: vi.fn(),
        },
    },
}));

function makeAuthToken() {
    return jwt.sign({ userId: 'test-user' }, config.jwt.secret);
}

describe('Reddit Feed API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetIngestReplayGuardForTests();
    });

    it('should require auth', async () => {
        const res = await request(app)
            .post('/reddit/feed')
            .send({ feed: [{ postId: 'abc123', subreddit: 'programming' }] });

        expect(res.status).toBe(401);
        expect(String(res.body.error)).toMatch(/Authorization token required|Invalid or expired token/);
    });

    it('should reject payloads that fail @resma/shared contract validation', async () => {
        const res = await request(app)
            .post('/reddit/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                feed: [{ title: 'Missing post ID' }],
                sessionMetadata: {},
            });

        expect(res.status).toBe(400);
        expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
    });

    it('should reject payloads that contain partially invalid feed rows', async () => {
        const res = await request(app)
            .post('/reddit/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                feed: [
                    { postId: 'abc123', subreddit: 'programming', title: 'valid row' },
                    { subreddit: 'programming', title: 'missing id row' },
                ],
                sessionMetadata: {},
            });

        expect(res.status).toBe(400);
        expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
    });

    it('persists valid reddit snapshots with Reddit-specific field mapping', async () => {
        vi.mocked(prisma.feedSnapshot.create).mockResolvedValue({
            id: 'snapshot-reddit-1',
            _count: { feedItems: 1 },
        } as any);

        const res = await request(app)
            .post('/reddit/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                feed: [{
                    url: 'https://www.reddit.com/r/programming/comments/abc123/post_title/',
                    subreddit: 'r/programming',
                    author: 'u/post_author',
                    title: 'Post title',
                    score: 42,
                    comments: 7,
                    type: 'link',
                    flair: 'Project Update',
                }],
                sessionMetadata: {
                    captureSurface: 'Home Feed',
                },
            });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ success: true, snapshotId: 'snapshot-reddit-1' });
        expect(prisma.feedSnapshot.create).toHaveBeenCalledTimes(1);
        expect(prisma.feedSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                platform: 'reddit',
                itemCount: 1,
                feedItems: {
                    create: [
                        expect.objectContaining({
                            videoId: 'abc123',
                            creatorHandle: 'programming',
                            caption: 'Post title',
                            likesCount: 42,
                            commentsCount: 7,
                            sharesCount: null,
                            watchDuration: 0,
                            contentCategories: expect.arrayContaining(['link', 'project-update']),
                        }),
                    ],
                },
            }),
        }));
    });

    it('replays duplicate reddit uploads with the same upload id', async () => {
        const transactionClient = {
            $executeRaw: vi.fn()
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0),
            $queryRaw: vi.fn().mockResolvedValue([
                { snapshotId: 'snapshot-reddit-replay' },
            ]),
            feedSnapshot: {
                create: vi.fn().mockResolvedValue({
                    id: 'snapshot-reddit-replay',
                    _count: { feedItems: 1 },
                }),
            },
        };

        vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(transactionClient));

        const payload = {
            feed: [{ postId: 'abc123', subreddit: 'programming', title: 'Replay post' }],
            sessionMetadata: {},
        };

        const first = await request(app)
            .post('/reddit/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .set('X-Resma-Upload-Id', 'reddit-upload-1')
            .send(payload);

        resetIngestReplayGuardForTests();

        const second = await request(app)
            .post('/reddit/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .set('X-Resma-Upload-Id', 'reddit-upload-1')
            .send(payload);

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body).toEqual(first.body);
        expect(transactionClient.feedSnapshot.create).toHaveBeenCalledTimes(1);
        expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('handles video posts with non-zero watchDuration', async () => {
        vi.mocked(prisma.feedSnapshot.create).mockResolvedValue({
            id: 'snapshot-reddit-video',
            _count: { feedItems: 1 },
        } as any);

        const res = await request(app)
            .post('/reddit/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                feed: [{
                    postId: 'v1d30',
                    subreddit: 'videos',
                    title: 'Video post',
                    postType: 'video',
                    watchTime: 12.5,
                }],
                sessionMetadata: {},
            });

        expect(res.status).toBe(201);
        const createArgs = vi.mocked(prisma.feedSnapshot.create).mock.calls[0]?.[0];
        expect(createArgs?.data.feedItems.create[0]).toEqual(expect.objectContaining({
            videoId: 'v1d30',
            watchDuration: 12.5,
            contentCategories: expect.arrayContaining(['video']),
        }));
    });

    it('handles NSFW and promoted post flags in contentCategories', async () => {
        vi.mocked(prisma.feedSnapshot.create).mockResolvedValue({
            id: 'snapshot-reddit-flags',
            _count: { feedItems: 1 },
        } as any);

        const res = await request(app)
            .post('/reddit/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                feed: [{
                    postId: 'ad123',
                    subreddit: 'technology',
                    title: 'Promoted post',
                    type: 'text',
                    isPromoted: true,
                    over18: true,
                }],
                sessionMetadata: {},
            });

        expect(res.status).toBe(201);
        const createArgs = vi.mocked(prisma.feedSnapshot.create).mock.calls[0]?.[0];
        expect(createArgs?.data.feedItems.create[0]).toEqual(expect.objectContaining({
            contentCategories: expect.arrayContaining(['text', 'promoted', 'nsfw']),
        }));
    });
});
