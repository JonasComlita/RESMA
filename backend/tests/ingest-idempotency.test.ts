import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
};

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        $transaction: vi.fn((callback) => callback(tx)),
    },
}));

const { withDurableIngestIdempotency } = await import('../src/services/ingestIdempotency.js');

describe('durable ingest idempotency', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('repairs an existing ingest event that has no snapshot instead of blocking retries', async () => {
        tx.$executeRaw.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
        tx.$queryRaw.mockResolvedValueOnce([{ snapshotId: null }]);

        const createSnapshot = vi.fn().mockResolvedValue({
            snapshotId: 'snapshot-recovered',
            value: { ok: true },
        });
        const onDuplicate = vi.fn();

        const result = await withDurableIngestIdempotency({
            userId: 'user-1',
            uploadId: 'upload-1',
            createSnapshot,
            onDuplicate,
        });

        expect(result).toEqual({
            replayed: false,
            snapshotId: 'snapshot-recovered',
            value: { ok: true },
        });
        expect(createSnapshot).toHaveBeenCalledWith(tx);
        expect(onDuplicate).not.toHaveBeenCalled();
        expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    });
});
