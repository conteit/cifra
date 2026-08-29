import { type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router';

import { cx, focusRing } from '../ui/cx';
import { Modal } from '../ui/modal';
import {
  type NavItem,
  type NavLabelKey,
  navItems as defaultNavItems,
  overflowNavItems,
  primaryNavItems,
} from './nav-items';

/* ═══════════════════════════════════════════════════════════════════════════
   The app shell — header, primary navigation, and the responsive frame every
   page mounts inside (FOUN-09, Phase 1 "sign-in lands on the styled app
   shell").

   ## It is deliberately dumb

   The shell imports nothing from `app/crypto`, `app/db`, `app/services` or
   `app/stores`. It knows about routes (it is navigation) and about the two
   primitives it composes, and nothing else. Identity, sign-in and the vault
   lock are the caller's business:

     · #9 (sign-in + vault setup) mounts *outside* this shell — the sign-in
       screen is a sibling route of the layout route, so it renders with no nav
       and no header. Once signed in, the route guard redirects into the layout
       and this is what lands. The signed-in user chip is passed down through
       the `identity` slot, so the dependency points route → shell and never
       shell → session store.
     · #10 (lock screen + idle auto-lock) needs no prop at all: it is a
       `Modal` with `dismissible={false}` rendered by the layout route beside
       `<AppShell>`. A native `<dialog>` opened with `showModal()` sits in the
       top layer and makes the rest of the document inert, so it covers the
       shell regardless of DOM position — adding an `overlay` prop here would
       buy nothing and would put lock policy inside a layout component.

   ## Copy

   Like the `app/ui` primitives, the shell has no locale: every user-facing
   string arrives through `strings`. `app/i18n/en.ts` satisfies `ShellStrings`
   structurally, so a route passes `en` (or `it`) straight in.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The `<main>` element's id — the skip link's target and the focus landing. */
export const MAIN_CONTENT_ID = 'main-content';

export type ShellStrings = Readonly<Record<NavLabelKey, string>> &
  Readonly<{
    /** Accessible name of the `<nav>` landmark. */
    shell_nav_label: string;
    shell_skip_to_content: string;
    /** Label of the mobile overflow control and title of its sheet. */
    shell_more: string;
    /** Marker on a destination whose route has not shipped yet. */
    shell_soon: string;
    /** Accessible name of the overflow sheet's close button. */
    modal_close: string;
  }>;

export interface AppShellProps {
  strings: ShellStrings;
  /** The page. The layout route passes React Router's `<Outlet />`. */
  children: ReactNode;
  /**
   * The `<h1>`. Defaults to the label of the active nav item, so a page that
   * *is* a nav destination needs no title at all.
   */
  title?: string;
  /** Meta line under the title — v1's "March 2026" eyebrow. */
  subtitle?: string;
  /** Page-owned header controls, e.g. v1's "scan a receipt" button on Add. */
  actions?: ReactNode;
  /** The signed-in user chip. The seam #9 mounts into; see the note above. */
  identity?: ReactNode;
  /**
   * Overrides the nav item table. The app never passes this — `nav-items.ts`
   * stays the single source of truth. It exists so stories can render the
   * shell against mocked routes (every destination `live`), which is the only
   * way to see the active/hover states of destinations Phase 2–9 will add.
   */
  items?: readonly NavItem[];
}

type NavVariant = 'rail' | 'bar' | 'sheet';

/* ── One item, three arrangements ───────────────────────────────────────── */

const variantClasses: Record<NavVariant, string> = {
  // Desktop rail row: glyph, label, then the "soon" marker pushed right.
  rail: cx(
    'flex w-full items-center gap-5 border-l-2 px-8 py-5 text-left',
    'font-mono text-label uppercase transition-colors',
  ),
  // Mobile bottom-bar slot: glyph stacked over a smaller label.
  bar: cx(
    'flex flex-1 flex-col items-center justify-center gap-2 rounded-control px-3 py-4',
    'font-mono text-label-sm uppercase transition-colors',
  ),
  // Overflow sheet row: the rail row without the rail's active edge.
  sheet: cx(
    'flex w-full items-center gap-5 rounded-control px-6 py-6 text-left',
    'font-mono text-label uppercase transition-colors',
  ),
};

const activeClasses: Record<NavVariant, string> = {
  rail: 'border-action-primary bg-surface-inset text-text-primary',
  bar: 'bg-surface-inset text-text-primary',
  sheet: 'bg-surface-inset text-text-primary',
};

const idleClasses: Record<NavVariant, string> = {
  rail: 'border-transparent text-text-secondary hover:bg-surface-inset hover:text-text-primary',
  bar: 'text-text-secondary hover:bg-surface-inset hover:text-text-primary',
  sheet: 'text-text-secondary hover:bg-surface-inset hover:text-text-primary',
};

// A destination Phase 2–9 still owes. Rendered as a real disabled control, not
// a styled span: `disabled` takes it out of the tab order, announces it as
// unavailable, and is what an assistive technology already understands.
const plannedClasses: Record<NavVariant, string> = {
  rail: 'border-transparent text-text-secondary opacity-45',
  bar: 'text-text-secondary opacity-45',
  sheet: 'text-text-secondary opacity-45',
};

function NavGlyph({ glyph, variant }: { glyph: string; variant: NavVariant }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'font-display text-numeral-sm leading-none',
        variant === 'bar' ? '' : 'w-9 shrink-0 text-center',
      )}
    >
      {glyph}
    </span>
  );
}

