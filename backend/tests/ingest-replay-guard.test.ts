import { beforeEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  getReplayKey,
  INGEST_REPLAY_MAX_BODY_BYTES,
  INGEST_REPLAY_MAX_COMPLETED_RESPONSES,
  resetIngestReplayGuardForTests,
  withIngestReplayGuard
} from '../src/services/ingestReplayGuard';

function makeRequest(path: string, uploadId?: string): Request {
  return {
    path,
    headers: uploadId ? { 'x-resma-upload-id': uploadId } : {},
  } as unknown as Request;
}

describe('ingest replay guard', () => {
  beforeEach(() => {
    resetIngestReplayGuardForTests();
  });

  it('returns null replay key when upload id or user id is missing', () => {
    expect(getReplayKey(makeRequest('/feeds'), 'user-1')).toBeNull();
    expect(getReplayKey(makeRequest('/feeds', 'upl-1'), undefined)).toBeNull();
  });

  it('builds deterministic replay keys from user + path + upload id', () => {
    expect(getReplayKey(makeRequest('/feeds', 'upl-1'), 'user-1')).toBe('user-1:/feeds:upl-1');
  });

  it('replays completed responses for duplicate upload ids', async () => {
    const key = 'user-1:/feeds:upl-replay';
    let producerCalls = 0;

    const first = await withIngestReplayGuard(key, async () => {
      producerCalls += 1;
      return { statusCode: 201, body: { snapshotId: 'snap-1' } };
    });
    const second = await withIngestReplayGuard(key, async () => {
      producerCalls += 1;
      return { statusCode: 201, body: { snapshotId: 'snap-2' } };
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.response).toEqual(first.response);
    expect(producerCalls).toBe(1);
  });

  it('does not cache oversized response bodies', async () => {
    const key = 'user-1:/feeds:upl-large';
    let producerCalls = 0;
    const oversizedPayload = `x${'y'.repeat(INGEST_REPLAY_MAX_BODY_BYTES + 64)}`;

    const first = await withIngestReplayGuard(key, async () => {
      producerCalls += 1;
      return { statusCode: 201, body: { payload: oversizedPayload } };
    });
    const second = await withIngestReplayGuard(key, async () => {
      producerCalls += 1;
      return { statusCode: 201, body: { payload: oversizedPayload } };
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(producerCalls).toBe(2);
  });

  it('evicts oldest completed responses once cache limit is exceeded', async () => {
    for (let index = 0; index < INGEST_REPLAY_MAX_COMPLETED_RESPONSES + 1; index += 1) {
      await withIngestReplayGuard(`user-1:/feeds:upl-${index}`, async () => ({
        statusCode: 201,
        body: { snapshotId: `snap-${index}` },
      }));
    }

    let evictedProducerCalls = 0;
    const oldest = await withIngestReplayGuard('user-1:/feeds:upl-0', async () => {
      evictedProducerCalls += 1;
      return { statusCode: 201, body: { snapshotId: 'snap-evicted' } };
    });

    expect(oldest.replayed).toBe(false);
    expect(evictedProducerCalls).toBe(1);

    const newest = await withIngestReplayGuard(
      `user-1:/feeds:upl-${INGEST_REPLAY_MAX_COMPLETED_RESPONSES}`,
      async () => {
        throw new Error('newest key should still be replayed from cache');
      }
    );
    expect(newest.replayed).toBe(true);
  });
});
