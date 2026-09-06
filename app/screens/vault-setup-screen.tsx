import { type FormEvent, useId, useState } from 'react';

import type { Strings } from '../i18n';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScreenError, ScreenFrame, ScreenNotice } from './screen-frame';

/* ═══════════════════════════════════════════════════════════════════════════
   Vault setup — key hierarchy steps 2 and 3, as a screen.

   Four things the user does, in an order that is not negotiable:

     1. choose a master password (Argon2id derives the master key from it);
     2. wait while the key is derived and both wrapped copies are written;
     3. **write down the recovery phrase**, which is shown once and can never
        be shown again (D26);
     4. type it back, so nobody clicks past a phrase they never recorded.

   Step 4 is the reason step 3 can be trusted. `createVault` returns the phrase
   exactly once, there is no getter that reads it back out of a vault, and
   losing both it and the password destroys the data — so the acknowledgement
   here is not a formality, it is the last moment at which the loss is still
   preventable. The screen therefore refuses to continue on an unticked box or
   a phrase that does not match.

   Presentational and controlled. It holds only what the user is currently
   typing; the vault, the store and the crypto layer are all above it. The step
   is *derived* rather than passed: a phrase in hand means the vault already
   exists, which is exactly when steps 3–4 are the only sensible screens.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The product's floor for a master password.
 *
 * Not a crypto constant: `app/crypto/kdf.ts` rejects only an empty or absurdly
 * long password, because a KDF has no business having an opinion about
 * policy. 12 is chosen for the same reason the copy says "a phrase you can
 * remember beats a short jumble" — the master password is the one secret with
 * no reset path, and a passphrase is what survives being remembered.
 */
export const MIN_MASTER_PASSWORD_LENGTH = 12;

/** Where the user is. Derived, never passed in — see the note above. */
export type VaultSetupStep =
  | 'password'
  | 'creating'
  | 'phrase'
  | 'confirm'
  | 'done';

export type VaultSetupStrings = Pick<
  Strings,
  | 'tagline_line1'
  | 'tagline_line2'
  | 'setup_password_title'
  | 'setup_password_sub'
  | 'setup_password_label'
  | 'setup_password_hint'
  | 'setup_password_confirm_label'
  | 'setup_password_too_short'
  | 'setup_password_mismatch'
  | 'setup_password_warning'
  | 'setup_vault_title'
  | 'setup_creating_sub'
  | 'vault_busy_starting'
  | 'vault_busy_deriving'
  | 'vault_step1'
  | 'vault_step1_sub'
  | 'vault_step2'
  | 'vault_step2_sub'
  | 'vault_step3'
  | 'vault_step3_sub'
  | 'setup_recovery_title'
  | 'setup_recovery_sub'
  | 'setup_recovery_warning'
  | 'setup_recovery_ack'
  | 'recovery_phrase_label'
  | 'setup_confirm_title'
  | 'setup_confirm_sub'
  | 'setup_confirm_mismatch'
  | 'setup_done_title'
  | 'setup_done_body'
  | 'create_vault_btn'
  | 'creating_btn'
  | 'continue_btn'
  | 'continue_overview'
>;

export interface VaultSetupScreenProps {
  strings: VaultSetupStrings;
  /**
   * The phrase, once. Non-null exactly while steps 3–4 are live; the store
   * drops it the moment {@link VaultSetupScreenProps.onFinish} is called.
   */
  recoveryPhrase: string | null;
  /** A creation is in flight. */
  busy: boolean;
  /** D22's three-state derivation signal. `null` when nothing is deriving. */
  derivation: 'starting' | 'deriving' | null;
  /** Already localised. A failed creation, not a validation message. */
  errorMessage?: string | null;
  onCreate: (password: string) => void;
  /**
   * Whether what the user typed back is the phrase they were shown.
   * Injected rather than imported so this component reaches no further down
   * than the design system — `recoveryPhrasesMatch` lives in `app/crypto`.
   */
  matchPhrase: (typed: string) => boolean;
  /** Ends setup: the phrase is forgotten and the app opens. */
  onFinish: () => void;
}

function Step({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <p className="font-mono text-label uppercase text-text-primary">
        {title}
      </p>
      <p className="mt-2 font-body text-row-sub text-text-secondary">{body}</p>
    </li>
  );
}

