/**
 * RESMA - Database Migration Script for MessagePack Conversion
 * 
 * This script migrates existing JSON data in PostgreSQL to MessagePack + Zstandard format.
 * Run this after updating the Prisma schema and generating the new client.
 * 
 * Usage:
 *   npx tsx src/scripts/migrate-to-msgpack.ts
 */

import { prisma } from '../lib/prisma.js';
import { packAndCompress } from '../services/serialization.js';

interface MigrationStats {
    table: string;
    processed: number;
    failed: number;
    originalBytes: number;
    compressedBytes: number;
}

async function migrateTable<T extends { id: string }>(
    tableName: string,
    findMany: () => Promise<T[]>,
    update: (id: string, data: any) => Promise<T>,
    getJsonFields: (record: T) => Record<string, any>,
    getUpdateData: (compressedFields: Record<string, Buffer>) => any
): Promise<MigrationStats> {
    const stats: MigrationStats = {
        table: tableName,
        processed: 0,
        failed: 0,
        originalBytes: 0,
        compressedBytes: 0,
    };

    console.log(`\nMigrating ${tableName}...`);

    const records = await findMany();
    console.log(`  Found ${records.length} records to migrate`);

    for (const record of records) {
        try {
            const jsonFields = getJsonFields(record);
            const compressedFields: Record<string, Buffer> = {};

            for (const [key, value] of Object.entries(jsonFields)) {
                if (value === null || value === undefined) {
                    continue;
                }

                // Calculate original JSON size
                const jsonStr = JSON.stringify(value);
                stats.originalBytes += Buffer.byteLength(jsonStr, 'utf-8');

                // Compress to MessagePack + Zstandard
                const result = packAndCompress(value);
                compressedFields[key] = result.data;
                stats.compressedBytes += result.compressedSize;
            }

            if (Object.keys(compressedFields).length > 0) {
                await update(record.id, getUpdateData(compressedFields));
            }

            stats.processed++;

            if (stats.processed % 100 === 0) {
                console.log(`  Processed ${stats.processed}/${records.length} records...`);
            }
        } catch (error) {
            console.error(`  Failed to migrate record ${record.id}:`, error);
            stats.failed++;
        }
    }

    return stats;
}

async function main() {
    console.log('='.repeat(60));
    console.log('RESMA - JSON to MessagePack Migration');
    console.log('='.repeat(60));

    const allStats: MigrationStats[] = [];

    // Migrate FeedSnapshots (sessionMetadata)
    const snapshotStats = await migrateTable(
        'FeedSnapshot',
        () => prisma.feedSnapshot.findMany({
            where: { sessionMetadata: { not: null } },
        }),
        (id, data) => prisma.feedSnapshot.update({ where: { id }, data }),
        (record: any) => ({ sessionMetadata: record.sessionMetadata }),
        (compressed) => ({ sessionMetadata: compressed.sessionMetadata })
    );
    allStats.push(snapshotStats);

    // Migrate FeedItems (engagementMetrics) 
    const feedItemStats = await migrateTable(
        'FeedItem',
        () => prisma.feedItem.findMany({
            where: { engagementMetrics: { not: null } },
        }),
        (id, data) => prisma.feedItem.update({ where: { id }, data }),
        (record: any) => ({ engagementMetrics: record.engagementMetrics }),
        (compressed) => ({ engagementMetrics: compressed.engagementMetrics })
    );
    allStats.push(feedItemStats);

    // Migrate CreatorReach (audienceProfile)
    const reachStats = await migrateTable(
        'CreatorReach',
        () => prisma.creatorReach.findMany({
            where: { audienceProfile: { not: null } },
        }),
        (id, data) => prisma.creatorReach.update({ where: { id }, data }),
        (record: any) => ({ audienceProfile: record.audienceProfile }),
        (compressed) => ({ audienceProfile: compressed.audienceProfile })
    );
    allStats.push(reachStats);

    // Migrate PatternGroups (characteristics)
    const patternStats = await migrateTable(
        'PatternGroup',
        () => prisma.patternGroup.findMany(),
        (id, data) => prisma.patternGroup.update({ where: { id }, data }),
        (record: any) => ({ characteristics: record.characteristics }),
        (compressed) => ({ characteristics: compressed.characteristics })
    );
    allStats.push(patternStats);

    // Migrate Users (preferences)
    const userStats = await migrateTable(
        'User',
        () => prisma.user.findMany({
            where: { preferences: { not: null } },
        }),
        (id, data) => prisma.user.update({ where: { id }, data }),
        (record: any) => ({ preferences: record.preferences }),
        (compressed) => ({ preferences: compressed.preferences })
    );
    allStats.push(userStats);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('Migration Complete');
    console.log('='.repeat(60));

    let totalOriginal = 0;
    let totalCompressed = 0;
    let totalProcessed = 0;
    let totalFailed = 0;

    for (const stats of allStats) {
        console.log(`\n${stats.table}:`);
        console.log(`  Records: ${stats.processed} processed, ${stats.failed} failed`);
        console.log(`  Size: ${formatBytes(stats.originalBytes)} → ${formatBytes(stats.compressedBytes)}`);
        console.log(`  Savings: ${((1 - stats.compressedBytes / stats.originalBytes) * 100).toFixed(1)}%`);

        totalOriginal += stats.originalBytes;
        totalCompressed += stats.compressedBytes;
        totalProcessed += stats.processed;
        totalFailed += stats.failed;
    }

    console.log('\n' + '-'.repeat(60));
    console.log('TOTAL:');
    console.log(`  Records: ${totalProcessed} processed, ${totalFailed} failed`);
    console.log(`  Size: ${formatBytes(totalOriginal)} → ${formatBytes(totalCompressed)}`);
    if (totalOriginal > 0) {
        console.log(`  Total Savings: ${((1 - totalCompressed / totalOriginal) * 100).toFixed(1)}%`);
    }

    await prisma.$disconnect();
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

main().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
