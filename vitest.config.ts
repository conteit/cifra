import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const storybookConfigDir = fileURLToPath(
  new URL('./.storybook', import.meta.url),
);

export default defineConfig({
  test: {
    projects: [
      // `unit` is the fast, browser-free project: pure TS services, crypto and
      // i18n. `npm run test:unit` scopes to it with --project so nothing here
      // ever needs Playwright installed.
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts', 'app/**/*.test.ts'],
          environment: 'node',
          // Dexie captures `globalThis.indexedDB` at module-evaluation time and
          // ESM imports are hoisted, so `fake-indexeddb` has to be installed
          // before the test module graph loads. See test/setup/indexeddb.ts.
          setupFiles: ['test/setup/indexeddb.ts'],
        },
      },
      // `stories` runs every Storybook story as a smoke test in a real browser.
      // It deliberately does NOT extend vite.config.ts: that config carries the
      // React Router and vite-plugin-pwa plugins, which are unusable outside the
      // app's own build (same reasoning as .storybook/main.ts). Only the two
      // plugins the stories actually need are declared here — Tailwind, because
      // .storybook/preview.ts imports app/app.css, and React for JSX.
      {
        plugins: [
          tailwindcss(),
          react(),
          storybookTest({ configDir: storybookConfigDir }),
        ],
        // Storybook's browser-side test setup lives inside node_modules, which
        // Vite does not crawl for dependency discovery. Its CJS leaves therefore
        // never get pre-bundled and blow up on import with "does not provide an
        // export named …". Naming them here forces the interop shim.
        optimizeDeps: {
          // Storybook's own Vite builder registers a plugin that feeds the story
          // and preview files to the dependency scanner; that plugin is not part
          // of this project, so the CJS packages reachable only from the addon's
          // in-browser setup file never get pre-bundled and fail to import.
          // Naming them keeps the scanner honest. Add to this list if a new
          // "does not provide an export named …" error appears.
          include: [
            'aria-query',
            'dom-accessibility-api',
            'lz-string',
            'pretty-format',
          ],
          entries: ['stories/**/*.stories.tsx', '.storybook/preview.ts'],
        },
        test: {
          // No setup file: since Storybook 10.3 the addon applies the preview
          // annotations (.storybook/preview.ts) automatically, so a manual
          // setProjectAnnotations call would double-register them.
          name: 'stories',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
