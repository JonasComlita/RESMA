import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOpenApiDocument } from '../openapi.js';

const repoRoot = path.resolve(process.cwd(), '..');
const outputDir = path.join(repoRoot, 'docs', 'api');
const outputPath = path.join(outputDir, 'openapi.json');

async function main() {
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, 'utf-8');
    console.log(`Wrote ${outputPath}`);
}

void main();
