import { Outlet } from 'react-router';

import { IdentityChip } from '../screens';
import { AppShell, InstallPrompt } from '../shell';
import { useInstallPrompt } from '../stores/use-install-prompt';
import { useStrings } from '../stores/use-locale';
import { useSession, useSessionActions } from '../stores/use-session';
import { useVault, useVaultActions } from '../stores/use-vault';

/**
 * The layout route every page mounts inside.
 *
 * Declared as a pathless `layout()` in `app/routes.ts`, so any route nested
 * under it gets the shell automatically. The sign-in, setup and unlock screens
 * are not siblings of this route but the *gate* above it (D27): they render
 * instead of the shell, and this layout only ever mounts with an open vault.
 * There is no lock modal here either — a locked vault unmounts this route
 * entirely, so nothing below it ever renders without a data key (D28).
 *
 * The shell is locale-free — it takes every string as a prop — so the locale
 * lives here, one layer up, and arrives from the store
 * (`app/stores/locale.ts`). A route reads state from a store; it does not
 * import a string table. `test/unit/locale-boundary.test.ts` enforces that by
 * walking the real import graph, because the comment this one replaced claimed
 * "swapping this one import for a detected locale is the whole change" and
 * that was false: detection needed a resolver, a store, a React binding, and a
 * runtime `<html lang>` (FOUN-07 has four seams, not one — see #47).
 *
 * It is also where the install affordance is composed (FOUN-06, #60) and, since
 * #9, the signed-in identity chip. The shell takes both as slots and both
 * components are dumb, so the only module that touches the install-prompt
 * controller or the session and vault stores is this one — the same
 * route → store → service direction the locale takes above.
 *
 * Nothing here guards anything: `app/routes/gate.tsx` sits above this route and
 * only renders it once the vault is open, so `user` is always present by the
 * time this runs. The `?? null` below is a type narrowing, not a state.
 */
export default function AppLayout() {
  const strings = useStrings();
  const install = useInstallPrompt();

  const user = useSession((s) => s.user);
  const vaultStatus = useVault((s) => s.status);
  const { signOut } = useSessionActions();
  const { lock } = useVaultActions();

  return (
    <AppShell
      strings={strings}
      identity={
        <IdentityChip
          strings={strings}
          label={user?.displayName ?? user?.email ?? ''}
          showLock={vaultStatus === 'unlocked'}
          onLock={() => lock('manual')}
          onSignOut={() => void signOut()}
        />
      }
      banner={
        <InstallPrompt
          state={install.state}
          strings={strings}
          onInstall={install.install}
          onDismiss={install.dismiss}
        />
      }
    >
      <Outlet />
    </AppShell>
  );
}
