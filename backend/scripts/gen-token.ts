import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';

const prisma = new PrismaClient();

async function main() {
    let user = await prisma.user.findFirst();
    if (!user) {
        user = await prisma.user.create({
            data: {
                passwordHash: 'dummy',
                recoveryCodeHash: 'dummy',
                recoveryCodeLookupHash: 'dummy',
            }
        });
        console.log('Created dummy user for token generation.');
    }

    const token = jwt.sign({ userId: user.id }, config.jwt.secret, {
        expiresIn: '365d'
    });

    console.log('\n--- YOUR RESMA TOKEN ---');
    console.log(token);
    console.log('------------------------\n');
}

main().finally(() => prisma.$disconnect());
