import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    VitePWA({
      registerType: 'autoUpdate',
      // React Router (framework mode) sets per-environment build.outDir via the
      // Vite Builder/Environment API rather than the shared top-level config, so
      // vite-plugin-pwa's default outDir resolution (viteConfig.build.outDir)
      // falls back to 'dist' and writes sw.js there instead of build/client.
      // Pin it explicitly to the client output directory.
      outDir: 'build/client',
      manifest: {
        name: 'Cifra',
        short_name: 'Cifra',
        description: 'Privacy-first personal finance — local, encrypted',
        theme_color: '#1a1a1a',
        background_color: '#faf7f2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