function NavBody({
  item,
  label,
  soonLabel,
  variant,
}: {
  item: NavItem;
  label: string;
  soonLabel: string;
  variant: NavVariant;
}) {
  const planned = item.status === 'planned';
  return (
    <>
      <NavGlyph glyph={item.glyph} variant={variant} />
      <span
        className={variant === 'bar' ? 'truncate' : 'min-w-0 flex-1 truncate'}
      >
        {label}
      </span>
      {planned ? (
        // Visible where the arrangement has room; announced everywhere, so a
        // bottom-bar slot is never silently inert to a screen-reader user.
        <span
          className={
            variant === 'bar'
              ? 'sr-only'
              : 'shrink-0 rounded-badge border border-rule px-3 py-1 font-mono text-badge uppercase'
          }
        >
          {soonLabel}
        </span>
      ) : null}
    </>
  );
}

function NavItemControl({
  item,
  label,
  soonLabel,
  variant,
  onNavigate,
}: {
  item: NavItem;
  label: string;
  soonLabel: string;
  variant: NavVariant;
  onNavigate?: () => void;
}) {
  const body = (
    <NavBody
      item={item}
      label={label}
      soonLabel={soonLabel}
      variant={variant}
    />
  );

  if (item.status === 'planned') {
    return (
      <button
        type="button"
        disabled
        data-nav-id={item.id}
        className={cx(
          variantClasses[variant],
          plannedClasses[variant],
          'cursor-not-allowed',
        )}
      >
        {body}
      </button>
    );
  }

  return (
    // NavLink is what sets `aria-current="page"` on the active destination.
    // `end` keeps the index route from matching every path below it.
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      data-nav-id={item.id}
      className={({ isActive }) =>
        cx(
          variantClasses[variant],
          isActive ? activeClasses[variant] : idleClasses[variant],
          focusRing,
        )
      }
    >
      {body}
    </NavLink>
  );
}

/* ── The shell ──────────────────────────────────────────────────────────── */

