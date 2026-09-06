import { expect, test } from '@playwright/test';

/**
 * FOUN-07 in a real browser: the UI comes up in the language the browser asks
 * for, and `<html lang>` says so.
 *
 * Unit tests pin the detection *rule* (`test/unit/i18n-locale.test.ts`) and the
 * delivery *boundary* (`test/unit/locale-boundary.test.ts`). Neither can see
 * the two things that only exist at runtime: that a page really reads the
 * store, and that the prerendered `lang="en"` — baked into the one static HTML
 * file a pure SPA serves every visitor — is corrected once the app hydrates.
 * Both were broken before #47 and neither would have failed a test.
 *
 * ## Why this asserts on the sign-in screen since #9
 *
 * It used to assert on the app shell and the overview page, which every
 * visitor saw immediately. They no longer do: the shell is behind a gate now,
 * and **the sign-in screen is what a visitor is actually served in their own
 * language**. Testing that is closer to the requirement, not further from it —
 * and it keeps this spec free of the emulator's popup dance, so four browser
 * locales cost four page loads rather than four sign-ins. The shell's own copy
 * delivery is exercised past the gate in `smoke.spec.ts`, through the same
 * route -> store -> component path.
 */

const CASES = [
  {
    tag: 'it-IT',
    lang: 'it',
    tagline: 'I tuoi soldi,',
    title: 'Benvenuto',
    button: 'Continua con Google',
  },
  {
    // Region is irrelevant: one Italian translation, not one per region.
    tag: 'it-CH',
    lang: 'it',
    tagline: 'I tuoi soldi,',
    title: 'Benvenuto',
    button: 'Continua con Google',
  },
  {
    tag: 'en-GB',
    lang: 'en',
    tagline: 'Your money,',
    title: 'Welcome',
    button: 'Continue with Google',
  },
  {
    // The documented fallback. A language the app does not ship gets English,
    // not a blank screen and not Italian.
    tag: 'fr-FR',
    lang: 'en',
    tagline: 'Your money,',
    title: 'Welcome',
    button: 'Continue with Google',
  },
] as const;

for (const { tag, lang, tagline, title, button } of CASES) {
  test.describe(`browser locale ${tag}`, () => {
    test.use({ locale: tag });

    test(`renders in ${lang} and declares lang="${lang}"`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');

      await expect(page.locator('[data-screen="sign-in"]')).toBeVisible({
        timeout: 15_000,
      });

      // Non-vacuity: if the context option ever stopped reaching the page, the
      // assertions below would pass for the wrong reason on every English case.
      await expect
        .poll(() => page.evaluate(() => navigator.language))
        .toBe(tag);

      await expect(page.locator('html')).toHaveAttribute('lang', lang);

      // The app's signature, its heading, and the one control on the screen —
      // three separate strings from the same table, so a partially translated
      // render fails rather than passing on whichever one was checked.
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        tagline,
      );
      await expect(
        page.getByRole('heading', { level: 2, name: title }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: button })).toBeVisible();
    });
  });
}

/**
 * What a visitor is served before any JavaScript runs.
 *
 * `ssr: false` means one prerendered `index.html` for everybody, built in Node
 * where no browser preference exists. It must therefore declare the default
 * locale — and it must be wordless, which is what makes that honest: the
 * document is only ever `lang="en"` while it contains no copy in any language.
 * If a future change starts prerendering page content, this fails and the
 * `<html lang>` strategy has to be revisited rather than quietly becoming a
 * lie.
 */
test('the prerendered shell declares the default locale and carries no copy', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();

  expect(html).toContain('<html lang="en">');
  for (const phrase of [
    // The sign-in screen, which is what a visitor now sees first…
    'Benvenuto',
    'Welcome',
    'I tuoi soldi',
    'Your money',
    'Continua con Google',
    'Continue with Google',
    // …and the shell and overview behind it.
    'Panoramica',
    'Overview',
    'Le tue finanze',
    'Your finances',
    'Navigazione principale',
    'Main navigation',
  ]) {
    expect(html, `prerendered shell contains "${phrase}"`).not.toContain(
      phrase,
    );
  }
});
