import { Outlet } from 'react-router';

import {
  authErrorMessage,
  SignInScreen,
  VaultSetupScreen,
  VaultUnlockScreen,
  vaultErrorMessage,
} from '../screens';
import { useStrings } from '../stores/use-locale';
import { useSession, useSessionActions } from '../stores/use-session';
import { useVault, useVaultActions, useVaultProbe } from '../stores/use-vault';

/**
 * The gate: nothing below this route renders until there is an identity **and**
 * an open vault.
 *
 * ## Why a pathless layout rather than a `/sign-in` route
 *
 * `app/routes/app-layout.tsx` and `app/shell/app-shell.tsx` both anticipated a
 * sign-in screen as a *sibling* route, reached by redirect. This is the same
 * design — the screens render outside the shell, with no nav and no header —
 * arranged as a wrapper instead, for one reason the redirect shape cannot
 * offer: **the URL is never lost.** `app/stores/session.ts` already warns that
 * treating an unresolved session as signed-out "bounces them out of a deep
 * link"; a redirect to `/sign-in` does exactly that on every cold load, and
 * every deep link would then need a return-to parameter to undo it. A wrapper
 * renders the right screen *at* the deep link and the `<Outlet />` appears
 * underneath it the moment the vault opens, so no navigation happens at all.
 *
 * The routing consequence is recorded in `app/routes.ts` and asserted by
 * `test/unit/shell/nav-routes.test.ts`.
 *
 * ## The order of the checks is the security property
 *
 *   1. `unknown` on either store renders **nothing** and redirects nowhere.
 *      Treating an unresolved state as "signed out" or "no vault" would flash
 *      a sign-in screen at a signed-in user and, worse, offer to create a
 *      second vault over the top of an existing one.
 *   2. Identity first, then the vault, because probing the vault opens
 *      IndexedDB and a visitor who never signs in should not have a database
 *      created for them.
 *   3. `<Outlet />` only from `unlocked`. Every page below it may therefore
 *      assume a live data key, which is what lets the db middleware treat
 *      `vault/locked` as a bug rather than a state to render.
 *
 * ## The lock screen is this gate, not a modal (D28)
 *
 * The unlock screen mounts here full-page, and that is its final shape. Earlier
 * notes planned a `dismissible={false}` modal over the app; that would have
 * kept every page mounted underneath with no data key — contradicting rule 3
 * above — and left financial content on screen behind the lock. Unmounting
 * the outlet is what makes "locked" mean *nothing is rendered that needed the
 * key*. The URL is untouched, so the same page reappears on unlock.
 *
 * Every lock edge calls the one store action: the header button (`manual`),
 * sign-out (`session-ended`) and the idle timeout and `pagehide` (`idle`),
 * the last two wired in `app/stores/vault-instance.ts` (FOUN-10). The screen
 * reads the reason only to say "locked after 30 minutes" when that is what
 * happened.
 */
export default function Gate() {
  const strings = useStrings();

  const sessionStatus = useSession((s) => s.status);
  const sessionError = useSession((s) => s.error);
  const { signIn, signOut } = useSessionActions();

  const signedIn = sessionStatus === 'signed-in';
  useVaultProbe(signedIn);

  const vaultStatus = useVault((s) => s.status);
  const pending = useVault((s) => s.pending);
  const derivation = useVault((s) => s.derivation);
  const vaultError = useVault((s) => s.error);
  const recoveryPhrase = useVault((s) => s.recoveryPhrase);
  const lockReason = useVault((s) => s.lockReason);
  const { create, unlock, matchRecoveryPhrase, acknowledgeRecoveryPhrase } =
    useVaultActions();

  // Identity still resolving. Deliberately blank: the first auth callback lands
  // in milliseconds and a spinner would be a flash of chrome, not information.
  if (sessionStatus === 'unknown') return null;

  if (!signedIn) {
    return (
      <SignInScreen
        status={
          sessionStatus === 'unavailable'
            ? 'unavailable'
            : sessionStatus === 'signing-in'
              ? 'signing-in'
              : 'signed-out'
        }
        strings={strings}
        errorMessage={authErrorMessage(strings, sessionError)}
        onSignIn={() => void signIn()}
      />
    );
  }

  // Signed in, vault not yet probed. Same reasoning as above.
  if (vaultStatus === 'unknown') return null;

  if (vaultStatus === 'absent' || recoveryPhrase !== null) {
    return (
      <VaultSetupScreen
        strings={strings}
        recoveryPhrase={recoveryPhrase}
        busy={pending === 'creating'}
        derivation={derivation}
        errorMessage={vaultErrorMessage(strings, vaultError, 'setup')}
        onCreate={(password) => void create(password)}
        matchPhrase={matchRecoveryPhrase}
        onFinish={acknowledgeRecoveryPhrase}
      />
    );
  }

  if (vaultStatus !== 'unlocked') {
    return (
      <VaultUnlockScreen
        strings={strings}
        busy={pending === 'unlocking'}
        derivation={derivation}
        errorMessage={vaultErrorMessage(strings, vaultError, 'unlock')}
        lockReason={lockReason === 'idle' ? 'idle' : null}
        onUnlock={(secret) => void unlock(secret)}
        onSignOut={() => void signOut()}
      />
    );
  }

  return <Outlet />;
}
