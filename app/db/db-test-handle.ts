/**
 * The name of the `window` property that carries the db-layer test seam in
 * development and emulator builds — and in no other build.
 *
 * ## Why a window handle exists at all
 *
 * Issue #42, and the Sprint 01 review comment on it: **nothing in the
 * application imports `app/db/` or `app/crypto/`.** There was no vault setup
 * (#9), no lock screen (#10) and no transaction list, so no user-facing code
 * path reached the encryption middleware; the `stories` browser project never
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
 * ## Its expected lifetime — re-justified by #9, not renewed by default
 *
 * #9 was written to delete this. It did not, and the reason is narrower than
 * the bullet that asked for it:
 *
 *   · **What #9 did make real.** `app/crypto` and `app/db` are now reachable
 *     from shipping UI. `test/e2e/auth-emulator.spec.ts` drives Argon2id in a
 *     worker, both AES-KW wraps, the HKDF recovery path and a Dexie read and
 *     write against real IndexedDB — by clicking the vault-setup screen. The
 *     *session* handle #44 added was deleted outright in that change, because
 *     the sign-in screen replaced it completely.
 *   · **What it did not.** The vault lives in `meta`, which the allowlist
 *     marks **plaintext by design** — encrypting the row under the key it is
 *     used to obtain would be circular. So no write through the *encryption
 *     middleware* happens on any user-facing path: the encrypted tables are
 *     `transactions` and `categories`, and Phase 1 ships no screen that writes
 *     either. Deleting this seam today would delete nine browser cases —
 *     the plaintext-leak scan against raw IndexedDB, tamper detection, AAD
 *     re-encryption, the locked-vault path and the transaction-liveness
 *     assertions — and put nothing in their place. D20 forbids exactly that
 *     trade: this is still the only place the middleware runs in a real engine.
 *
 * So the condition is restated rather than dropped: **the first UI that writes
 * an encrypted row retires this.** That is the Phase 3 transaction loop, and it
 * is filed as an issue rather than left as a comment. Nothing else about the
 * seam changes in the meantime — same single gated call site, same bundle
 * guard, same both-directions assertion.
 *
 * The surface is deliberately *not* narrowed now that setup reaches the same
 * crypto through the UI. What keeps this acceptable is that the whole module
 * graph is provably absent from production, not that the object is small; and
 * rewriting the browser spec to build its per-case data keys through
 * `createVault` would pay a full Argon2id derivation per case to change nothing
 * a guard checks.
 *
 * This module deliberately imports nothing: `vite.config.ts` imports it for the
 * bundle guard, and Vite's forthcoming native config loader warns about every
 * extensionless specifier reachable from the config, transitive ones included.
 */
export const DB_TEST_HANDLE = '__cifraDb';
