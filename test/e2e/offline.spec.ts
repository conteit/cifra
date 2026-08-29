import { expect, type Page, test } from '@playwright/test';

/**
 * FOUN-05 — "app works offline after first load (service worker + Workbox)",
 * and a Phase 1 success criterion in `docs/architecture.md` §Roadmap.
 *
 * This file exists because the requirement was asserted as delivered and was
 * false: React Router prerenders the SPA shell *after* vite-plugin-pwa has
 * globbed `build/client` for the Workbox precache manifest, so `index.html`
 * was never precached, `createHandlerBoundToURL('index.html')` threw
 * `non-precached-url` inside the worker's promise chain (swallowed), and the
 * app died offline while `npm run verify` stayed green.
 *
 * These tests exercise the requirement itself rather than a proxy for it:
 * a real Chromium, a real registered worker, the network genuinely cut, and a
 * real navigation. `vite.config.ts` carries the complementary build-time guard
 * that reads the emitted manifest back.
 */

/**
 * Resolves once the worker controls the page. `sw.js` calls `clientsClaim()`,
 * which only fires on activation, and activation only happens once the install
 * step resolves — so a non-null controller is proof that the precache has been
 * written, not merely that a registration exists.
 */
async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    {
      timeout: 30_000,
    },
  );
}

test('reloads the app shell from the precache with the network cut', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview' }),
  ).toBeVisible();
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  try {
    await page.reload();

    // Nothing can come off the network now, so anything that renders came out
    // of the Workbox precache — including the shell itself, which is reached
    // through the NavigationRoute because "/" is precached as "index.html".
    await expect(
      page.getByRole('heading', { level: 1, name: 'Overview' }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('answers an offline deep link with the app, not the browser error page', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  try {
    // `/goals` is a Phase 2–9 destination with no route registered yet, so the
    // app answers it with its own 404 boundary. That is the point: the URL is
    // not a precached document, so serving anything at all proves the
    // NavigationRoute is bound to a precached shell rather than throwing
    // `non-precached-url` and falling through to the network.
    await page.goto('/goals');
    await expect(
      page.getByRole('heading', { level: 1, name: '404' }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
