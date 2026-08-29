import type { Meta, StoryObj } from '@storybook/react-vite';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { expect, userEvent, within } from 'storybook/test';
import { stringsFor } from '../app/i18n';
import {
  AppShell,
  MAIN_CONTENT_ID,
  type ShellStrings,
} from '../app/shell/app-shell';
import { type NavItem, navItems } from '../app/shell/nav-items';
import { Button } from '../app/ui/button';
import { Card } from '../app/ui/card';
import { type Bilingual, type Locale, localeFrom } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   App shell — the header, nav and responsive frame every page mounts inside.

   FOUN-09 is the spec: mobile bottom bar below 900px, desktop sidebar at and
   above. There is one `<nav>` landmark and one item table (`nav-items.ts`);
   the rail and the bar are two arrangements of it, and `display: none` keeps
   exactly one of them in the accessibility tree and the tab order at any
   viewport. The stories below assert that at both viewports rather than
   trusting the class names.

   The shell is rendered against a *mocked* router (`createMemoryRouter`) that
   registers a page for all seven destinations, which is what lets the
   `…RoutesLive` stories show the active/hover states of destinations Phase 2–9
   still owes. The default stories use the real `navItems` table, where only
   Overview is routed today and the other six render as disabled "soon" items.
   ═══════════════════════════════════════════════════════════════════════════ */

const copy = {
  subtitle: { en: 'March 2026', it: 'Marzo 2026' },
  action: { en: 'Scan receipt', it: 'Scansiona scontrino' },
  signedInAs: { en: 'Signed in', it: 'Accesso eseguito' },
  pageNote: {
    en: 'The page owns this card and nothing else — heading, nav and frame belong to the shell.',
    it: 'La pagina possiede solo questa scheda — titolo, navigazione e struttura appartengono alla shell.',
  },
} satisfies Record<string, Bilingual>;

/**
 * The shell's copy for a locale — the app's own resolver, not a story-local
 * copy of it. Both string tables are typed `Strings`, so either satisfies
 * `ShellStrings` structurally and the workbench renders exactly the object
 * `app/routes/app-layout.tsx` passes at runtime (#47).
 */
function shellStrings(locale: Locale): ShellStrings {
  return stringsFor(locale);
}

/** The nav table as it will look once every phase has landed its routes. */
const allRoutesLive: readonly NavItem[] = navItems.map((item) => ({
  ...item,
  status: 'live' as const,
}));

/** Stand-in page content, so the frame has something real to frame. */
function MockPage({ locale, heading }: { locale: Locale; heading: string }) {
  return (
    <Card as="section" className="max-w-page">
      <h2 className="font-display text-stat text-text-primary">{heading}</h2>
      <p className="mt-6 font-body text-body text-text-secondary">
        {copy.pageNote[locale]}
      </p>
    </Card>
  );
}

/** The identity slot's future occupant (#9), mocked as a plain chip. */
function IdentityChip({ locale }: { locale: Locale }) {
  return (
    <span className="rounded-pill border border-rule bg-surface-inset px-6 py-3 font-mono text-label-sm uppercase text-text-secondary">
      {copy.signedInAs[locale]}
    </span>
  );
}

type HarnessProps = {
  locale: Locale;
  items?: readonly NavItem[];
  initialPath?: string;
  subtitle?: string;
  withIdentity?: boolean;
  withActions?: boolean;
};

/**
 * Mounts the shell exactly the way `app/routes.ts` does — a pathless layout
 * route wrapping an index route — but over an in-memory router with a page
 * registered for every nav destination.
 */
function Harness({
  locale,
  items = navItems,
  initialPath = '/',
  subtitle,
  withIdentity = false,
  withActions = false,
}: HarnessProps) {
  const strings = shellStrings(locale);

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <AppShell
            strings={strings}
            items={items}
            subtitle={subtitle}
            identity={withIdentity ? <IdentityChip locale={locale} /> : null}
            actions={
              withActions ? (
                <Button variant="secondary">{copy.action[locale]}</Button>
              ) : null
            }
          >
            <Outlet />
          </AppShell>
        ),
        children: [
          {
            index: true,
            element: (
              <MockPage locale={locale} heading={strings.nav_overview} />
            ),
          },
          ...items
            .filter((item) => item.to !== '/')
            .map((item) => ({
              path: item.to.slice(1),
              element: (
                <MockPage locale={locale} heading={strings[item.labelKey]} />
              ),
            })),
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );

  return <RouterProvider router={router} />;
}

const meta = {
  title: 'App/Shell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  args: { strings: shellStrings('en'), children: null },
} satisfies Meta<typeof AppShell>;