export function VaultSetupScreen({
  strings,
  recoveryPhrase,
  busy,
  derivation,
  errorMessage = null,
  onCreate,
  matchPhrase,
  onFinish,
}: VaultSetupScreenProps) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<string | null>(null);

  const [phase, setPhase] = useState<'phrase' | 'confirm' | 'done'>('phrase');
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const ackId = useId();

  const step: VaultSetupStep =
    recoveryPhrase === null ? (busy ? 'creating' : 'password') : phase;

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    const tooShort = password.length < MIN_MASTER_PASSWORD_LENGTH;
    const mismatch = password !== repeat;
    setPasswordError(tooShort ? strings.setup_password_too_short : null);
    setRepeatError(mismatch ? strings.setup_password_mismatch : null);
    if (tooShort || mismatch) return;
    onCreate(password);
  }

  function submitConfirmation(event: FormEvent) {
    event.preventDefault();
    if (!matchPhrase(typed)) {
      setConfirmError(strings.setup_confirm_mismatch);
      return;
    }
    setConfirmError(null);
    // The typed copy is dropped here; the phrase itself is the store's to
    // forget, and it does so on `onFinish`.
    setTyped('');
    setPhase('done');
  }

  /* ── 1. the master password ───────────────────────────────────────────── */

  if (step === 'password') {
    return (
      <ScreenFrame
        screen="vault-setup-password"
        taglineLine1={strings.tagline_line1}
        taglineLine2={strings.tagline_line2}
        title={strings.setup_password_title}
        subtitle={strings.setup_password_sub}
      >
        <form className="flex flex-col gap-7" onSubmit={submitPassword}>
          <Input
            label={strings.setup_password_label}
            hint={strings.setup_password_hint}
            error={passwordError ?? undefined}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="master-password"
          />
          <Input
            label={strings.setup_password_confirm_label}
            error={repeatError ?? undefined}
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            data-testid="master-password-repeat"
          />
          <ScreenNotice>{strings.setup_password_warning}</ScreenNotice>
          {errorMessage ? <ScreenError>{errorMessage}</ScreenError> : null}
          <Button fullWidth type="submit" data-testid="create-vault">
            {strings.create_vault_btn}
          </Button>
        </form>
      </ScreenFrame>
    );
  }

  /* ── 2. deriving ──────────────────────────────────────────────────────── */

  if (step === 'creating') {
    const busyLabel =
      derivation === 'deriving'
        ? strings.vault_busy_deriving
        : strings.vault_busy_starting;

    return (
      <ScreenFrame
        screen="vault-setup-creating"
        taglineLine1={strings.tagline_line1}
        taglineLine2={strings.tagline_line2}
        title={strings.setup_vault_title}
        subtitle={strings.setup_creating_sub}
      >
        <ul className="flex flex-col gap-6">
          <Step title={strings.vault_step1} body={strings.vault_step1_sub} />
          <Step title={strings.vault_step2} body={strings.vault_step2_sub} />
          <Step title={strings.vault_step3} body={strings.vault_step3_sub} />
        </ul>
        {/* `status`, not `alert`: this is progress, and it changes while the
            user is doing nothing. Three honest states, no fabricated bar — the
            Argon2id implementation exposes no progress hook (D22). */}
        <p
          role="status"
          data-derivation={derivation ?? 'none'}
          className="font-mono text-label uppercase text-text-muted"
        >
          {busyLabel}
        </p>
        <Button fullWidth loading>
          {strings.creating_btn}
        </Button>
      </ScreenFrame>
    );
  }

  /* ── 3. the phrase, shown once ────────────────────────────────────────── */

  if (step === 'phrase') {
    return (
      <ScreenFrame
        screen="vault-setup-phrase"
        taglineLine1={strings.tagline_line1}
        taglineLine2={strings.tagline_line2}
        title={strings.setup_recovery_title}
        subtitle={strings.setup_recovery_sub}
      >
        {/* A term and its value, not a paragraph under a paragraph: `<dl>`
            associates the two natively, so a screen reader says what the string
            of symbols *is* before reading it out. The ARIA alternatives all
            need a role to hang a name on — `aria-labelledby` on a bare `<p>` is
            ignored, and `role="group"` on a `<div>` is a `<fieldset>` in
            disguise, which is a form control this is not. */}
        <dl>
          <dt className="font-mono text-label uppercase text-text-muted">
            {strings.recovery_phrase_label}
          </dt>
          <dd
            data-testid="recovery-phrase"
            className="mt-3 select-all break-words rounded-control bg-surface-inset px-6 py-5 font-mono text-row text-text-primary"
          >
            {recoveryPhrase}
          </dd>
        </dl>

        <ScreenNotice>{strings.setup_recovery_warning}</ScreenNotice>

        <label
          htmlFor={ackId}
          className="flex items-start gap-4 font-body text-row-sub text-text-secondary"
        >
          <input
            id={ackId}
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            data-testid="recovery-ack"
            className="mt-1 h-8 w-8 shrink-0 accent-action-primary"
          />
          {strings.setup_recovery_ack}
        </label>

        <Button
          fullWidth
          disabled={!acknowledged}
          onClick={() => setPhase('confirm')}
          data-testid="recovery-continue"
        >
          {strings.continue_btn}
        </Button>
      </ScreenFrame>
    );
  }

  /* ── 4. type it back ──────────────────────────────────────────────────── */

  if (step === 'confirm') {
    return (
      <ScreenFrame
        screen="vault-setup-confirm"
        taglineLine1={strings.tagline_line1}
        taglineLine2={strings.tagline_line2}
        title={strings.setup_confirm_title}
        subtitle={strings.setup_confirm_sub}
      >
        <form className="flex flex-col gap-7" onSubmit={submitConfirmation}>
          <Input
            label={strings.recovery_phrase_label}
            error={confirmError ?? undefined}
            // Never `autoComplete`: a recovery phrase in a browser's saved-form
            // store is a copy of the vault key nobody asked for.
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            data-testid="recovery-confirm-input"
          />
          <Button fullWidth type="submit" data-testid="recovery-confirm">
            {strings.continue_btn}
          </Button>
        </form>
      </ScreenFrame>
    );
  }

  /* ── done ─────────────────────────────────────────────────────────────── */

  return (
    <ScreenFrame
      screen="vault-setup-done"
      taglineLine1={strings.tagline_line1}
      taglineLine2={strings.tagline_line2}
      title={strings.setup_done_title}
      subtitle={strings.setup_done_body}
    >
      <Button fullWidth onClick={onFinish} data-testid="setup-finish">
        {strings.continue_overview}
      </Button>
    </ScreenFrame>
  );
}
