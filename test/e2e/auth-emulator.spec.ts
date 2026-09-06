import { expect, test } from '@playwright/test';

import {
  MASTER_PASSWORD,
  screen,
  signInThroughEmulator,
  TEST_IDENTITY,
} from './support/journey';

/**
 * `docs/architecture.md` §Testing's journey, end to end and for the first time:
 * **sign in → create a vault → lock → unlock**, in a real browser, against a
 * real identity provider, with no secrets and no test seams.
 *
 * ## What changed in #9
 *
 * This spec used to reach into the page and drive the session store through a
 * `window` handle, because #44 shipped emulator sign-in before there was a
 * sign-in screen to click. #9 shipped the screens, so the handle, its module
 * and its entry in `vite.config.ts`'s bundle guard were deleted and every step
 * below is a click on shipping UI. Nothing in the app exists here only to be
 * tested.
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
 * The expensive, fragile part of this file is the emulator's popup sign-in
 * (see `test/e2e/support/journey.ts`); everything after it costs milliseconds.
 * Splitting the vault half into its own spec would pay for the popup dance
 * twice and double the exposure to #71 for no extra coverage, so the journey
 * runs once, in steps.
 *
 * The setup half is written out here rather than delegated to
 * `createVaultThroughSetup`: this is the spec that *specifies* that wizard,
 * including the two refusals — an unticked acknowledgement and a phrase that
 * does not match — that the helper has no reason to walk through.
 */

/**
 * Retries for **this file only**, deliberately not for the suite.
 *
 * Every wait here is on an observable condition rather than a sleep, and the
 * relay-readiness gate in the sign-in helper is sized for a cold browser
 * profile fetching the gapi bootstrap over the public internet. What is left is
 * the possibility of that third-party fetch simply stalling, which nothing on
 * our side can wait out: measured over ~18 consecutive local runs, once.
 *
 * So the flake is retried where it lives instead of turning on `retries` in
 * `playwright.config.ts`, which would let the deterministic specs (the offline
 * contract, the prerendered shell) retry too and quietly hide a real
 * regression. A retried run is reported as flaky, so it stays visible — and #71
 * tracks removing the dependency that makes it necessary.
 */
test.describe.configure({ retries: 2 });

const WRONG_PASSWORD = 'quasi ma non proprio la password';

test('signs in, creates a vault, locks it and unlocks it again', async ({
  page,
}) => {
  // Playwright's 30s default would expire inside the sign-in wait rather than
  // after it, reporting a test timeout instead of the assertion that actually
  // failed. Sized to clear every wait in this journey end to end.
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
    await signInThroughEmulator(page);

    // The gate's whole contract in one assertion: an identity is not an open
    // vault. Sized for the gapi relay described in the sign-in helper, not for
    // a loopback call.
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

    // A near-miss is refused, and the field says so — the message rides the
    // `Input` primitive's own error slot, which is what sets `aria-invalid`
    // and wires the text into `aria-describedby`.
    const field = page.getByTestId('recovery-confirm-input');
    await field.fill('ZZZZ-ZZZZ');
    await page.getByTestId('recovery-confirm').click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(screen(page, 'vault-setup-confirm')).toBeVisible();

    await field.fill(recoveryPhrase);
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