export default meta;

type Story = StoryObj<typeof meta>;

/* ── Helpers shared by the play functions ───────────────────────────────── */

function rail(canvasElement: HTMLElement): HTMLElement {
  const el = canvasElement.querySelector<HTMLElement>(
    '[data-testid="shell-nav-rail"]',
  );
  if (!el) throw new Error('the desktop rail is missing from the shell');
  return el;
}

function bar(canvasElement: HTMLElement): HTMLElement {
  const el = canvasElement.querySelector<HTMLElement>(
    '[data-testid="shell-nav-bar"]',
  );
  if (!el) throw new Error('the mobile bottom bar is missing from the shell');
  return el;
}

function displayOf(el: HTMLElement): string {
  return getComputedStyle(el).display;
}

/**
 * The nav-item ids inside a container, in DOM order. Compares arrangements by
 * *identity* rather than by rendered text, which carries decorative glyphs and
 * the "soon" marker.
 */
function navIdsIn(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll<HTMLElement>('[data-nav-id]')).map(
    (node) => node.dataset.navId ?? '',
  );
}

/**
 * Landmarks, skip link and focus order — the same contract at every viewport,
 * so every arrangement story runs it.
 */
async function assertShellA11y(canvasElement: HTMLElement, locale: Locale) {
  const canvas = within(canvasElement);
  const strings = shellStrings(locale);

  // Exactly one of each landmark, and the nav is named.
  await expect(canvas.getAllByRole('banner')).toHaveLength(1);
  await expect(canvas.getAllByRole('main')).toHaveLength(1);
  await expect(
    canvas.getAllByRole('navigation', { name: strings.shell_nav_label }),
  ).toHaveLength(1);

  // The skip link is the first focusable element in the document, and it
  // targets the <main> element, which is focusable so focus really lands.
  const skip = canvas.getByRole('link', {
    name: strings.shell_skip_to_content,
  });
  const focusables = Array.from(
    canvasElement.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  );
  await expect(focusables[0]).toBe(skip);
  await expect(skip.getAttribute('href')).toBe(`#${MAIN_CONTENT_ID}`);

  const main = canvas.getByRole('main');
  await expect(main.id).toBe(MAIN_CONTENT_ID);
  await expect(main.tabIndex).toBe(-1);

  // …and Tab really reaches it first.
  await userEvent.tab();
  await expect(canvasElement.ownerDocument.activeElement).toBe(skip);
}

/* ── Desktop: the 206px sidebar rail, all seven destinations ────────────── */

export const Desktop: Story = {
  render: (_args, ctx) => <Harness locale={localeFrom(ctx.globals)} />,
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    await assertShellA11y(canvasElement, locale);

    // FOUN-09: at/above 900px the rail is the nav and the bar is gone.
    await expect(displayOf(rail(canvasElement))).not.toBe('none');
    await expect(displayOf(bar(canvasElement))).toBe('none');

    // All seven destinations are present in the rail, in table order.
    await expect(navIdsIn(rail(canvasElement))).toEqual(
      navItems.map((item) => item.id),
    );

    // Overview is the only routed destination today, and it is the active one.
    const canvas = within(canvasElement);
    const overview = canvas.getByRole('link', {
      name: shellStrings(locale).nav_overview,
    });
    await expect(overview).toHaveAttribute('aria-current', 'page');
    // The other six are disabled controls, not links that go nowhere.
    await expect(canvas.getAllByRole('link')).toHaveLength(2); // skip link + Overview
  },
};

export const DesktopItalian: Story = {
  globals: { locale: 'it' },
  render: (_args, ctx) => <Harness locale={localeFrom(ctx.globals)} />,
  play: async ({ canvasElement, globals }) => {
    await assertShellA11y(canvasElement, localeFrom(globals));
    await expect(displayOf(rail(canvasElement))).not.toBe('none');
  },
};

/** Header slots: the identity chip (#9's seam), a page action, and a subtitle. */
export const DesktopWithHeaderSlots: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Harness
        locale={locale}
        subtitle={copy.subtitle[locale]}
        withIdentity
        withActions
      />
    );
  },
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);
    await expect(canvas.getByText(copy.subtitle[locale])).toBeVisible();
    await expect(canvas.getByText(copy.signedInAs[locale])).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: copy.action[locale] }),
    ).toBeVisible();
  },
};

/* ── Mobile: the bottom bar, four slots plus the overflow control ───────── */

