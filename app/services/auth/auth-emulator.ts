/**
 * Everything the app needs to talk to the **Firebase Auth emulator**, and
 * nothing that touches the Firebase SDK.
 *
 * ## Why this exists
 *
 * `readFirebaseConfig` (see `firebase-config.ts`) requires four
 * `VITE_FIREBASE_*` variables and, when they are missing, puts the session
 * store into `'unavailable'`. That is correct for production but it made a
 * fresh clone unable to exercise sign-in at all, and it made the
 * `docs/architecture.md` §Testing journey "vault create → lock → unlock"
 * untestable: Playwright had no way to establish an identity. Issue #44.
 *
 * The emulator accepts any project id and any API key, so pointing at it needs
 * no secrets, no `.env` and no real Firebase project. A project id prefixed
 * `demo-` is Firebase's own convention for "this project does not exist and the
 * tooling must never reach production for it" — so even a misconfigured build
 * cannot accidentally talk to a live project with these values.
 *
 * ## Why it is a separate module
 *
 * Two reasons, both mechanical:
 *
 *   1. `firebase-auth-port.ts` is the only module allowed to import the
 *      Firebase SDK (`test/unit/auth-boundary.test.ts`). The `connectAuthEmulator`
 *      call therefore stays there; only the inert constants live here.
 *   2. Everything below is dead code in a production build. Keeping it in its
 *      own module means Rollup drops the whole module once the single `if` in
 *      `firebase-auth-port.ts` folds to `false`, and the build-time guard in
 *      `vite.config.ts` asserts exactly that by looking for
 *      {@link AUTH_EMULATOR_BUILD_MARKER} in the emitted client bundle.
 *
 * This module deliberately **imports nothing**. `vite.config.ts` imports it so
 * the guard checks for the same strings the app emits rather than for retyped
 * copies of them, and Vite's forthcoming native config loader warns about every
 * extensionless specifier reachable from the config — including transitive
 * ones. No imports, no warning, no drift.
 */

/**
 * Vite `--mode` that turns the emulator path on in a *built* bundle.
 *
 * `npm run dev` gets it from mode `development`; `npm run build:emulator` from
 * this mode. `npm run build` (mode `production`) gets it from neither, which is
 * what makes the branch statically dead there.
 *
 * The literal is deliberately repeated at the branch site in
 * `firebase-auth-port.ts` rather than imported: the comparison has to be
 * `import.meta.env.MODE === 'emulator'` in the source text for esbuild to fold
 * it to `false` and for Rollup to then drop this module. Importing a constant
 * would make the fold depend on cross-module constant propagation, which is not
 * a guarantee worth resting the production bundle on. `test/unit/auth-emulator.test.ts`
 * asserts the two spellings agree.
 */
export const AUTH_EMULATOR_MODE = 'emulator';

/**
 * Host and port of the Auth emulator. Must match `firebase.json` — asserted by
 * `test/unit/auth-emulator.test.ts`, because a silent disagreement would look
 * exactly like "sign-in is broken".
 *
 * `127.0.0.1` rather than `localhost`: on a dual-stack machine `localhost` can
 * resolve to `::1` while the emulator binds IPv4 only, which fails as an opaque
 * network error inside the SDK.
 */
export const AUTH_EMULATOR_HOST = '127.0.0.1';
export const AUTH_EMULATOR_PORT = 9099;
export const AUTH_EMULATOR_URL = `http://${AUTH_EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`;

/**
 * A string that exists nowhere else in the tree. `vite.config.ts` fails the
 * production build if it survives into `build/client`, and fails the emulator
 * build if it does *not* — a negative assertion with no positive control is how
 * a guard quietly stops guarding anything.
 */
export const AUTH_EMULATOR_BUILD_MARKER = 'cifra:auth-emulator';

/**
 * The web config used when talking to the emulator. Not credentials, not even
 * public-but-real ones: the emulator validates none of these fields, and the
 * `demo-` project prefix means no live Firebase project answers to them.
 *
 * Not annotated `FirebaseWebConfig` here — see the note above about this module
 * importing nothing. The shape is checked structurally where it is used, in
 * `firebase-auth-port.ts`, and again by `test/unit/auth-emulator.test.ts`.
 */
export const AUTH_EMULATOR_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-cifra.firebaseapp.com',
  projectId: 'demo-cifra',
  appId: '1:000000000000:web:0000000000000000000000',
} as const;
