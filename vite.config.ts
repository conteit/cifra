import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { type VitePluginPWAAPI, VitePWA } from 'vite-plugin-pwa';

// Explicit `.ts`: this is one of the few specifiers Vite's config loader has to
// resolve itself, and its forthcoming native loader cannot infer the extension.
// `allowImportingTsExtensions` in tsconfig.json exists for this import and no
// other — which is also why `auth-emulator.ts` itself imports nothing.
import {
  AUTH_EMULATOR_BUILD_MARKER,
  AUTH_EMULATOR_CONFIG,
  AUTH_EMULATOR_MODE,
  AUTH_EMULATOR_URL,
} from './app/services/auth/auth-emulator.ts';
import { SESSION_TEST_HANDLE } from './app/stores/session-test-handle.ts';

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

/**
 * Every string that only exists in the tree because of the Auth emulator path,
 * including the `window` handle the e2e sign-in spec drives the store through.
 *
 * They are imported from the app's own modules rather than retyped here, so a
 * rename cannot leave the guard checking for a token nothing emits any more —
 * which is the failure mode that makes a negative assertion quietly vacuous.
 */
const AUTH_EMULATOR_TOKENS: readonly string[] = [
  AUTH_EMULATOR_BUILD_MARKER,
  AUTH_EMULATOR_URL,
  AUTH_EMULATOR_CONFIG.projectId,
  SESSION_TEST_HANDLE,
];

/**
 * Deliberately *not* in the list above: `connectAuthEmulator`.
 *
 * It looked like the obvious token, and it is absent from a production build —
 * but it is absent from an emulator build too, because the minifier renames the
 * imported binding. Its absence would therefore have proved nothing at all,
 * while reading like the strongest check in the file. The tokens that remain are
 * all string *literals*, which survive minification, and every one of them is
 * reachable only from inside the emulator branch — so their absence is what
 * proves the branch (and the `connectAuthEmulator` call inside it) was dropped.
 */

/**
 * Proves — rather than assumes — which side of the emulator switch a build
 * came out on, by reading the emitted client chunks back.
 *
 * Issue #44 asks for exactly this: "the production bundle must not carry an
 * emulator code path a runtime value can switch on — assert this, do not assume
 * it". `firebase-auth-port.ts` gates the emulator on `import.meta.env.MODE`,
 * which Vite substitutes with a string literal at build time; esbuild then folds
 * the comparison and Rollup deletes the branch and the `./auth-emulator` module
 * behind it. That chain is four tools deep and none of them promise it in
 * writing, so the outcome is checked instead of trusted.
 *
 * Both directions are asserted, because a negative check alone rots into a
 * tautology the moment the tokens stop being emitted for an unrelated reason:
 *
 *   · production build → every token must be **absent**;
 *   · emulator build   → every token must be **present**.
 *
 * Modelled on `assertNavigateFallbackIsPrecached` above: fail the build at the
 * only point where the mistake is still cheap, rather than shipping and hoping
 * someone opens DevTools.
 */
function authEmulatorBundleGuard(useEmulator: boolean): Plugin {
  return {
    name: 'cifra:auth-emulator-bundle-guard',
    apply: 'build',
    writeBundle(options, bundle) {
      // React Router builds two environments; `build/server` is deleted by the
      // build script and never shipped, so only the client output is judged.
      if (options.dir === undefined) return;
      if (resolve(options.dir) !== resolve(process.cwd(), CLIENT_OUT_DIR)) {
        return;
      }

      const code = Object.values(bundle)
        .map((output) => (output.type === 'chunk' ? output.code : ''))
        .join('\n');

      const present = AUTH_EMULATOR_TOKENS.filter((token) =>
        code.includes(token),
      );
      const absent = AUTH_EMULATOR_TOKENS.filter(
        (token) => !code.includes(token),
      );

      if (!useEmulator && present.length > 0) {
        throw new Error(
          'Auth emulator guard: a production build must not contain the Firebase Auth ' +
            `emulator path, but ${CLIENT_OUT_DIR} still mentions ${present.join(', ')}. ` +
            'Something made the branch in app/services/auth/firebase-auth-port.ts ' +
            'un-foldable — most likely the `import.meta.env.MODE === …` comparison was ' +
            'replaced by a value the bundler cannot resolve at build time. Shipping this ' +
            'would put an emulator code path in front of real users. See issue #44.',
        );
      }

      if (useEmulator && absent.length > 0) {
        throw new Error(
          `Auth emulator guard: a --mode ${AUTH_EMULATOR_MODE} build must contain the ` +
            `Firebase Auth emulator path, but ${CLIENT_OUT_DIR} is missing ${absent.join(', ')}. ` +
            'The e2e sign-in spec would fail against a real Firebase project it has no ' +
            'credentials for, and the production half of this guard would be asserting ' +
            'nothing. See issue #44.',
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Kept in one place: the branch in `firebase-auth-port.ts` tests the same two
  // modes, and `test/unit/auth-emulator.test.ts` asserts the two agree.
  const useAuthEmulator = mode === 'development' || mode === AUTH_EMULATOR_MODE;

  return {
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
      authEmulatorBundleGuard(useAuthEmulator),
    ],
    resolve: {
      tsconfigPaths: true,
    },
  };
});
