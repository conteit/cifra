import { expect, type Page, test } from '@playwright/test';

import { SESSION_TEST_HANDLE } from '../../app/stores/session-test-handle';

/**
 * The half of `docs/architecture.md` §Testing's "vault create → lock → unlock"
 * journey that can exist today: **establishing an identity in a real browser**.
 *
 * Before #44 this was impossible. `readFirebaseConfig` needs four
 * `VITE_FIREBASE_*` variables; CI and a fresh clone have none, so the session
 * store went straight to `'unavailable'` and no e2e could get past it. The Auth
 * emulator removes the requirement: it accepts any project id and any API key,
 * so this run needs no secrets and no real Firebase project.
 *
 * What this proves, concretely:
 *
 *   · the emulator wiring in `firebase-auth-port.ts` is live in the served
 *     build — the store resolves to `'signed-out'` rather than `'unavailable'`;
 *   · `signInWithPopup` completes end to end against the emulator, popup and
 *     all, in the same Chromium the rest of the suite uses;
 *   · the identity that lands in the store is the display-level `AuthUser` the
 *     port is supposed to narrow to, and nothing more;
 *   · signing out empties the store again.
 *
 * The vault half — create, lock, unlock — is #9 and #10 and is deliberately not
 * attempted here. This file is what those issues build their journey on top of.
 *
 * ## Why the store is driven through `window`
 *
 * There is no sign-in button yet (#9). `session-test-handle.ts` explains the
 * seam and its expected lifetime; the short version is that it exists only in
 * development and emulator builds and `vite.config.ts` fails the production
 * build if it survives into one.
 *
 * ## Two things this spec must not do
 *
 * 1. **Do not add `page.route` / `context.route` here.** The obvious tidy-up is
 *    to abort the Material and Google Fonts assets the emulator's login widget
 *    pulls from public CDNs. Doing so cost hours: with request interception
 *    enabled, the `https://apis.google.com/js/api.js` load *inside the SDK's
 *    relay iframe* stopped completing — no response, no failure event. That
 *    iframe is how the popup's credential gets back to the opener, so sign-in
 *    hung at `'signing-in'` with no error anywhere, in roughly three runs out of
 *    four. Instrumenting the widget showed it relaying successfully into an
 *    iframe whose document had never parsed.
 * 2. **Do not assume the network is not in the loop.** The identity provider is
 *    local, but the popup→opener relay runs over `gapi.iframes`, whose bootstrap
 *    comes from apis.google.com. The `e2e` CI job therefore needs egress, and
 *    the sign-in wait below is sized for a real round trip rather than a
 *    loopback one.
 */

/**
 * Retries for **this file only**, deliberately not for the suite.
 *
 * Every wait here is on an observable condition rather than a sleep, and the
 * relay-readiness gate below is sized for a cold browser profile fetching the
 * gapi bootstrap over the public internet — several sequential round trips to
 * apis.google.com before the bridge exists. What is left is the possibility of
 * that third-party fetch simply stalling, which nothing on our side can wait
 * out: measured over ~18 consecutive local runs, once.
 *
 * So the flake is retried where it lives instead of turning on `retries` in
 * `playwright.config.ts`, which would let the deterministic specs (the shell,
 * the offline contract) retry too and quietly hide a real regression. A retried
 * run is reported as flaky, so it stays visible — and #71 tracks removing the
 * dependency that makes it necessary.
 */
test.describe.configure({ retries: 2 });

/** Matches `AuthUser` in `app/services/auth/types.ts`. */
interface SessionSnapshot {
  readonly status: string;
  readonly user: {
    readonly uid: string;
    readonly email: string | null;
    readonly displayName: string | null;
    readonly photoURL: string | null;
  } | null;
  readonly error: { readonly code: string } | null;
}

const TEST_IDENTITY = {
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
} as const;

/**
 * Reads the store's state out of the page.
 *
 * Returns `null` while the handle is not there yet — `expect.poll` then keeps
 * waiting instead of failing on the first tick, which matters because the
 * handle is only assigned once React mounts and calls `getSessionStore()`.
 */
async function readSession(page: Page): Promise<SessionSnapshot | null> {
  return page.evaluate((handle) => {
    const store = (globalThis as unknown as Record<string, unknown>)[handle] as
      | { getState(): SessionSnapshot }
      | undefined;
    return store === undefined ? null : store.getState();
  }, SESSION_TEST_HANDLE);
}

const statusOf = async (page: Page): Promise<string | undefined> =>
  (await readSession(page))?.status;

/**
 * Adds a button that calls `signIn()` and clicks it.
 *
 * A real click rather than a bare `page.evaluate`: `signInWithPopup` ends in
 * `window.open`, and Chromium blocks that without transient user activation. A
 * synthetic click carries activation; an evaluated call does not. This is also
 * what #9's sign-in button will do, so the spec is exercising the same shape of
 * call it will later make through real UI.
 */
