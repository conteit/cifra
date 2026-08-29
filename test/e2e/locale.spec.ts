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
 */

const CASES = [
  {
    tag: 'it-IT',
    lang: 'it',
    heading: 'Panoramica',
    welcome: 'Le tue finanze, pronte a iniziare',
    navLabel: 'Navigazione principale',
  },
  {
    // Region is irrelevant: one Italian translation, not one per region.
    tag: 'it-CH',
    lang: 'it',
    heading: 'Panoramica',
    welcome: 'Le tue finanze, pronte a iniziare',
    navLabel: 'Navigazione principale',
  },
  {
    tag: 'en-GB',
    lang: 'en',
    heading: 'Overview',
    welcome: 'Your finances, ready to begin',
    navLabel: 'Main navigation',
  },
  {
    // The documented fallback. A language the app does not ship gets English,
    // not a blank screen and not Italian.
    tag: 'fr-FR',
    lang: 'en',
    heading: 'Overview',
    welcome: 'Your finances, ready to begin',
    navLabel: 'Main navigation',
  },
] as const;

for (const { tag, lang, heading, welcome, navLabel } of CASES) {
  test.describe(`browser locale ${tag}`, () => {
    test.use({ locale: tag });

    test(`renders in ${lang} and declares lang="${lang}"`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');

      // Non-vacuity: if the context option ever stopped reaching the page, the
      // assertions below would pass for the wrong reason on every English case.
      await expect
        .poll(() => page.evaluate(() => navigator.language))
        .toBe(tag);

      await expect(page.locator('html')).toHaveAttribute('lang', lang);

      // Shell copy (from the layout route) and page copy (from the page).
      await expect(
        page.getByRole('heading', { level: 1, name: heading }),
      ).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: navLabel }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 2, name: welcome }),
      ).toBeVisible();
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
