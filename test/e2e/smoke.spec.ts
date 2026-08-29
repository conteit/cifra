import { expect, type Page, test } from '@playwright/test';

/**
 * The Phase 1 success criterion this file guards: the app lands on the styled
 * shell, and the shell's FOUN-09 split is real in a real browser rather than
 * only in Storybook. No auth: nothing here is gated on a session yet — the
 * sign-in screen is #9 and the route guard is #10. Signing in through the
 * Firebase Auth emulator is covered separately, in `auth-emulator.spec.ts`.
 */

test('renders the app shell with landmarks and a working skip link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }),
  ).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();

  // The skip link is the first thing Tab reaches, and it targets <main>.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#main-content');
  await expect(page.getByRole('main')).toHaveAttribute('id', 'main-content');
});

test('shows the sidebar rail at/above 900px and the bottom bar below it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
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
  test(`at ${width}px exactly one nav is present: ${present}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');

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
    const owners = await tabThroughNavOwners(page);
    expect(owners).toContain(present);
    expect(owners).not.toContain(absent);
  });
}

/**
 * Tabs forward from the top of the document and reports which nav arrangement
 * each focused control belongs to, in order.
 */
async function tabThroughNavOwners(page: Page): Promise<string[]> {
  const owners: string[] = [];
  // Enough presses to walk the skip link, the header and every nav control.
  for (let index = 0; index < 16; index += 1) {
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

test('reaches every nav destination on mobile, four in the bar and three in the sheet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 844 });
  await page.goto('/');

  await expect(
    page.locator('[data-testid="shell-nav-bar"] [data-nav-id]'),
  ).toHaveCount(4);

  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.locator('[data-testid="shell-nav-sheet"] [data-nav-id]'),
  ).toHaveCount(3);
});
