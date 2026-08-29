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

  it('mounts every route inside the app-shell layout', () => {
    // A page that renders outside the shell is a deliberate act (#9's sign-in
    // screen will be one). Today there is exactly one layout and everything
    // lives under it, so a stray top-level page would be an accident.
    const top = routeConfig as Array<Entry & { file?: string }>;
    expect(top).toHaveLength(1);
    expect(top[0].file).toBe('routes/app-layout.tsx');
    expect(top[0].path).toBeUndefined();
  });
});