export function AppShell({
  strings,
  children,
  title,
  subtitle,
  actions,
  identity,
  items = defaultNavItems,
}: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();

  const primary = primaryNavItems(items);
  const overflow = overflowNavItems(items);

  const label = (item: NavItem) => strings[item.labelKey];
  const soon = strings.shell_soon;

  // A page that is a nav destination gets its heading for free.
  const activeItem = items.find(
    (item) => item.status === 'live' && item.to === pathname,
  );
  const headingText = title ?? (activeItem ? label(activeItem) : undefined);

  return (
    // A column so the header keeps its natural height and the row below it
    // takes the rest: that is what lets the rail's rule run the full height of
    // the viewport instead of stopping under the last nav item.
    <div className="flex min-h-dvh flex-col bg-surface-page">
      <header className="sticky top-0 z-20 shrink-0 border-b border-rule bg-surface-card">
        {/* First focusable element on the page. The nav precedes `<main>` in
            DOM order at both breakpoints — including on mobile, where the bar
            is painted at the bottom but still read first — so this is the
            escape hatch that keeps keyboard order honest. */}
        <a
          href={`#${MAIN_CONTENT_ID}`}
          className={cx(
            'sr-only rounded-control font-mono text-button uppercase',
            'focus:not-sr-only focus:absolute focus:left-6 focus:top-6 focus:z-30',
            'focus:bg-action-primary focus:px-7 focus:py-5 focus:text-action-on-primary',
            focusRing,
          )}
        >
          {strings.shell_skip_to_content}
        </a>

        <div className="mx-auto flex max-w-page items-center gap-7 px-8 py-6 desktop:px-10 desktop:py-7">
          <span className="shrink-0 font-mono text-label uppercase text-text-muted">
            Cifra
          </span>
          <span aria-hidden="true" className="h-8 w-px shrink-0 bg-rule" />
          <div className="min-w-0 flex-1">
            {headingText ? (
              <h1 className="truncate font-display text-title text-text-primary">
                {headingText}
              </h1>
            ) : null}
            {subtitle ? (
              <p className="mt-1 truncate font-mono text-label-sm uppercase text-text-muted">
                {subtitle}
              </p>
            ) : null}
          </div>
          {identity ? <div className="shrink-0">{identity}</div> : null}
          {actions ? (
            <div className="flex shrink-0 items-center gap-5">{actions}</div>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-page flex-1">
        {/* One nav landmark, one item table, two arrangements. The rail and the
            bar are separate lists rather than one list restyled, because they
            differ in more than layout: the rail carries all seven destinations
            with the label beside the glyph, the bar carries four with the label
            under it plus the overflow control. `display: none` keeps exactly
            one of them in the accessibility tree and the tab order at any
            viewport — asserted by the shell stories at both viewports. */}
        <nav
          aria-label={strings.shell_nav_label}
          className="desktop:w-sidebar desktop:shrink-0 desktop:border-r desktop:border-rule desktop:bg-surface-card"
        >
          <ul
            data-testid="shell-nav-rail"
            className="hidden desktop:flex desktop:flex-col desktop:py-6"
          >
            {items.map((item) => (
              <li key={item.id}>
                <NavItemControl
                  item={item}
                  label={label(item)}
                  soonLabel={soon}
                  variant="rail"
                />
              </li>
            ))}
          </ul>

          <ul
            data-testid="shell-nav-bar"
            className="fixed inset-x-0 bottom-0 z-20 flex items-stretch gap-2 border-t border-rule bg-surface-card px-4 py-4 desktop:hidden"
          >
            {primary.map((item) => (
              <li key={item.id} className="flex flex-1">
                <NavItemControl
                  item={item}
                  label={label(item)}
                  soonLabel={soon}
                  variant="bar"
                />
              </li>
            ))}
            <li className="flex flex-1">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(true)}
                className={cx(
                  variantClasses.bar,
                  idleClasses.bar,
                  focusRing,
                  'w-full',
                )}
              >
                <span
                  aria-hidden="true"
                  className="font-display text-numeral-sm leading-none"
                >
                  ⋯
                </span>
                <span className="truncate">{strings.shell_more}</span>
              </button>
            </li>
          </ul>
        </nav>

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="min-w-0 flex-1 px-8 pt-10 pb-32 desktop:px-10 desktop:pb-16"
        >
          {children}
        </main>
      </div>

      {/* The mobile overflow. Reuses the Modal primitive rather than a bespoke
          sheet: `<dialog showModal()>` already gives the focus trap, inertness,
          Escape handling and focus restoration a bottom-sheet menu needs. */}
      <Modal
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={strings.shell_more}
        closeLabel={strings.modal_close}
      >
        <ul data-testid="shell-nav-sheet" className="flex flex-col gap-3">
          {overflow.map((item) => (
            <li key={item.id}>
              <NavItemControl
                item={item}
                label={label(item)}
                soonLabel={soon}
                variant="sheet"
                onNavigate={() => setMoreOpen(false)}
              />
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
