import { Outlet } from 'react-router';

import { en } from '../i18n/en';
import { AppShell } from '../shell';

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
 * The locale is pinned to English here. FOUN-07's browser auto-detection and
 * the language preference have no runtime yet — nothing in the app selects a
 * locale today (see the follow-up issue linked from the PR for #3). The shell
 * itself is locale-free: swapping this one import for a detected locale is the
 * whole change.
 */
export default function AppLayout() {
  return (
    <AppShell strings={en}>
      <Outlet />
    </AppShell>
  );
}
