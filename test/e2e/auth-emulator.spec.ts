import { expect, type Page, test } from '@playwright/test';

/**
 * `docs/architecture.md` §Testing's journey, end to end and for the first time:
 * **sign in → create a vault → lock → unlock**, in a real browser, against a
 * real identity provider, with no secrets and no test seams.
 *
 * ## What changed in #9
 *
 * This spec used to reach into the page and drive the session store through
 * `window.__cifraSession`, because #44 shipped emulator sign-in months before
 * there was a sign-in screen to click. #9 shipped the screens, so the handle,
 * its module and its entry in `vite.config.ts`'s bundle guard were deleted and
 * every step below is a click on shipping UI. Nothing in the app exists here
 * only to be tested.
 *
 * One assertion did not survive that trade and was moved rather than dropped:
 * "the identity that lands in the store is the display-level `AuthUser` and
 * nothing more" needed the store handle to read. It now lives in
 * `test/unit/auth-user.test.ts`, over the narrowing function itself — a
 * stronger check, because it runs on every `verify` instead of only when an
 * emulator is up.
 *
 * ## Why it is one long test rather than several
 *
 * The expensive, flaky part of this file is the emulator's popup sign-in (see
 * the two warnings below); everything after it costs milliseconds. Splitting
 * the vault half into its own spec would double the popup dance and double the
 * exposure to #71 for no extra coverage, so the journey runs once, in steps.
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

const TEST_IDENTITY = {
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
} as const;

/** Long enough that nobody is tempted to shorten it; not a real secret. */
const MASTER_PASSWORD = 'un cavallo corretto batteria graffetta';
const WRONG_PASSWORD = 'quasi ma non proprio la password';

/** Which full-page screen the gate is currently rendering. */
const screen = (page: Page, name: string) =>
  page.locator(`[data-screen="${name}"]`);

/**
 * Signs in by clicking the real sign-in button and driving the emulator's IdP
 * widget, exactly as a person would.
 *
 * The click is what makes this work at all: `signInWithPopup` ends in
 * `window.open`, and Chromium blocks that without transient user activation.
 */
async function signIn(page: Page): Promise<void> {
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('sign-in-button').click();
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
  // settles — no error, no rejection, just a button stuck in its busy state.
  // That was this spec's second failure mode, and it is invisible from the
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

test('signs in, creates a vault, locks it and unlocks it again', async ({
  page,
}) => {
  // Playwright's 30s default would expire inside the sign-in wait below rather
  // than after it, reporting a test timeout instead of the assertion that
  // actually failed. Sized to clear every wait in this journey end to end.
  test.setTimeout(240_000);

  let recoveryPhrase = '';

  await test.step('the sign-in screen renders, not the unavailable one', async () => {
    await page.goto('/');
    // `sign-in`, not `sign-in-unavailable`: the emulator build needs no
    // VITE_FIREBASE_* variables, which is the whole point of #44. If this ever
    // resolved to the unavailable screen the emulator wiring would be dead and
    // everything below would fail for a reason unrelated to sign-in.
    await expect(screen(page, 'sign-in')).toBeVisible({ timeout: 15_000 });
    await expect(screen(page, 'sign-in-unavailable')).toHaveCount(0);
  });

  await test.step('signing in leads to vault setup, not to the app', async () => {
    await signIn(page);

    // The gate's whole contract in one assertion: an identity is not an open
    // vault. Sized for the gapi relay described in the file header, not for a
    // loopback call.
    await expect(screen(page, 'vault-setup-password')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('identity-chip')).toHaveCount(0);
  });

  await test.step('a master password creates the vault', async () => {
    await page.getByTestId('master-password').fill(MASTER_PASSWORD);
    await page.getByTestId('master-password-repeat').fill(MASTER_PASSWORD);
    await page.getByTestId('create-vault').click();

    // Argon2id at 64 MiB × 3 in a worker, then two AES-KW wraps and one write.
    await expect(screen(page, 'vault-setup-phrase')).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('the recovery phrase is shown once and typed back', async () => {
    recoveryPhrase = (
      await page.getByTestId('recovery-phrase').innerText()
    ).trim();
    // 8 groups of 4 Crockford symbols (D26). Asserted so a phrase that came
    // back empty cannot make the confirmation step below pass vacuously.
    expect(recoveryPhrase).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);

    // The acknowledgement gates the step: nobody clicks past a phrase they
    // never recorded.
    await expect(page.getByTestId('recovery-continue')).toBeDisabled();
    await page.getByTestId('recovery-ack').check();
    await page.getByTestId('recovery-continue').click();

    await expect(screen(page, 'vault-setup-confirm')).toBeVisible();

    // A near-miss is refused. Crockford folds I/L/O/U on read, so the wrong
    // copy here is a genuinely different phrase rather than a confusable of the
    // right one.
    await page.getByTestId('recovery-confirm-input').fill('ZZZZ-ZZZZ');
    await page.getByTestId('recovery-confirm').click();
    await expect(page.getByTestId('screen-error')).toBeVisible();
    await expect(screen(page, 'vault-setup-confirm')).toBeVisible();

    await page.getByTestId('recovery-confirm-input').fill(recoveryPhrase);
    await page.getByTestId('recovery-confirm').click();
    await expect(screen(page, 'vault-setup-done')).toBeVisible();
  });

  await test.step('finishing setup lands on the app shell', async () => {
    await page.getByTestId('setup-finish').click();

    await expect(page.getByTestId('identity-chip')).toBeVisible();
    await expect(page.getByTestId('identity-chip')).toContainText(
      TEST_IDENTITY.displayName,
    );
    // The overview, inside the shell — the destination the roadmap's Phase 1
    // success criterion names.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('lock-vault')).toBeVisible();
  });

  await test.step('locking closes the vault but not the session', async () => {
    await page.getByTestId('lock-vault').click();

    await expect(screen(page, 'vault-unlock')).toBeVisible();
    // Still signed in — a locked vault is not a signed-out user. If this ever
    // showed the sign-in screen the two stores would have been collapsed into
    // one and the lock screen would have nothing to be.
    await expect(screen(page, 'sign-in')).toHaveCount(0);
  });

  await test.step('the wrong password is refused, the right one opens it', async () => {
    await page.getByTestId('unlock-password').fill(WRONG_PASSWORD);
    await page.getByTestId('unlock').click();
    await expect(page.getByTestId('screen-error')).toBeVisible({
      timeout: 30_000,
    });
    await expect(screen(page, 'vault-unlock')).toBeVisible();

    await page.getByTestId('unlock-password').fill(MASTER_PASSWORD);
    await page.getByTestId('unlock').click();
    await expect(page.getByTestId('identity-chip')).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('the recovery phrase opens the same vault', async () => {
    // D26's whole point: a forgotten master password costs the password, not
    // the vault. The phrase written down at setup — never read back from
    // storage, because nothing can read it back — opens the same data key.
    await page.getByTestId('lock-vault').click();
    await expect(screen(page, 'vault-unlock')).toBeVisible();

    await page.getByTestId('unlock-toggle-mode').click();
    await expect(screen(page, 'vault-unlock-recovery')).toBeVisible();

    await page.getByTestId('recovery-input').fill(recoveryPhrase);
    await page.getByTestId('unlock').click();
    await expect(page.getByTestId('identity-chip')).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('signing out returns to the sign-in screen', async () => {
    await page.getByTestId('sign-out').click();
    await expect(screen(page, 'sign-in')).toBeVisible({ timeout: 30_000 });
  });
});