export const Mobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => <Harness locale={localeFrom(ctx.globals)} />,
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    await assertShellA11y(canvasElement, locale);

    // FOUN-09: below 900px the rail is gone and the bar is the nav.
    await expect(displayOf(rail(canvasElement))).toBe('none');
    await expect(displayOf(bar(canvasElement))).not.toBe('none');

    // Four primary slots — v1's leading four — plus the "More" control.
    await expect(navIdsIn(bar(canvasElement))).toEqual([
      'overview',
      'transactions',
      'track',
      'wallet',
    ]);

    const canvas = within(canvasElement);
    const strings = shellStrings(locale);
    await expect(
      canvas.getByRole('link', { name: strings.nav_overview }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      canvas.getByRole('button', { name: strings.shell_more }),
    ).toHaveAttribute('aria-expanded', 'false');
  },
};

export const MobileItalian: Story = {
  globals: { viewport: { value: 'mobile' }, locale: 'it' },
  render: (_args, ctx) => <Harness locale={localeFrom(ctx.globals)} />,
  play: async ({ canvasElement, globals }) => {
    await assertShellA11y(canvasElement, localeFrom(globals));
    await expect(displayOf(bar(canvasElement))).not.toBe('none');
  },
};

/**
 * The overflow sheet is what keeps FOUN-09 honest: everything the bar cannot
 * fit is still reachable on mobile. v1 simply dropped Goals and Import from
 * the phone (`[...PAGES.slice(0,4), account]`); we spend the fifth slot on the
 * sheet instead, so the two arrangements offer the same seven destinations.
 */
export const MobileOverflowSheet: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => <Harness locale={localeFrom(ctx.globals)} />,
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const strings = shellStrings(locale);
    const canvas = within(canvasElement);

    const more = canvas.getByRole('button', { name: strings.shell_more });
    await userEvent.click(more);

    const dialog = await canvas.findByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');

    const sheetIds = navIdsIn(dialog as HTMLElement);
    await expect(sheetIds).toEqual(['goals', 'import', 'account']);

    // The bar plus the sheet cover exactly what the desktop rail covers:
    // nothing is reachable at one breakpoint and not the other (FOUN-09).
    const reachableOnMobile = [
      ...navIdsIn(bar(canvasElement)),
      ...sheetIds,
    ].sort();
    await expect(reachableOnMobile).toEqual(
      navIdsIn(rail(canvasElement)).sort(),
    );

    // The sheet is a real modal dialog, so Escape closes it and focus returns.
    await userEvent.keyboard('{Escape}');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  },
};

/* ── Every destination routed: the shell once Phases 2–9 have landed ────── */

export const DesktopRoutesLive: Story = {
  render: (_args, ctx) => (
    <Harness
      locale={localeFrom(ctx.globals)}
      items={allRoutesLive}
      initialPath="/transactions"
    />
  ),
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement);
    const strings = shellStrings(localeFrom(globals));

    // Seven real links, and only the current one carries aria-current.
    const current = canvas.getByRole('link', {
      name: strings.nav_transactions,
    });
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(
      canvas.getByRole('link', { name: strings.nav_overview }),
    ).not.toHaveAttribute('aria-current');

    // The heading follows the active destination without the page saying so.
    await expect(
      canvas.getByRole('heading', { level: 1, name: strings.nav_transactions }),
    ).toBeVisible();

    // Navigating moves aria-current with it.
    await userEvent.click(
      canvas.getByRole('link', { name: strings.nav_goals }),
    );
    await expect(
      canvas.getByRole('link', { name: strings.nav_goals }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(current).not.toHaveAttribute('aria-current');
  },
};

export const MobileRoutesLive: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => (
    <Harness
      locale={localeFrom(ctx.globals)}
      items={allRoutesLive}
      initialPath="/wallet"
    />
  ),
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement);
    const strings = shellStrings(localeFrom(globals));
    await expect(
      canvas.getByRole('link', { name: strings.nav_wallet }),
    ).toHaveAttribute('aria-current', 'page');

    // A destination chosen from the sheet closes it and becomes current.
    await userEvent.click(
      canvas.getByRole('button', { name: strings.shell_more }),
    );
    const dialog = await canvas.findByRole('dialog');
    await userEvent.click(
      within(dialog as HTMLElement).getByRole('link', {
        name: strings.nav_import,
      }),
    );
    // Import has no bottom-bar slot, so the proof it became current is the
    // shell's heading following the destination.
    await expect(
      canvas.getByRole('heading', { level: 1, name: strings.nav_import }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: strings.shell_more }),
    ).toHaveAttribute('aria-expanded', 'false');
  },
};
