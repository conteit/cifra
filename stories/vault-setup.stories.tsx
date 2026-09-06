import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { recoveryPhrasesMatch } from '../app/crypto/recovery-phrase';
import { stringsFor } from '../app/i18n';
import { VaultSetupScreen } from '../app/screens/vault-setup-screen';
import { localeFrom } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   Vault setup — key hierarchy steps 2 and 3, and the one screen in the app
   where a mistake is permanent.

   Five states, in the order a person meets them:

     1. `password` — the master password. Cifra never sees it and cannot reset
        it, so the screen says so before the field, not after it.
     2. `creating` — Argon2id in a worker, then two AES-KW wraps and one write.
        Three honest busy states and no percentage: `hash-wasm` exposes no
        progress hook, so a bar would be invented from a timer and would be
        wrong on exactly the slow devices where it is read (D22).
     3. `phrase`   — the recovery phrase, shown **once**. `createVault` returns
        it a single time and nothing anywhere can read it back out of a vault
        (D26), so this screen is the only moment it exists.
     4. `confirm`  — type it back. This is what makes step 3 trustworthy: an
        acknowledgement checkbox stops the click-through, and the typed copy
        must actually match.
     5. `done`     — into the app.

   The phrase below is a fixed sample so the stories are deterministic. It is
   still a real, well-formed phrase — 8 groups of 4 Crockford symbols — because
   the confirmation step runs the shipping `recoveryPhrasesMatch`, and a
   made-up string would make every confirm story pass for the wrong reason.
   ═══════════════════════════════════════════════════════════════════════════ */

const SAMPLE_PHRASE = 'A1B2-C3D4-E5F6-G7H8-J9K0-MNPQ-RSTV-WXYZ';

const meta: Meta<typeof VaultSetupScreen> = {
  title: 'Screens/VaultSetup',
  component: VaultSetupScreen,
  parameters: { layout: 'fullscreen' },
  args: { onCreate: fn(), onFinish: fn() },
};

export default meta;

type Story = StoryObj<typeof VaultSetupScreen>;

function screen(
  ctx: { globals: Record<string, unknown> },
  args: { onCreate: (password: string) => void; onFinish: () => void },
  overrides: {
    recoveryPhrase?: string | null;
    busy?: boolean;
    derivation?: 'starting' | 'deriving' | null;
    errorMessage?: string | null;
  } = {},
) {
  return (
    <VaultSetupScreen
      strings={stringsFor(localeFrom(ctx.globals))}
      recoveryPhrase={overrides.recoveryPhrase ?? null}
      busy={overrides.busy ?? false}
      derivation={overrides.derivation ?? null}
      errorMessage={overrides.errorMessage ?? null}
      onCreate={args.onCreate}
      matchPhrase={(typed) => recoveryPhrasesMatch(SAMPLE_PHRASE, typed)}
      onFinish={args.onFinish}
    />
  );
}

/* ── 1. the master password ─────────────────────────────────────────────── */

export const ChoosePassword: Story = {
  render: (args, ctx) => screen(ctx, args),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    // The consequence is on screen before anything is typed.
    await expect(canvasElement).toHaveTextContent(
      strings.setup_password_warning,
    );

    await userEvent.type(
      canvas.getByLabelText(strings.setup_password_label),
      'una password lunga abbastanza',
    );
    await userEvent.type(
      canvas.getByLabelText(strings.setup_password_confirm_label),
      'una password lunga abbastanza',
    );
    await userEvent.click(
      canvas.getByRole('button', { name: strings.create_vault_btn }),
    );
    await expect(args.onCreate).toHaveBeenCalledWith(
      'una password lunga abbastanza',
    );
  },
};

export const ChoosePasswordItalian: Story = {
  ...ChoosePassword,
  globals: { locale: 'it' },
};

export const ChoosePasswordMobile: Story = {
  ...ChoosePassword,
  globals: { viewport: { value: 'mobile' } },
};

export const PasswordRejected: Story = {
  render: (args, ctx) => screen(ctx, args),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    // Too short, and the two fields disagree. Both are caught here rather than
    // by the KDF: `deriveMasterKey` rejects only an empty password, because a
    // key-derivation function has no business holding a policy opinion.
    await userEvent.type(
      canvas.getByLabelText(strings.setup_password_label),
      'breve',
    );
    await userEvent.type(
      canvas.getByLabelText(strings.setup_password_confirm_label),
      'diversa',
    );
    await userEvent.click(
      canvas.getByRole('button', { name: strings.create_vault_btn }),
    );

    await expect(args.onCreate).not.toHaveBeenCalled();
    await expect(canvasElement).toHaveTextContent(
      strings.setup_password_too_short,
    );
    await expect(canvasElement).toHaveTextContent(
      strings.setup_password_mismatch,
    );
    await expect(
      canvas.getByLabelText(strings.setup_password_label),
    ).toHaveAttribute('aria-invalid', 'true');
  },
};

export const PasswordRejectedItalian: Story = {
  ...PasswordRejected,
  globals: { locale: 'it' },
};

/* ── 2. deriving ────────────────────────────────────────────────────────── */

