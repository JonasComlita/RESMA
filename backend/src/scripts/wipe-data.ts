import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Cleaning slate of observatory data...');
    
    // Deleting feed_items (will be handled by cascade if we delete snapshots, 
    // but doing it explicitly for clarity)
    const itemDelete = await prisma.feedItem.deleteMany({});
    console.log(`Deleted ${itemDelete.count} feed items.`);

    // Deleting ingest_events
    const eventDelete = await prisma.ingestEvent.deleteMany({});
    console.log(`Deleted ${eventDelete.count} ingest events.`);

    // Deleting feed_snapshots
    const snapshotDelete = await prisma.feedSnapshot.deleteMany({});
    console.log(`Deleted ${snapshotDelete.count} feed snapshots.`);

    console.log('Data wipe complete. Your slate is now clean.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
