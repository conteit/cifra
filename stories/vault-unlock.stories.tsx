import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { stringsFor } from '../app/i18n';
import { vaultErrorMessage } from '../app/screens/vault-error-copy';
import { VaultUnlockScreen } from '../app/screens/vault-unlock-screen';
import type { VaultSecret } from '../app/services/vault/types';
import { localeFrom } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   Unlock — the second half of "create vault → lock → unlock".

   ## Scope

   The form itself, both secrets, every failure state — and, since #10, the
   one thing an *automatic* lock adds to it: a subtitle saying the vault
   locked itself after thirty idle minutes, so a user back from lunch is told
   why before being asked to type. There is no separate lock screen: the gate
   mounts this full-page whenever the vault is closed (D28), and what locks
   it — the header button, sign-out, idle, `pagehide` — is the store's
   business, not this component's.

   ## Two secrets, one call site

   The password path derives an Argon2id master key in a worker; the recovery
   path is a single HKDF and spawns nothing. They differ in what the user types
   and in nothing else — both end at one `onUnlock` with a `VaultSecret`, whose
   discriminated union is what makes it impossible to route a phrase into the
   password path (D26).

   ## The failure states are the interesting ones

   `secret/rejected` is deliberately one message for both methods and for a
   tampered `meta` row: AES-KW cannot tell them apart, and pretending otherwise
   would be a guess presented as a diagnosis. `phrase/malformed` is separate
   because "you mistyped it" and "that is not this vault's phrase" are different
   things to say to someone who has already lost their password — and saying so
   reveals nothing, since the phrase is their own input.
   ═══════════════════════════════════════════════════════════════════════════ */

const meta: Meta<typeof VaultUnlockScreen> = {
  title: 'Screens/VaultUnlock',
  component: VaultUnlockScreen,
  parameters: { layout: 'fullscreen' },
  args: { onUnlock: fn(), onSignOut: fn() },
};

export default meta;

type Story = StoryObj<typeof VaultUnlockScreen>;

function screen(
  ctx: { globals: Record<string, unknown> },
  args: { onUnlock: (secret: VaultSecret) => void; onSignOut: () => void },
  overrides: {
    busy?: boolean;
    derivation?: 'starting' | 'deriving' | null;
    errorMessage?: string | null;
    lockReason?: 'idle' | null;
  } = {},
) {
  return (
    <VaultUnlockScreen
      strings={stringsFor(localeFrom(ctx.globals))}
      busy={overrides.busy ?? false}
      derivation={overrides.derivation ?? null}
      errorMessage={overrides.errorMessage ?? null}
      lockReason={overrides.lockReason ?? null}
      onUnlock={args.onUnlock}
      onSignOut={args.onSignOut}
    />
  );
}

/* ── the password path ──────────────────────────────────────────────────── */

export const Password: Story = {
  render: (args, ctx) => screen(ctx, args),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    await userEvent.type(
      canvas.getByLabelText(strings.unlock_password_label),
      'un cavallo corretto batteria graffetta',
    );
    await userEvent.click(
      canvas.getByRole('button', { name: strings.unlock_btn }),
    );

    await expect(args.onUnlock).toHaveBeenCalledWith({
      kind: 'password',
      password: 'un cavallo corretto batteria graffetta',
    });
  },
};

export const PasswordItalian: Story = {
  ...Password,
  globals: { locale: 'it' },
};

export const PasswordMobile: Story = {
  ...Password,
  globals: { viewport: { value: 'mobile' } },
};

export const Deriving: Story = {
  render: (args, ctx) =>
    screen(ctx, args, { busy: true, derivation: 'deriving' }),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    const status = canvas.getByRole('status');
    await expect(status).toHaveTextContent(strings.vault_busy_deriving);
    await expect(status).toHaveAttribute('data-derivation', 'deriving');

    // Busy, focusable, and not listening. `aria-disabled` rather than
    // `disabled` keeps the announcement on the control the user is standing on.
    const button = canvas.getByRole('button', { name: strings.unlocking });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).not.toBeDisabled();
    await userEvent.click(button);
    await expect(args.onUnlock).not.toHaveBeenCalled();
  },
};