export const Deriving: Story = {
  render: (args, ctx) =>
    screen(ctx, args, { busy: true, derivation: 'deriving' }),
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    // A `status` region rather than an alert: this changes while the user is
    // doing nothing, and it must not interrupt them.
    const status = canvas.getByRole('status');
    await expect(status).toHaveTextContent(strings.vault_busy_deriving);
    await expect(status).toHaveAttribute('data-derivation', 'deriving');

    // The three steps of the hierarchy, named. `vault_step2` used to describe
    // a Google-UID + PBKDF2 scheme that has not existed since D4; #9 rewrote it.
    await expect(canvasElement).toHaveTextContent(strings.vault_step2_sub);
  },
};

export const Starting: Story = {
  render: (args, ctx) =>
    screen(ctx, args, { busy: true, derivation: 'starting' }),
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      strings.vault_busy_starting,
    );
  },
};

export const DerivingItalian: Story = {
  ...Deriving,
  globals: { locale: 'it' },
};

export const DerivingMobile: Story = {
  ...Deriving,
  globals: { viewport: { value: 'mobile' } },
};

export const CreationFailed: Story = {
  render: (args, ctx) => {
    const strings = stringsFor(localeFrom(ctx.globals));
    return screen(ctx, args, { errorMessage: strings.error_vault });
  },
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    // "Your data is safe" is the load-bearing half: nothing was written, so
    // there is nothing to have lost.
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      strings.error_vault,
    );
  },
};

/* ── 3. the phrase, shown once ──────────────────────────────────────────── */

export const RecoveryPhrase: Story = {
  render: (args, ctx) => screen(ctx, args, { recoveryPhrase: SAMPLE_PHRASE }),
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    await expect(canvasElement).toHaveTextContent(SAMPLE_PHRASE);
    await expect(canvasElement).toHaveTextContent(
      strings.setup_recovery_warning,
    );

    // The acknowledgement is a gate, not a formality: this is the last moment
    // at which losing both secrets is still preventable.
    const button = canvas.getByRole('button', { name: strings.continue_btn });
    await expect(button).toBeDisabled();
    await userEvent.click(
      canvas.getByRole('checkbox', { name: strings.setup_recovery_ack }),
    );
    await expect(button).toBeEnabled();
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

/* ── 4. type it back ────────────────────────────────────────────────────── */

/** Walks from the phrase screen to the confirmation one. */
async function reachConfirmation(
  canvas: ReturnType<typeof within>,
  strings: ReturnType<typeof stringsFor>,
) {
  await userEvent.click(
    canvas.getByRole('checkbox', { name: strings.setup_recovery_ack }),
  );
  await userEvent.click(
    canvas.getByRole('button', { name: strings.continue_btn }),
  );
}

export const ConfirmPhrase: Story = {
  render: (args, ctx) => screen(ctx, args, { recoveryPhrase: SAMPLE_PHRASE }),
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);
    await reachConfirmation(canvas, strings);

    await expect(canvasElement).toHaveTextContent(strings.setup_confirm_sub);
    // The phrase is gone from the screen the moment it has to be recalled —
    // otherwise the step would test nothing but copy-and-paste.
    await expect(canvasElement).not.toHaveTextContent(SAMPLE_PHRASE);

    const field = canvas.getByLabelText(strings.recovery_phrase_label);
    // Never offered to the browser's saved-form store: a recovery phrase there
    // is an unasked-for copy of the vault key.
    await expect(field).toHaveAttribute('autocomplete', 'off');
  },
};

export const ConfirmPhraseItalian: Story = {
  ...ConfirmPhrase,
  globals: { locale: 'it' },
};

export const ConfirmPhraseRejected: Story = {
  render: (args, ctx) => screen(ctx, args, { recoveryPhrase: SAMPLE_PHRASE }),
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);
    await reachConfirmation(canvas, strings);

    await userEvent.type(
      canvas.getByLabelText(strings.recovery_phrase_label),
      'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
    );
    await userEvent.click(
      canvas.getByRole('button', { name: strings.continue_btn }),
    );

    await expect(canvasElement).toHaveTextContent(
      strings.setup_confirm_mismatch,
    );
  },
};

export const ConfirmPhraseAccepted: Story = {
  render: (args, ctx) => screen(ctx, args, { recoveryPhrase: SAMPLE_PHRASE }),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);
    await reachConfirmation(canvas, strings);

    // Lower case, spaces for hyphens. Crockford folds both, which is the whole
    // reason the encoding was chosen: most transcription slips still open the
    // vault at the one moment the user has no other way in (D26).
    await userEvent.type(
      canvas.getByLabelText(strings.recovery_phrase_label),
      SAMPLE_PHRASE.toLowerCase().replaceAll('-', ' '),
    );
    await userEvent.click(
      canvas.getByRole('button', { name: strings.continue_btn }),
    );

    await expect(canvasElement).toHaveTextContent(strings.setup_done_title);
    await userEvent.click(
      canvas.getByRole('button', { name: strings.continue_overview }),
    );
    await expect(args.onFinish).toHaveBeenCalledTimes(1);
  },
};

export const ConfirmPhraseAcceptedMobile: Story = {
  ...ConfirmPhraseAccepted,
  globals: { viewport: { value: 'mobile' } },
};
