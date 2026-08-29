import { expect, test } from '@playwright/test';

/**
 * The Phase 1 success criterion this file guards: the app lands on the styled
 * shell, and the shell's FOUN-09 split is real in a real browser rather than
 * only in Storybook. No auth: there is no Firebase emulator yet (#44), so
 * everything here is reachable without a session.
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
