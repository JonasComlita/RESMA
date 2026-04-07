import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { cp, readFile, writeFile } from 'fs/promises';

function manifestRewritePlugin(): Plugin {
    return {
        name: 'resma-extension-manifest-rewrite',
        apply: 'build',
        async closeBundle() {
            const rootDir = __dirname;
            const manifestPath = resolve(rootDir, 'manifest.json');
            const distManifestPath = resolve(rootDir, 'dist/manifest.json');
            const iconsSrc = resolve(rootDir, 'icons');
            const iconsDist = resolve(rootDir, 'dist/icons');

            const rawManifest = await readFile(manifestPath, 'utf-8');
            const manifest = JSON.parse(rawManifest) as {
                host_permissions?: string[];
            };

            const explicitEnvironment = process.env.RESMA_EXTENSION_ENV?.trim().toLowerCase();
            const isProduction = explicitEnvironment
                ? explicitEnvironment === 'production'
                : process.env.NODE_ENV === 'production';

            if (Array.isArray(manifest.host_permissions) && isProduction) {
                manifest.host_permissions = manifest.host_permissions.filter(
                    (permission) => !permission.startsWith('http://localhost:')
                );
            }

            await writeFile(distManifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf-8');
            await cp(iconsSrc, iconsDist, { recursive: true });
        },
    };
}

export default defineConfig({
    plugins: [react(), manifestRewritePlugin()],
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'popup.html'),
                'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
                'content/tiktok-observer': resolve(__dirname, 'src/content/tiktok-observer.ts'),
                'content/youtube-observer': resolve(__dirname, 'src/content/youtube-observer.ts'),
                'content/instagram-observer': resolve(__dirname, 'src/content/instagram-observer.ts'),
                'content/twitter-observer': resolve(__dirname, 'src/content/twitter-observer.ts'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name].[hash].js',
            },
        },
        emptyOutDir: true,
        sourcemap: true,
    },
});
