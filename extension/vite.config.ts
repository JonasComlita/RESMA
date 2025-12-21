import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'popup.html'),
                'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
                'content/tiktok-observer': resolve(__dirname, 'src/content/tiktok-observer.ts'),
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
