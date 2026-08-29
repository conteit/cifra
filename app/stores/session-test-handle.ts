/**
 * The name of the `window` property that carries the live session store in
 * development and emulator builds — and in no other build.
 *
 * ## Why a window handle exists at all
 *
 * There is no sign-in UI yet. The sign-in screen is #9 and the lock screen is
 * #10; today `app/root.tsx` merely starts the store observing. So the Playwright
 * spec added by #44 has nothing to click, and without *something* to drive the
 * store from the page, "at least one Playwright spec signs in through the
 * emulator" cannot be satisfied and `docs/architecture.md` §Testing's
 * "vault create → lock → unlock" journey stays unreachable.
 *
 * This is the smallest seam that unblocks it: one property, assigned once, in
 * the composition root, behind the same build-time mode check that gates the
 * emulator itself. It is **not** a general-purpose debug API and nothing in the
 * app may read it.
 *
 * ## Why it cannot reach production
 *
 * `session-instance.ts` assigns it inside `import.meta.env.MODE === 'development'
 * || import.meta.env.MODE === 'emulator'`, which Vite folds to `false` in a
 * production build. `vite.config.ts` then reads the emitted client bundle back
 * and fails `npm run build` if this string survives — the same guard, and the
 * same token list, as the emulator wiring.
 *
 * ## Its expected lifetime
 *
 * Short. Once #9 ships a real sign-in screen the e2e spec should click that
 * instead, and this module and its use in `session-instance.ts` should be
 * deleted in the same PR. A bullet on #9 records that.
 *
 * This module deliberately imports nothing: `vite.config.ts` imports it for the
 * bundle guard, and Vite's forthcoming native config loader warns about every
 * extensionless specifier reachable from the config, transitive ones included.
 */
export const SESSION_TEST_HANDLE = '__cifraSession';
