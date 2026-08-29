import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { type VitePluginPWAAPI, VitePWA } from 'vite-plugin-pwa';

// React Router (framework mode) sets per-environment build.outDir via the
// Vite Builder/Environment API rather than the shared top-level config, so
// vite-plugin-pwa's default outDir resolution (viteConfig.build.outDir)
// falls back to 'dist' and writes sw.js there instead of build/client.
// Pin it explicitly to the client output directory.
const CLIENT_OUT_DIR = 'build/client';

// The SPA shell. Workbox binds its NavigationRoute to this URL, so every
// offline navigation is answered out of the precache entry for it — which
// means it has to actually BE in the precache manifest. See
// `pwaAfterSpaPrerender` below for why that is not automatic here.
const NAVIGATE_FALLBACK = 'index.html';

/**
 * Regenerates the service worker after React Router has prerendered the SPA
 * shell, and fails the build if the shell did not make it into the precache
 * manifest.
 *
 * Why this is needed (FOUN-05 regression, sprint-01 close review S-1/C-8):
 * React Router's `prerender` plugin wraps Vite's `builder.buildApp` and writes
 * `build/client/index.html` *after* the inner `buildApp` — i.e. after every
 * environment build has finished and after vite-plugin-pwa's `closeBundle`
 * hook has already globbed `build/client` to construct the Workbox manifest.
 * The shell therefore did not exist when the manifest was built, `sw.js` was
 * emitted without an `index.html` entry, and
 * `createHandlerBoundToURL('index.html')` threw `non-precached-url` inside the
 * generated worker's AMD promise chain — swallowed, so the worker still
 * installed cleanly while the app was dead offline.
 *
 * The fix belongs at the ordering layer: wrap `buildApp` one level further out
 * than React Router does (this plugin is declared after `reactRouter()`, so its
 * `config` hook runs later and its wrapper ends up outermost) and ask
 * vite-plugin-pwa to regenerate the worker once the shell is on disk. The
 * plugin already generates `sw.js` twice during a build (once per environment
 * `closeBundle`), so a third pass over a ~1 MB output tree is not a new cost —
 * and it is the only pass that sees a complete `build/client`.
 *
 * `build/server` is untouched by this: Workbox globs `globDirectory`, which is
 * pinned to `build/client`. The `rm -rf build/server` at the end of the build
 * script still runs afterwards and is still required.
 */
function pwaAfterSpaPrerender(): Plugin {
  let pwaApi: VitePluginPWAAPI | undefined;

  return {
    name: 'cifra:pwa-after-spa-prerender',
    apply: 'build',
    configResolved(config) {
      pwaApi = config.plugins.find((p) => p.name === 'vite-plugin-pwa')?.api as
        | VitePluginPWAAPI
        | undefined;
    },
    config: {
      order: 'post',
      handler({ builder: { buildApp } = {} }) {
        return {
          builder: {
            async buildApp(builder) {
              // `buildApp` here is React Router's wrapper: every environment
              // build plus the SPA prerender. If this plugin ever ends up
              // ordered ahead of `reactRouter()` the shell will again be
              // missing from the manifest and the assertion below fails the
              // build rather than shipping a broken worker.
              await buildApp?.(builder);
              if (!pwaApi || pwaApi.disabled) return;
              await pwaApi.generateSW();
              assertNavigateFallbackIsPrecached(
                resolve(builder.config.root, CLIENT_OUT_DIR, 'sw.js'),
              );
            },
          },
        };
      },
    },
  };
}

/**
 * Build-time guard for the offline contract. A missing navigation entry is
 * invisible at runtime — Workbox throws `non-precached-url` inside a promise
 * nobody awaits, so the worker installs, `verify` stays green and the app is
 * silently offline-broken. Reading the emitted manifest back and refusing to
 * finish the build turns that into the loudest possible failure, at the only
 * point where it is still cheap to fix.
 */
function assertNavigateFallbackIsPrecached(swPath: string): void {
  let sw: string;
  try {
    sw = readFileSync(swPath, 'utf8');
  } catch (cause) {
    throw new Error(
      `PWA precache guard: no service worker was emitted at ${swPath}.`,
      { cause },
    );
  }

  const entries = sw.match(/precacheAndRoute\(\s*\[([\s\S]*?)\]/)?.[1];
  if (entries === undefined) {
    throw new Error(
      `PWA precache guard: could not read a precacheAndRoute() manifest out of ${swPath}. ` +
        'The generated service worker no longer has the shape this guard understands — ' +
        'update the guard rather than deleting it.',
    );
  }

  const urls = Array.from(entries.matchAll(/url:\s*"([^"]+)"/g), (m) => m[1]);
  if (!urls.includes(NAVIGATE_FALLBACK)) {
    throw new Error(
      `PWA precache guard: the service worker precache manifest is missing "${NAVIGATE_FALLBACK}", ` +
        'the URL its NavigationRoute is bound to. Workbox would throw `non-precached-url` inside ' +
        'the worker (swallowed) and the app would not load offline — FOUN-05. ' +
        `Precached entries were: ${urls.join(', ')}`,
    );
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    VitePWA({
      registerType: 'autoUpdate',
      outDir: CLIENT_OUT_DIR,
      workbox: {
        // Stated explicitly rather than inherited from vite-plugin-pwa's
        // default, because the build-time guard above asserts against this
        // exact URL: the route Workbox falls back to and the entry it must
        // find in the precache have to stay the same string.
        navigateFallback: NAVIGATE_FALLBACK,
        // Workbox's default is `**/*.{js,wasm,css,html}`, which leaves a cold
        // offline load without the favicon and without the Editorial Italiana
        // typefaces. `.woff` is deliberately excluded: every browser that
        // implements service workers has supported WOFF2 for a decade, so the
        // legacy fallbacks would be precached bytes nothing ever reads.
        // `manifest.webmanifest` and the icons under `icons/` are not listed
        // either — vite-plugin-pwa injects those as additional manifest
        // entries from `public/`, and globbing them here would duplicate them.
        globPatterns: ['**/*.{js,wasm,css,html,ico,woff2}'],
      },
      manifest: {
        name: 'Cifra',
        short_name: 'Cifra',
        description: 'Privacy-first personal finance — local, encrypted',
        // Editorial Italiana surface-page cream (--ramp-cream-100). The splash
        // and the browser chrome must match the paper the app is printed on.
        theme_color: '#F5F0E8',
        background_color: '#F5F0E8',
        display: 'standalone',
        start_url: '/',
        // icon.svg is the source of truth for the mark; the PNGs are rasterised
        // from it by `npm run icons` for installers that need bitmaps.
        icons: [
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
    // Must stay after VitePWA(): it reaches for that plugin's api, and its
    // `buildApp` wrapper has to sit outside React Router's prerender wrapper.
    pwaAfterSpaPrerender(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