async function clickSignIn(page: Page): Promise<void> {
  await page.evaluate((handle) => {
    const store = (globalThis as unknown as Record<string, unknown>)[
      handle
    ] as {
      getState(): { signIn(): Promise<void> };
    };
    const button = document.createElement('button');
    button.textContent = 'e2e sign in';
    button.addEventListener('click', () => {
      // Deliberately not awaited: the promise settles only after the popup is
      // driven, which happens further down this test.
      void store.getState().signIn();
    });
    document.body.append(button);
  }, SESSION_TEST_HANDLE);

  await page.getByRole('button', { name: 'e2e sign in' }).click();
}

test('signs in and out through the Firebase Auth emulator', async ({
  page,
}) => {
  // Playwright's 30s default would expire inside the sign-in wait below rather
  // than after it, reporting a test timeout instead of the assertion that
  // actually failed. Sized to clear every wait in this test end to end.
  test.setTimeout(180_000);

  await page.goto('/');

  // 'signed-out', not 'unavailable': the emulator build needs no VITE_FIREBASE_*
  // variables, which is the whole point of #44. If this assertion ever reads
  // 'unavailable' the emulator wiring is dead and everything below would fail
  // for a reason that has nothing to do with sign-in.
  await expect
    .poll(() => statusOf(page), { timeout: 15_000 })
    .toBe('signed-out');

  const popupPromise = page.waitForEvent('popup');
  await clickSignIn(page);
  const popup = await popupPromise;

  // The emulator's IdP login widget. It lists accounts it already knows and
  // offers to invent one; this run always invents, so the test owns its fixture
  // rather than depending on emulator state left behind by an earlier run.
  //
  // The click is retried rather than done once: "Add new account" only reveals
  // the form after the widget's inline script has run, and that script sits
  // behind a parser-blocking `<script src>` on a public CDN. A click that lands
  // first does nothing at all and leaves the form hidden — the first failure
  // this spec hit. `toggleForm` is idempotent, so repeating the click is free.
  await popup.waitForLoadState('domcontentloaded');
  await expect(async () => {
    await popup.locator('#add-account-button').click();
    await expect(popup.locator('#email-input')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });

  // Wait for the relay to be live before submitting anything.
  //
  // Submitting the widget posts the credential to the SDK's helper iframe in the
  // opener, which forwards it over `gapi.iframes`. Until that iframe has loaded
  // gapi and taken hold of its parent container, the forward is a no-op: the
  // widget reports success either way, and the sign-in promise then never
  // settles — no error, no rejection, just `'signing-in'` forever. That was this
  // spec's second failure mode, and it is invisible from the app's side.
  //
  // The popup shares an origin with the helper iframe, so it can read the
  // iframe's `parentContainer` directly; `window.opener.frames` is reachable
  // cross-origin, and the same-origin frames inside it are readable.
  await expect
    .poll(
      () =>
        popup.evaluate(() => {
          const opener = window.opener as Window;
          for (let index = 0; index < opener.frames.length; index += 1) {
            try {
              const frame = opener.frames[index] as unknown as {
                parentContainer?: unknown;
              };
              if (
                typeof frame.parentContainer === 'object' &&
                frame.parentContainer !== null
              ) {
                return true;
              }
            } catch {
              // A cross-origin frame. Not the one we are looking for.
            }
          }
          return false;
        }),
      // Sized for a cold profile on CI, not for a warm laptop. Building the
      // bridge is several sequential fetches from apis.google.com — the SDK's
      // own gapi, then the iframe document, then the iframe's gapi, then
      // `gapi.load('gapi.iframes')` — and at 20s the first attempt of the very
      // first CI run timed out here while the retry (warm) passed in seconds.
      // A gate that only passes on a warm cache is a gate that reports network
      // latency as a product failure.
      { timeout: 60_000 },
    )
    .toBe(true);

  await popup.locator('#email-input').fill(TEST_IDENTITY.email);
  await popup.locator('#display-name-input').fill(TEST_IDENTITY.displayName);
  await popup.locator('#sign-in').click();

  // Sized for the gapi relay described in the file header, not for a loopback
  // call. `expect.poll`'s 5s default is not enough.
  await expect
    .poll(() => statusOf(page), { timeout: 45_000 })
    .toBe('signed-in');

  const session = await readSession(page);
  expect(session?.error).toBeNull();
  expect(session?.user?.email).toBe(TEST_IDENTITY.email);
  expect(session?.user?.displayName).toBe(TEST_IDENTITY.displayName);
  expect(session?.user?.uid).toBeTruthy();

  // The port narrows a Firebase `User` to four display fields. Asserting the
  // exact key set is what keeps a token, a refresh handle or a provider payload
  // from quietly reaching the store — docs/architecture.md §Crypto, key
  // hierarchy step 1: identity "never touches encryption material".
  expect(Object.keys(session?.user ?? {}).sort()).toEqual([
    'displayName',
    'email',
    'photoURL',
    'uid',
  ]);

  await page.evaluate((handle) => {
    const store = (globalThis as unknown as Record<string, unknown>)[
      handle
    ] as {
      getState(): { signOut(): Promise<void> };
    };
    return store.getState().signOut();
  }, SESSION_TEST_HANDLE);

  await expect
    .poll(() => statusOf(page), { timeout: 15_000 })
    .toBe('signed-out');
  expect((await readSession(page))?.user).toBeNull();
});
