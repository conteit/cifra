import type { Strings } from '../i18n';
import { Button } from '../ui/button';

/* ═══════════════════════════════════════════════════════════════════════════
   The signed-in user chip — the `identity` slot `AppShell` left for #9.

   Who is signed in, plus the two session controls that belong to a header
   rather than to a settings page: lock the vault, and end the identity
   session. The shell stays free of stores because this is passed down as a
   slot, exactly as its own note asks for.

   Display data only: `AuthUser` carries a uid, an email, a name and a photo,
   and never key material (key hierarchy step 1). Nothing here reads the vault
   beyond calling `onLock`.

   **What #10 inherits:** the manual lock button is the only lock trigger that
   ships with #9, because the e2e journey needs a way to close a vault it just
   created. The idle timeout and the wipe on tab close are #10's, and they call
   the same store action this button does.
   ═══════════════════════════════════════════════════════════════════════════ */

export type IdentityChipStrings = Pick<
  Strings,
  'identity_lock' | 'signout_btn'
>;

export interface IdentityChipProps {
  strings: IdentityChipStrings;
  /** Display name, falling back to the email when Google has no name for us. */
  label: string;
  /** Shown only while the vault is open — there is nothing to lock otherwise. */
  showLock: boolean;
  onLock: () => void;
  onSignOut: () => void;
}

export function IdentityChip({
  strings,
  label,
  showLock,
  onLock,
  onSignOut,
}: IdentityChipProps) {
  return (
    <div data-testid="identity-chip" className="flex items-center gap-4">
      <span className="hidden max-w-sidebar truncate font-mono text-label uppercase text-text-muted desktop:inline">
        {label}
      </span>
      {showLock ? (
        <Button variant="quiet" onClick={onLock} data-testid="lock-vault">
          {strings.identity_lock}
        </Button>
      ) : null}
      <Button variant="quiet" onClick={onSignOut} data-testid="sign-out">
        {strings.signout_btn}
      </Button>
    </div>
  );
}
