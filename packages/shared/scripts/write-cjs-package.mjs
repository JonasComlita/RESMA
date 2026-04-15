import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cjsDir = resolve(process.cwd(), 'dist', 'cjs');

mkdirSync(cjsDir, { recursive: true });
writeFileSync(
    resolve(cjsDir, 'package.json'),
    `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
    'utf8'
);
