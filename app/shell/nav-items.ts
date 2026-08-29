/**
 * The nav item table — the single source of truth for what the app's primary
 * navigation contains, in what order, and where each destination lives.
 *
 * Every arrangement of the nav (desktop rail, mobile bottom bar, mobile
 * overflow sheet) reads this one list. Adding a destination means adding a row
 * here and nowhere else; `test/unit/shell/nav-items.test.ts` and
 * `test/unit/shell/nav-routes.test.ts` hold that contract.
 *
 * Order, ids and glyphs are ported from the v1 prototype's `PAGES` table
 * (`/Volumes/Ext Storage/Code/cifra/docs/1-inception/PROTOTYPE_UI.jsx`, the
 * `PAGES=[…]` literal). The label keys are the v1 strings already ported into
 * `app/i18n` — this file invents no copy.
 */

export type NavItemId =
  | 'overview'
  | 'transactions'
  | 'track'
  | 'wallet'
  | 'goals'
  | 'import'
  | 'account';

/** The i18n keys the nav is allowed to name. Exactly the seven ported `nav_*`. */
export type NavLabelKey = `nav_${NavItemId}`;

/**
 * `live` — the route exists in `app/routes.ts` today and the item navigates.
 * `planned` — the destination is Phase 2–9 work. The item is rendered as a
 * disabled control with a "soon" marker rather than a link that looks live and
 * goes nowhere. Flipping a row to `live` without registering its route (or the
 * reverse) fails `test/unit/shell/nav-routes.test.ts`.
 */
export type NavItemStatus = 'live' | 'planned';

export interface NavItem {
  readonly id: NavItemId;
  readonly labelKey: NavLabelKey;
  /** Decorative mark from the v1 prototype. Always rendered `aria-hidden`. */
  readonly glyph: string;
  /** The path this destination owns, whether or not it is routed yet. */
  readonly to: string;
  readonly status: NavItemStatus;
  /**
   * `true` for the four destinations that get a permanent slot in the mobile
   * bottom bar. v1 gave the bar five slots (`[...PAGES.slice(0,4), account]`)
   * and simply left Goals and Import unreachable on mobile; we keep the same
   * four leading slots and spend the fifth on the overflow sheet instead, so
   * every destination stays reachable at both breakpoints (FOUN-09).
   */
  readonly primary: boolean;
}

export const navItems: readonly NavItem[] = [
  {
    id: 'overview',
    labelKey: 'nav_overview',
    glyph: '◉',
    to: '/',
    status: 'live',
    primary: true,
  },
  {
    id: 'transactions',
    labelKey: 'nav_transactions',
    glyph: '≡',
    to: '/transactions',
    status: 'planned',
    primary: true,
  },
  {
    id: 'track',
    labelKey: 'nav_track',
    glyph: '+',
    to: '/track',
    status: 'planned',
    primary: true,
  },
  {
    id: 'wallet',
    labelKey: 'nav_wallet',
    glyph: '♦',
    to: '/wallet',
    status: 'planned',
    primary: true,
  },
  {
    id: 'goals',
    labelKey: 'nav_goals',
    glyph: '◎',
    to: '/goals',
    status: 'planned',
    primary: false,
  },
  {
    id: 'import',
    labelKey: 'nav_import',
    glyph: '⇥',
    to: '/import',
    status: 'planned',
    primary: false,
  },
  {
    id: 'account',
    labelKey: 'nav_account',
    glyph: '⊙',
    to: '/account',
    status: 'planned',
    primary: false,
  },
];

/** The four bottom-bar slots, in table order. */
export function primaryNavItems(items: readonly NavItem[]): NavItem[] {
  return items.filter((item) => item.primary);
}

/** Everything the bottom bar cannot fit; the mobile overflow sheet's contents. */
export function overflowNavItems(items: readonly NavItem[]): NavItem[] {
  return items.filter((item) => !item.primary);
}
