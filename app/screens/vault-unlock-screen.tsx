import { type FormEvent, useState } from 'react';

import type { Strings } from '../i18n';
import type { VaultSecret } from '../services/vault/types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScreenError, ScreenFrame } from './screen-frame';

/* ═══════════════════════════════════════════════════════════════════════════
   Unlock — the second half of "create vault → lock → unlock".

   ## This is the lock screen

   Mounted full-page by `app/routes/gate.tsx` whenever a vault exists and no
   data key is held — after the header button, after sign-out, after the idle
   timeout and after a `pagehide` alike (FOUN-10, D28). It does not know or
   care which; the one thing it is told is `lockReason`, and the one thing it
   does with it is swap the subtitle so an *automatic* lock is announced as
   one. A user back from lunch should read "locked after 30 minutes" before
   being asked for a password, not wonder whether something broke.

   ## One call site for two secrets

   The two modes differ in what the user types and in nothing else: both end at
   `onUnlock` with a `VaultSecret`, whose discriminated union is what makes it
   impossible to route a recovery phrase into the password path (D26). A
   toggle rather than an ARIA tablist — there are two modes, only one is ever
   relevant to a given user at a given moment, and the toggle needs no roving
   tabindex to be operable.
   ═══════════════════════════════════════════════════════════════════════════ */

export type VaultUnlockStrings = Pick<
  Strings,
  | 'tagline_line1'
  | 'tagline_line2'
  | 'unlock_title'
  | 'unlock_sub'
  | 'unlock_idle_sub'
  | 'unlock_password_label'
  | 'unlock_btn'
  | 'unlocking'
  | 'unlock_use_recovery'
  | 'unlock_use_password'
  | 'unlock_recovery_title'
  | 'unlock_recovery_sub'
  | 'recovery_phrase_label'
  | 'vault_busy_starting'
  | 'vault_busy_deriving'
  | 'identity_lock'
  | 'signout_btn'
>;

export interface VaultUnlockScreenProps {
  strings: VaultUnlockStrings;
  /** An unlock is in flight. */
  busy: boolean;
  /** D22's three-state derivation signal. Always `null` on the phrase path. */
  derivation: 'starting' | 'deriving' | null;
  /** Already localised. `secret/rejected`, `phrase/malformed`, … */
  errorMessage?: string | null;
  /** Only `idle` changes the copy; every other lock reads as a plain lock. */
  lockReason?: 'idle' | null;
  onUnlock: (secret: VaultSecret) => void;
  /** The way out for someone who has lost both secrets. */
  onSignOut: () => void;
}

export function VaultUnlockScreen({
  strings,
  busy,
  derivation,
  errorMessage = null,
  lockReason = null,
  onUnlock,
  onSignOut,
}: VaultUnlockScreenProps) {
  const [mode, setMode] = useState<'password' | 'recovery-phrase'>('password');
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');

  const recovery = mode === 'recovery-phrase';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onUnlock(
      recovery
        ? { kind: 'recovery-phrase', phrase }
        : { kind: 'password', password },
    );
  }

  const busyLabel =
    derivation === 'deriving'
      ? strings.vault_busy_deriving
      : strings.vault_busy_starting;

  return (
    <ScreenFrame
      screen={recovery ? 'vault-unlock-recovery' : 'vault-unlock'}
      taglineLine1={strings.tagline_line1}
      taglineLine2={strings.tagline_line2}
      title={recovery ? strings.unlock_recovery_title : strings.unlock_title}
      subtitle={
        recovery
          ? strings.unlock_recovery_sub
          : lockReason === 'idle'
            ? strings.unlock_idle_sub
            : strings.unlock_sub
      }
      footer={
        <div className="flex justify-center">
          <Button variant="quiet" onClick={onSignOut} data-testid="sign-out">
            {strings.signout_btn}
          </Button>
        </div>
      }
    >
      <form className="flex flex-col gap-7" onSubmit={submit}>
        {recovery ? (
          <Input
            key="recovery"
            label={strings.recovery_phrase_label}
            // Never `autoComplete`: a recovery phrase saved into a browser's
            // form store is an unasked-for copy of the vault key.
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            data-testid="recovery-input"
          />
        ) : (
          <Input
            key="password"
            label={strings.unlock_password_label}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="unlock-password"
          />
        )}

        {errorMessage ? <ScreenError>{errorMessage}</ScreenError> : null}

        {busy ? (
          <p
            role="status"
            data-derivation={derivation ?? 'none'}
            className="font-mono text-label uppercase text-text-muted"
          >
            {busyLabel}
          </p>
        ) : null}

        <Button fullWidth type="submit" loading={busy} data-testid="unlock">
          {busy ? strings.unlocking : strings.unlock_btn}
        </Button>

        <Button
          variant="secondary"
          fullWidth
          onClick={() => setMode(recovery ? 'password' : 'recovery-phrase')}
          data-testid="unlock-toggle-mode"
        >
          {recovery ? strings.unlock_use_password : strings.unlock_use_recovery}
        </Button>
      </form>
    </ScreenFrame>
  );
}
