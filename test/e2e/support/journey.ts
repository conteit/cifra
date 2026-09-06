import { expect, type Page } from '@playwright/test';

/**
 * Getting into the app, by clicking the app.
 *
 * Since #9 the shell is behind a gate: an identity **and** an open vault. Every
 * spec that asserts something about a page therefore has to get through
 * sign-in and vault setup first, and does it the way a person would — there is
 * no test seam any more, because the screens replaced the one #44 added.
 *
 * Shared rather than copied because the emulator's popup dance is the one
 * fragile thing in the whole suite (see `signInThroughEmulator` below and #71),
 * and two divergent copies of it would be two things to keep working.
 *
 * ## Cost, and how specs are expected to pay it
 *
 * One trip through here is a real Google popup against the Auth emulator plus a
 * real Argon2id derivation. That is seconds, not milliseconds, so a spec that
 * needs the shell should run **serially over one shared page** and come through
 * here once in `beforeAll` — not once per test. `test/e2e/smoke.spec.ts` is the
 * worked example.
 *
 * Note that a reload costs the vault: the data key lives in module-scoped
 * memory only (§Session lifetime), so a page that reloads comes back *signed in
 * and locked* and lands on the unlock screen. That is correct behaviour, and
 * it is why the specs below navigate once.
 */

/** The identity every spec invents for itself. Never a real account. */
export const TEST_IDENTITY = {
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
} as const;

/** Long enough to clear the setup screen's floor; not a secret. */
export const MASTER_PASSWORD = 'un cavallo corretto batteria graffetta';

/** Which full-page screen the gate is currently rendering. */
export const screen = (page: Page, name: string) =>
  page.locator(`[data-screen="${name}"]`);

/**
 * Signs in by clicking the real sign-in button and driving the emulator's IdP
 * widget, exactly as a person would.
 *
 * The click is what makes this work at all: `signInWithPopup` ends in
 * `window.open`, and Chromium blocks that without transient user activation.
 *
 * ## Two things this helper must not do
 *
 * 1. **Do not add `page.route` / `context.route`.** The obvious tidy-up is to
 *    abort the Material and Google Fonts assets the emulator's login widget
 *    pulls from public CDNs. Doing so cost hours: with request interception
 *    enabled, the `https://apis.google.com/js/api.js` load *inside the SDK's
 *    relay iframe* stopped completing — no response, no failure event. That
 *    iframe is how the popup's credential gets back to the opener, so sign-in
 *    hung with no error anywhere, in roughly three runs out of four.
 * 2. **Do not assume the network is out of the loop.** The identity provider is
 *    local, but the popup→opener relay runs over `gapi.iframes`, whose
 *    bootstrap comes from apis.google.com. The `e2e` CI job therefore needs
 *    egress, and the waits below are sized for a real round trip.
 */
export async function signInThroughEmulator(page: Page): Promise<void> {
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('sign-in-button').click();
  const popup = await popupPromise;

  // The emulator's IdP login widget. It lists accounts it already knows and
  // offers to invent one; every run invents, so a spec owns its fixture rather
  // than depending on emulator state left behind by an earlier one.
  //
  // The click is retried rather than done once: "Add new account" only reveals
  // the form after the widget's inline script has run, and that script sits
  // behind a parser-blocking `<script src>` on a public CDN. A click that lands
  // first does nothing at all and leaves the form hidden — the first failure
  // this dance hit. `toggleForm` is idempotent, so repeating the click is free.
  await popup.waitForLoadState('domcontentloaded');
  await expect(async () => {
    await popup.locator('#add-account-button').click();
    await expect(popup.locator('#email-input')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });

  // Wait for the relay to be live before submitting anything.
  //
  // Submitting the widget posts the credential to the SDK's helper iframe in
  // the opener, which forwards it over `gapi.iframes`. Until that iframe has
  // loaded gapi and taken hold of its parent container, the forward is a no-op:
  // the widget reports success either way, and the sign-in promise then never
  // settles — no error, no rejection, just a button stuck in its busy state.
  // That was this dance's second failure mode, and it is invisible from the
  // app's side.
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
}

/**
 * Walks the whole vault-setup wizard and lands on the app shell.
 *
 * Returns the recovery phrase, which is the only copy that will ever exist:
 * `createVault` returns it once and nothing can read it back out of a vault
 * (D26). A spec that wants to unlock by phrase later must keep what it gets
 * here.
 */
export async function createVaultThroughSetup(
  page: Page,
  password: string = MASTER_PASSWORD,
): Promise<string> {
  await expect(screen(page, 'vault-setup-password')).toBeVisible({
    timeout: 60_000,
  });

  await page.getByTestId('master-password').fill(password);
  await page.getByTestId('master-password-repeat').fill(password);
  await page.getByTestId('create-vault').click();

  // Argon2id at 64 MiB × 3 in a worker, then two AES-KW wraps and one write.
  await expect(screen(page, 'vault-setup-phrase')).toBeVisible({
    timeout: 30_000,
  });

  const phrase = (await page.getByTestId('recovery-phrase').innerText()).trim();

  await page.getByTestId('recovery-ack').check();
  await page.getByTestId('recovery-continue').click();
  await page.getByTestId('recovery-confirm-input').fill(phrase);
  await page.getByTestId('recovery-confirm').click();
  await page.getByTestId('setup-finish').click();

  await expect(page.getByTestId('identity-chip')).toBeVisible();
  return phrase;
}
