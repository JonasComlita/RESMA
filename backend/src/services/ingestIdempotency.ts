import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface DurableIngestResult<T> {
    replayed: boolean;
    snapshotId: string;
    value: T;
}

interface DurableIngestOptions<T> {
    userId: string;
    uploadId: string | null;
    createSnapshot: (tx: Prisma.TransactionClient) => Promise<{ snapshotId: string; value: T }>;
    onDuplicate: (snapshotId: string, tx: Prisma.TransactionClient) => Promise<T>;
}

export async function withDurableIngestIdempotency<T>({
    userId,
    uploadId,
    createSnapshot,
    onDuplicate,
}: DurableIngestOptions<T>): Promise<DurableIngestResult<T>> {
    if (!uploadId) {
        const created = await createSnapshot(prisma as unknown as Prisma.TransactionClient);
        return {
            replayed: false,
            snapshotId: created.snapshotId,
            value: created.value,
        };
    }

    return prisma.$transaction(async (tx) => {
        const insertedRows = await tx.$executeRaw`
            INSERT INTO "ingest_events" ("userId", "uploadId")
            VALUES (${userId}, ${uploadId})
            ON CONFLICT ("userId", "uploadId") DO NOTHING
        `;

        if (insertedRows === 0) {
            const existingRows = await tx.$queryRaw<Array<{ snapshotId: string | null }>>`
                SELECT "snapshotId"
                FROM "ingest_events"
                WHERE "userId" = ${userId}
                  AND "uploadId" = ${uploadId}
                LIMIT 1
            `;
            const existingSnapshotId = existingRows[0]?.snapshotId ?? null;

            if (!existingSnapshotId) {
                const created = await createSnapshot(tx);

                await tx.$executeRaw`
                    UPDATE "ingest_events"
                    SET "snapshotId" = ${created.snapshotId},
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "userId" = ${userId}
                      AND "uploadId" = ${uploadId}
                      AND "snapshotId" IS NULL
                `;

                return {
                    replayed: false,
                    snapshotId: created.snapshotId,
                    value: created.value,
                };
            }

            return {
                replayed: true,
                snapshotId: existingSnapshotId,
                value: await onDuplicate(existingSnapshotId, tx),
            };
        }

        const created = await createSnapshot(tx);

        await tx.$executeRaw`
            UPDATE "ingest_events"
            SET "snapshotId" = ${created.snapshotId},
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "userId" = ${userId}
              AND "uploadId" = ${uploadId}
        `;

        return {
            replayed: false,
            snapshotId: created.snapshotId,
            value: created.value,
        };
    });
}
