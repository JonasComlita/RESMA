
import { packAndCompress, decompressAndUnpack } from '../services/serialization';

async function verify() {
    console.log('Verifying serialization logic...');

    const enhancedEngagement = {
        likes: 1200,
        comments: 45,
        shares: 12,
        analytics: {
            duration: 60,
            watchedSeconds: 45,
            loops: 2,
            seekCount: 1,
            exitReason: 'scrolled',
            interaction: {
                liked: true,
                clickedProfile: true,
                clickedShop: false
            }
        },
        isSponsored: false
    };

    try {
        const packed = packAndCompress(enhancedEngagement);
        console.log(`Packed size: ${packed.data.length} bytes`);

        const unpacked = decompressAndUnpack(packed.data);
        console.log('Unpacked data:', JSON.stringify(unpacked, null, 2));

        // Deep equality check
        const original = JSON.stringify(enhancedEngagement);
        const result = JSON.stringify(unpacked);

        if (original === result) {
            console.log('SUCCESS: Data integrity verified.');
            process.exit(0);
        } else {
            console.error('FAILURE: Data mismatch.');
            process.exit(1);
        }
    } catch (error) {
        console.error('ERROR during verification:', error);
        process.exit(1);
    }
}

verify();
