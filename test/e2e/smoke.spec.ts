import { expect, type Page, test } from '@playwright/test';

import {
  createVaultThroughSetup,
  signInThroughEmulator,
} from './support/journey';

/**
 * The Phase 1 success criterion this file guards: sign-in lands on the styled
 * shell, and the shell's FOUN-09 split is real in a real browser rather than
 * only in Storybook.
 *
 * ## Why this file signs in now
 *
 * Until #9 the app rendered the shell to anybody, so these tests just navigated
 * to `/`. Since #9 the shell is behind a gate — an identity *and* an open vault
 * — which is the product behaviour, so the spec goes through the front door.
 *
 * It pays for that once. Every test below shares **one page**, created and
 * taken through sign-in and vault setup in `beforeAll`, because the emulator's
 * popup dance costs seconds and is the one fragile thing in the suite (#71).
 * `mode: 'serial'` is what makes a shared page legitimate: the tests run in
 * order in one worker, and if the setup fails the rest are skipped rather than
 * failing one by one with the same cause.
 *
 * **Nothing here may reload.** The data key lives in module-scoped memory only
 * (§Session lifetime), so a reload comes back signed in and *locked*, and lands
 * on the unlock screen. Viewport changes do not reload, which is why every test
 * below resizes rather than navigating.
 */

test.describe.configure({ mode: 'serial', retries: 2 });

let page: Page;

test.beforeAll(async ({ browser }) => {
  // 240s, not the 30s default: this beforeAll contains a real Google popup
  // against the Auth emulator and a real Argon2id derivation.
  test.setTimeout(240_000);

  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('/');
  await signInThroughEmulator(page);
  await createVaultThroughSetup(page);
});

test.afterAll(async () => {
  await page.close();
});

/**
 * Drops focus back to the document.
 *
 * The page is shared, so focus survives from one test to the next — and three
 * of the tests below assert on what Tab reaches *from the top of the document*.
 * Without this they would start wherever the previous test left the caret and
 * quietly assert something else.
 */
async function resetFocus(): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}

test('renders the app shell with landmarks and a working skip link', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }),
  ).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();

  // The skip link is the first thing Tab reaches, and it targets <main>.
  await resetFocus();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#main-content');
  await expect(page.getByRole('main')).toHaveAttribute('id', 'main-content');
});

test('shows the sidebar rail at/above 900px and the bottom bar below it', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByTestId('shell-nav-rail')).toBeVisible();
  await expect(page.getByTestId('shell-nav-bar')).toBeHidden();

  await page.setViewportSize({ width: 402, height: 844 });
  await expect(page.getByTestId('shell-nav-bar')).toBeVisible();
  await expect(page.getByTestId('shell-nav-rail')).toBeHidden();
});

/**
 * FOUN-09 is a boundary, not a range: "mobile bottom nav below 900px, desktop
 * sidebar at/above 900px". The test above exercises 1280 and 402 — either side
 * of it, but never the edge itself, so an off-by-one in the media query (`min-
 * width: 901px`, or `max-width: 900px` on the bar) would leave both navs
 * present, or neither, at exactly 900 and stay green. That is review finding
 * C-10.
 *
 * These three cases pin the edge. At each width exactly one arrangement is in
 * the accessibility tree *and* in the tab order — the hidden list is
 * `display: none`, which removes it from both, so asserting on the tab order is
 * what proves it rather than merely that it is not painted.
 */
const BOUNDARY = [
  { width: 899, present: 'shell-nav-bar', absent: 'shell-nav-rail', items: 4 },
  { width: 900, present: 'shell-nav-rail', absent: 'shell-nav-bar', items: 7 },
  { width: 901, present: 'shell-nav-rail', absent: 'shell-nav-bar', items: 7 },
] as const;

for (const { width, present, absent, items } of BOUNDARY) {
  test(`at ${width}px exactly one nav is present: ${present}`, async () => {
    await page.setViewportSize({ width, height: 900 });

    // One landmark, always. What changes is which list lives inside it.
    await expect(page.getByRole('navigation')).toHaveCount(1);

    await expect(page.getByTestId(present)).toBeVisible();
    await expect(page.getByTestId(absent)).toBeHidden();

    // The absent arrangement contributes nothing to the accessibility tree.
    await expect(
      page.locator(`[data-testid="${absent}"] [data-nav-id]:visible`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-testid="${present}"] [data-nav-id]:visible`),
    ).toHaveCount(items);

    // …and nothing to the tab order. Tab from the top of the document; the
    // first nav control focus reaches must belong to the present arrangement,
    // and no control of the absent one may be reached at all.
    const owners = await tabThroughNavOwners();
    expect(owners).toContain(present);
    expect(owners).not.toContain(absent);
  });
}

/**
 * Tabs forward from the top of the document and reports which nav arrangement
 * each focused control belongs to, in order.
 */
async function tabThroughNavOwners(): Promise<string[]> {
  await resetFocus();
  const owners: string[] = [];
  // Enough presses to walk the skip link, the header and every nav control.
  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press('Tab');
    const owner = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const list = active.closest('[data-testid^="shell-nav-"]');
      return list?.getAttribute('data-testid') ?? null;
    });
    if (owner !== null) owners.push(owner);
  }
  return owners;
}

test('reaches every nav destination on mobile, four in the bar and three in the sheet', async () => {
  await page.setViewportSize({ width: 402, height: 844 });

  await expect(
    page.locator('[data-testid="shell-nav-bar"] [data-nav-id]'),
  ).toHaveCount(4);

  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.locator('[data-testid="shell-nav-sheet"] [data-nav-id]'),
  ).toHaveCount(3);
});
