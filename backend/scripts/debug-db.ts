import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const counts = await prisma.$queryRaw`
        SELECT platform, COUNT(*) as count 
        FROM feed_snapshots 
        GROUP BY platform;
    `;
    console.log('Snapshot counts by platform:', counts);
    
    const itemCounts = await prisma.$queryRaw`
        SELECT fs.platform, COUNT(*) as item_count
        FROM feed_items fi
        JOIN feed_snapshots fs ON fi."snapshotId" = fs.id
        GROUP BY fs.platform;
    `;
    console.log('Item counts by platform:', itemCounts);
}
main().catch(console.error).finally(() => prisma.$disconnect());
