import { describe, expect, it } from 'vitest';

import routeConfig from '../../../app/routes';
import { navItems } from '../../../app/shell/nav-items';

/**
 * Keeps the nav honest.
 *
 * `app/shell/nav-items.ts` names a path for all seven destinations but marks
 * only some of them `live`; a `live` item renders as a link, a `planned` one as
 * a disabled "soon" control. That distinction is only honest while it matches
 * `app/routes.ts` — a `live` item whose route was never registered is a link
 * into a 404, and a `planned` item whose route has since landed is a
 * destination the user cannot reach. Both are silent failures in review, so
 * they are asserted here instead.
 *
 * When a phase lands a page: add the route to `app/routes.ts` *and* flip the
 * item to `live`. This test fails until both are done.
 */

type Entry = {
  path?: string;
  index?: boolean;
  children?: Entry[];
};

function registeredPaths(entries: readonly Entry[], prefix = ''): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    const here = entry.path
      ? `${prefix}/${entry.path.replace(/^\/+/, '')}`
      : prefix;
    if (entry.index) paths.push(here === '' ? '/' : here);
    else if (entry.path) paths.push(here);
    if (entry.children) paths.push(...registeredPaths(entry.children, here));
  }
  return paths;
}

describe('nav items agree with the route config', () => {
  const registered = new Set(registeredPaths(routeConfig as Entry[]));

  it('registers the index route the shell treats as Overview', () => {
    expect(registered.has('/')).toBe(true);
  });

  it('routes every live destination', () => {
    for (const item of navItems.filter((i) => i.status === 'live')) {
      expect(registered.has(item.to), `${item.id} is live but unrouted`).toBe(
        true,
      );
    }
  });

  it('leaves every planned destination unrouted', () => {
    for (const item of navItems.filter((i) => i.status === 'planned')) {
      expect(
        registered.has(item.to),
        `${item.id} is routed but still marked planned`,
      ).toBe(false);
    }
  });

  it('mounts every route inside the gate, and the gate inside nothing', () => {
    // #9 put a second pathless layout above the shell: `routes/gate.tsx`
    // renders the sign-in, setup and unlock screens *instead of* everything
    // below it, and its `<Outlet />` only once the vault is open. Those three
    // screens are the deliberate act of rendering outside the shell this test
    // used to anticipate — and because the gate is a wrapper rather than a
    // `/sign-in` sibling reached by redirect, they render at whatever URL the
    // user asked for instead of costing them their deep link.
    //
    // A stray *third* top-level entry would still be an accident: it would be a
    // page reachable with no identity and no vault.
    const top = routeConfig as Array<Entry & { file?: string }>;
    expect(top).toHaveLength(1);
    expect(top[0].file).toBe('routes/gate.tsx');
    expect(top[0].path).toBeUndefined();

    const nested = (top[0].children ?? []) as Array<Entry & { file?: string }>;
    expect(nested).toHaveLength(1);
    expect(nested[0].file).toBe('routes/app-layout.tsx');
    expect(nested[0].path).toBeUndefined();
  });
});
