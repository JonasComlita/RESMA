import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { syncRecentSnapshotsToClickhouse } from '../src/workers/olap-sync';
import { encode } from '@msgpack/msgpack';
// `fzstd` only supports decompression in browser/js, compress is not available.
// We will mock `fzstd.decompress` in the successful case, or use a known compressed payload.
// Let's just mock `fzstd` for the tests to easily simulate valid vs invalid decompression.

// We mock the entire file for the tests
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    feedItem: {
      findMany: vi.fn()
    }
  }
}));

vi.mock('fzstd', async (importOriginal) => {
    return {
        decompress: vi.fn().mockImplementation((buf: Uint8Array) => {
            // Very simple mocked decompression logic to allow us to pass through valid msgpack
            if (buf.toString() === 'invalid_compressed_data') {
                throw new Error('fzstd decompress error');
            }
            return buf; // Pass through the encoded msgpack buffer
        })
    };
});

describe('olap-sync worker', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let findManyMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        findManyMock = prisma.feedItem.findMany as unknown as ReturnType<typeof vi.fn>;
        findManyMock.mockReset();
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        vi.clearAllMocks();
    });

    it('should successfully sync items with valid engagement metrics', async () => {
        const validMetrics = { likes: 10, comments: 5, shares: 2, views: 100 };
        // We bypass actual compression, because our fzstd mock just passes the buffer through
        const mockCompressedMetrics = Buffer.from(encode(validMetrics));

        const mockDate = new Date();

        findManyMock.mockResolvedValue([
            {
                id: 1,
                snapshotId: 'snap-1',
                videoId: 'vid-1',
                creatorId: 'creator-1',
                engagementMetrics: mockCompressedMetrics,
                likesCount: null,
                commentsCount: null,
                sharesCount: null,
                watchDuration: 12.5,
                contentCategories: ['comedy'],
                contentTags: ['funny'],
                interacted: true,
                interactionType: 'like',
                snapshot: {
                    platform: 'tiktok',
                    capturedAt: mockDate
                }
            }
        ]);

        await syncRecentSnapshotsToClickhouse();

        expect(findManyMock).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[OLAP-SYNC] Inserted 1 rows into resma.feed_events'));
    });

    it('should catch decoding errors, log them, and continue processing', async () => {
        const mockDate = new Date();

        // Provide invalid data that will cause our mock or msgpack to fail
        const invalidCompressedMetrics = Buffer.from('invalid_compressed_data');

        findManyMock.mockResolvedValue([
            {
                id: 2,
                snapshotId: 'snap-2',
                videoId: 'vid-2',
                creatorId: 'creator-2',
                engagementMetrics: invalidCompressedMetrics,
                likesCount: null,
                commentsCount: null,
                sharesCount: null,
                watchDuration: 0,
                contentCategories: [],
                contentTags: [],
                interacted: false,
                interactionType: null,
                snapshot: {
                    platform: 'youtube',
                    capturedAt: mockDate
                }
            }
        ]);

        await syncRecentSnapshotsToClickhouse();

        expect(findManyMock).toHaveBeenCalledTimes(1);

        // Error should be logged
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to decode metrics for item 2',
            expect.any(Error)
        );

        // Sync should complete without crashing and insert the row with fallback/default values
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[OLAP-SYNC] Inserted 1 rows into resma.feed_events'));
    });

    it('should skip clickhouse insert if no recent items are found', async () => {
        findManyMock.mockResolvedValue([]);

        await syncRecentSnapshotsToClickhouse();

        expect(findManyMock).toHaveBeenCalledTimes(1);
        expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Inserted'));
    });
});