export const WrongPassword: Story = {
  render: (args, ctx) => {
    const strings = stringsFor(localeFrom(ctx.globals));
    return screen(ctx, args, {
      errorMessage: vaultErrorMessage(strings, 'secret/rejected', 'unlock'),
    });
  },
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      strings.unlock_error_secret_rejected,
    );
  },
};

export const WrongPasswordItalian: Story = {
  ...WrongPassword,
  globals: { locale: 'it' },
};

export const EmptyPassword: Story = {
  // #91: an empty submit is the user's to fix, and reads as such — not as
  // "your browser could not run the unlock".
  render: (args, ctx) => {
    const strings = stringsFor(localeFrom(ctx.globals));
    return screen(ctx, args, {
      errorMessage: vaultErrorMessage(strings, 'password/malformed', 'unlock'),
    });
  },
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      strings.unlock_error_password_malformed,
    );
  },
};

export const EmptyPasswordItalian: Story = {
  ...EmptyPassword,
  globals: { locale: 'it' },
};

/* ── locked by the idle timeout ─────────────────────────────────────────── */

export const IdleLocked: Story = {
  render: (args, ctx) => screen(ctx, args, { lockReason: 'idle' }),
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);
    await expect(canvas.getByText(strings.unlock_idle_sub)).toBeVisible();
    await expect(canvas.queryByText(strings.unlock_sub)).toBeNull();
  },
};

export const IdleLockedItalian: Story = {
  ...IdleLocked,
  globals: { locale: 'it' },
};

/* ── the recovery path ──────────────────────────────────────────────────── */

export const RecoveryPhrase: Story = {
  render: (args, ctx) => screen(ctx, args),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole('button', { name: strings.unlock_use_recovery }),
    );
    // The whole screen changes, not just the field: a different title, a
    // different explanation, and the way back to the password.
    await expect(canvasElement).toHaveTextContent(
      strings.unlock_recovery_title,
    );
    await expect(
      canvas.getByRole('button', { name: strings.unlock_use_password }),
    ).toBeVisible();

    const field = canvas.getByLabelText(strings.recovery_phrase_label);
    await expect(field).toHaveAttribute('autocomplete', 'off');

    await userEvent.type(field, 'A1B2-C3D4-E5F6-G7H8-J9K0-MNPQ-RSTV-WXYZ');
    await userEvent.click(
      canvas.getByRole('button', { name: strings.unlock_btn }),
    );

    // A `recovery-phrase` secret, never a `password` one. The union is what
    // makes the wrong one unrepresentable rather than merely unlikely.
    await expect(args.onUnlock).toHaveBeenCalledWith({
      kind: 'recovery-phrase',
      phrase: 'A1B2-C3D4-E5F6-G7H8-J9K0-MNPQ-RSTV-WXYZ',
    });
  },
};

export const RecoveryPhraseItalian: Story = {
  ...RecoveryPhrase,
  globals: { locale: 'it' },
};

export const RecoveryPhraseMobile: Story = {
  ...RecoveryPhrase,
  globals: { viewport: { value: 'mobile' } },
};

export const MalformedPhrase: Story = {
  render: (args, ctx) => {
    const strings = stringsFor(localeFrom(ctx.globals));
    return screen(ctx, args, {
      errorMessage: vaultErrorMessage(strings, 'phrase/malformed', 'unlock'),
    });
  },
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      strings.unlock_error_phrase_malformed,
    );
  },
};

/* ── the row itself is unreadable ───────────────────────────────────────── */

export const CorruptRecord: Story = {
  render: (args, ctx) => {
    const strings = stringsFor(localeFrom(ctx.globals));
    return screen(ctx, args, {
      errorMessage: vaultErrorMessage(strings, 'record/invalid', 'unlock'),
    });
  },
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    // Not the user's fault and not fixable by retyping — so the copy says
    // restore from a backup rather than "try again".
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      strings.unlock_error_record_invalid,
    );

    // Sign-out is the way out of a vault that will not open, and it is the one
    // control on this screen that always works.
    await userEvent.click(
      canvas.getByRole('button', { name: strings.signout_btn }),
    );
    await expect(args.onSignOut).toHaveBeenCalledTimes(1);
  },
};

export const CorruptRecordItalian: Story = {
  ...CorruptRecord,
  globals: { locale: 'it' },
};
