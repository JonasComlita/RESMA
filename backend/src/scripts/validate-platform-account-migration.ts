import dotenv from 'dotenv';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

dotenv.config();

interface CountRow {
    count: bigint | number;
}

function parseCount(value: bigint | number | undefined): number {
    if (typeof value === 'bigint') {
        return Number(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return 0;
}

async function queryCount(sql: Prisma.Sql): Promise<number> {
    const rows = await prisma.$queryRaw<CountRow[]>(sql);
    return parseCount(rows[0]?.count);
}

async function main(): Promise<number> {
    console.log('Running platform-account migration validation...');

    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL must be set before running platform-account migration validation.');
        return 1;
    }

    const totalCreators = await prisma.creator.count();
    const totalPlatformAccounts = await prisma.platformAccount.count();

    const creatorsWithoutAccounts = await prisma.creator.count({
        where: {
            platformAccounts: {
                none: {},
            },
        },
    });

    const creatorUsersWithoutAccounts = await prisma.creator.count({
        where: {
            user: { userType: 'CREATOR' },
            platformAccounts: {
                none: {},
            },
        },
    });

    const blankHandleRows = await queryCount(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "platform_accounts"
        WHERE trim("platform_handle") = ''
    `);

    const missingPlatformRows = await queryCount(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "creator_reach"
        WHERE "platform" IS NULL OR trim("platform") = ''
    `);

    const negativeFeedMetricRows = await queryCount(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "feed_items"
        WHERE COALESCE("likesCount", 0) < 0
           OR COALESCE("commentsCount", 0) < 0
           OR COALESCE("sharesCount", 0) < 0
    `);

    const negativeReachMetricRows = await queryCount(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "creator_reach"
        WHERE COALESCE("likesCount", 0) < 0
           OR COALESCE("commentsCount", 0) < 0
           OR COALESCE("sharesCount", 0) < 0
    `);

    const platformBreakdown = await prisma.platformAccount.groupBy({
        by: ['platform'],
        _count: {
            _all: true,
        },
    });

    const issues: string[] = [];
    const warnings: string[] = [];

    if (totalCreators > 0 && totalPlatformAccounts === 0) {
        issues.push('No platform accounts found despite existing creators.');
    }

    if (blankHandleRows > 0) {
        issues.push(`Found ${blankHandleRows} platform accounts with blank handles.`);
    }

    if (missingPlatformRows > 0) {
        issues.push(`Found ${missingPlatformRows} creator_reach rows with missing platform.`);
    }

    if (negativeFeedMetricRows > 0) {
        issues.push(`Found ${negativeFeedMetricRows} feed_items rows with negative extracted metrics.`);
    }

    if (negativeReachMetricRows > 0) {
        issues.push(`Found ${negativeReachMetricRows} creator_reach rows with negative extracted metrics.`);
    }

    if (creatorsWithoutAccounts > 0) {
        warnings.push(`${creatorsWithoutAccounts} creators currently have no platform accounts.`);
    }

    if (creatorUsersWithoutAccounts > 0) {
        issues.push(`${creatorUsersWithoutAccounts} CREATOR users have no platform accounts.`);
    }

    console.log('\nSummary:');
    console.log(`- creators: ${totalCreators}`);
    console.log(`- platform_accounts: ${totalPlatformAccounts}`);
    console.log(`- creators without accounts: ${creatorsWithoutAccounts}`);
    console.log(`- creator users without accounts: ${creatorUsersWithoutAccounts}`);
    console.log(`- blank platform handles: ${blankHandleRows}`);
    console.log(`- creator_reach missing platform: ${missingPlatformRows}`);
    console.log(`- feed_items negative metrics: ${negativeFeedMetricRows}`);
    console.log(`- creator_reach negative metrics: ${negativeReachMetricRows}`);

    console.log('\nPlatform account breakdown:');
    if (platformBreakdown.length === 0) {
        console.log('- (none)');
    } else {
        for (const row of platformBreakdown) {
            console.log(`- ${row.platform}: ${row._count._all}`);
        }
    }

    if (warnings.length > 0) {
        console.log('\nWarnings:');
        for (const warning of warnings) {
            console.log(`- ${warning}`);
        }
    }

    if (issues.length > 0) {
        console.error('\nValidation failed:');
        for (const issue of issues) {
            console.error(`- ${issue}`);
        }
        return 1;
    }

    console.log('\nValidation passed.');
    return 0;
}

main()
    .then((exitCode) => {
        process.exitCode = exitCode;
    })
    .catch((error) => {
        console.error('Migration validation failed with exception:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
