import { Outlet } from 'react-router';

import { AppShell } from '../shell';
import { useStrings } from '../stores/use-locale';

/**
 * The layout route every page mounts inside.
 *
 * Declared as a pathless `layout()` in `app/routes.ts`, so any route nested
 * under it gets the shell automatically and any route declared beside it
 * renders bare. That is the seam the auth work uses next sprint: #9's sign-in
 * screen is a *sibling* of this route (no nav, no header until there is a
 * session), and #10's lock screen is a `dismissible={false}` Modal this route
 * will render next to `<AppShell>` once there is a vault to lock.
 *
 * The shell is locale-free — it takes every string as a prop — so the locale
 * lives here, one layer up, and arrives from the store
 * (`app/stores/locale.ts`). A route reads state from a store; it does not
 * import a string table. `test/unit/locale-boundary.test.ts` enforces that by
 * walking the real import graph, because the comment this one replaced claimed
 * "swapping this one import for a detected locale is the whole change" and
 * that was false: detection needed a resolver, a store, a React binding, and a
 * runtime `<html lang>` (FOUN-07 has four seams, not one — see #47).
 */
export default function AppLayout() {
  const strings = useStrings();

  return (
    <AppShell strings={strings}>
      <Outlet />
    </AppShell>
  );
}
