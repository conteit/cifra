/**
 * The name of the `window` property that carries the db-layer test seam in
 * development and emulator builds — and in no other build.
 *
 * ## Why a window handle exists at all
 *
 * Issue #42, and the Sprint 01 review comment on it: **nothing in the
 * application imports `app/db/` or `app/crypto/`.** There is no vault setup
 * (#9), no lock screen (#10) and no transaction list, so no user-facing code
 * path reaches the encryption middleware; the `stories` browser project never
 * touches it either. The entire encrypted database layer had therefore never
 * executed in a browser, in any test, ever.
 *
 * That is not a cosmetic gap. `app/db/encryption-middleware.ts` needs
 * `Dexie.waitFor` because an IndexedDB transaction commits the moment control
 * returns to the event loop with no request outstanding, and `subtle.encrypt`
 * resolves in a later task (`docs/architecture.md` §Encryption middleware). The
 * evidence that `waitFor` is *sufficient* came only from `fake-indexeddb`,
 * whose scheduler is not a browser's — so if it were insufficient under
 * Chromium, every write would fail and `npm run verify` would stay green,
 * because no test would run the code.
 *
 * This is the smallest seam that lets a Playwright spec drive the real
 * middleware, against real IndexedDB and real Web Crypto: one property, holding
 * the db and crypto layers' own constructors, assigned once, behind the same
 * build-time mode check that gates the Auth emulator. It is **not** a
 * general-purpose debug API and nothing in the app may read it.
 *
 * ## Why it cannot reach production
 *
 * `app/root.tsx` performs a **dynamic** `import()` of `./db/db-test-api` inside
 * `import.meta.env.MODE === 'development' || import.meta.env.MODE ===
 * 'emulator'`, which Vite folds to `false` in a production build. Rollup then
 * drops the branch, the dynamic chunk, and the whole module graph behind it —
 * so production does not merely dead-code an assignment, it never pulls
 * `app/db` (and with it Dexie and hash-wasm) into the bundle at all.
 * `vite.config.ts` reads the emitted client chunks back and fails
 * `npm run build` if this string survives, and fails `npm run build:emulator`
 * if it does not: the same guard, and the same token list, as #44's emulator
 * wiring.
 *
 * ## Its expected lifetime
 *
 * Short. Once #9 and #10 ship a real vault-create / lock / unlock flow, the
 * browser spec should drive *that* and this module, `db-test-api.ts` and the
 * hook in `app/root.tsx` should be deleted in the same PR. A bullet on #9
 * records that.
 *
 * This module deliberately imports nothing: `vite.config.ts` imports it for the
 * bundle guard, and Vite's forthcoming native config loader warns about every
 * extensionless specifier reachable from the config, transitive ones included.
 */
export const DB_TEST_HANDLE = '__cifraDb';
