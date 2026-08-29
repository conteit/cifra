import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../app/ui/button';
import { Card } from '../app/ui/card';
import { Input } from '../app/ui/input';
import { type Bilingual, type Locale, localeFrom, t } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   Input — a labelled text field.

   The error state is not a colour. `error` paints the border, sets
   `aria-invalid="true"` and joins `aria-describedby`, so a screen reader hears
   the same thing the eye sees. The play functions below assert exactly that.
   ═══════════════════════════════════════════════════════════════════════════ */

const copy = {
  amountLabel: { en: 'Amount', it: 'Importo' },
  amountHint: {
    en: 'Italian format, e.g. 1.284,50',
    it: 'Formato italiano, es. 1.284,50',
  },
  amountError: {
    en: 'Enter an amount like 1.284,50',
    it: 'Inserisci un importo come 1.284,50',
  },
  passphraseLabel: { en: 'Passphrase', it: 'Frase segreta' },
  passphraseHint: {
    en: 'Never leaves this device.',
    it: 'Non lascia mai questo dispositivo.',
  },
  passphraseError: {
    en: 'That passphrase does not unlock this vault. Check the layout of your keyboard and try again.',
    it: 'Questa frase segreta non sblocca il vault. Controlla il layout della tastiera e riprova.',
  },
  disabledLabel: { en: 'Account', it: 'Conto' },
  disabledValue: {
    en: 'Locked while importing',
    it: 'Bloccato durante l’importazione',
  },
  states: { en: 'States', it: 'Stati' },
  defaultState: { en: 'Default', it: 'Predefinito' },
  hintState: { en: 'With hint', it: 'Con suggerimento' },
  errorState: { en: 'Error', it: 'Errore' },
  disabledState: { en: 'Disabled', it: 'Disabilitato' },
  focusNote: {
    en: 'Focus is asserted by a play function; the ring is the shared focus-ring token, never a per-component colour.',
    it: 'Il focus è verificato da una play function; l’anello usa il token focus-ring condiviso, mai un colore per componente.',
  },
  formTitle: { en: 'Unlock your vault', it: 'Sblocca il tuo vault' },
  unlock: { en: 'Unlock', it: 'Sblocca' },
} satisfies Record<string, Bilingual>;

function Frame({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface-page p-10">
      <h2 className="font-mono text-label uppercase text-text-muted">
        {title}
      </h2>
      {note ? (
        <p className="mt-4 max-w-dialog font-body text-row-sub text-text-secondary">
          {note}
        </p>
      ) : null}
      <div className="mt-8 max-w-dialog">{children}</div>
    </section>
  );
}

const meta = {
  title: 'UI/Input',
  component: Input,
  parameters: { layout: 'fullscreen' },
  args: { label: 'Amount' },
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

/* ── The whole state ladder in one view ─────────────────────────────────── */

function Ladder({ locale }: { locale: Locale }) {
  return (
    <Frame title={copy.states[locale]}>
      <div className="flex flex-col gap-10">
        <div>
          <p className="mb-4 font-mono text-label-sm uppercase text-text-secondary">
            {copy.defaultState[locale]}
          </p>
          <Input label={copy.amountLabel[locale]} placeholder="0,00" />
        </div>
        <div>
          <p className="mb-4 font-mono text-label-sm uppercase text-text-secondary">
            {copy.hintState[locale]}
          </p>
          <Input
            label={copy.amountLabel[locale]}
            hint={copy.amountHint[locale]}
            defaultValue="1.284,50"
          />
        </div>
        <div>
          <p className="mb-4 font-mono text-label-sm uppercase text-text-secondary">
            {copy.errorState[locale]}
          </p>
          <Input
            label={copy.amountLabel[locale]}
            hint={copy.amountHint[locale]}
            error={copy.amountError[locale]}
            defaultValue="12,3,4"
          />
        </div>
        <div>
          <p className="mb-4 font-mono text-label-sm uppercase text-text-secondary">
            {copy.disabledState[locale]}
          </p>
          <Input
            label={copy.disabledLabel[locale]}
            defaultValue={copy.disabledValue[locale]}
            disabled
          />
        </div>
      </div>
    </Frame>
  );
}

export const States: Story = {
  render: (_args, ctx) => <Ladder locale={localeFrom(ctx.globals)} />,
};

export const StatesItalian: Story = {
  globals: { locale: 'it' },
  render: (_args, ctx) => <Ladder locale={localeFrom(ctx.globals)} />,
};

export const StatesMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => <Ladder locale={localeFrom(ctx.globals)} />,
};

/* ── Individual states, each with its own assertions ────────────────────── */

export const Default: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.defaultState[locale]}>
        <Input label={copy.amountLabel[locale]} placeholder="0,00" />
      </Frame>
    );
  },
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);
    // getByLabelText only resolves if the <label for> association is real.
    const input = canvas.getByLabelText(copy.amountLabel[locale]);
    await expect(input).not.toHaveAttribute('aria-invalid');
    await expect(input).not.toHaveAttribute('aria-describedby');
  },
};

export const WithHint: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.hintState[locale]}>
        <Input
          label={copy.amountLabel[locale]}
          hint={copy.amountHint[locale]}
        />
      </Frame>
    );
  },
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText(copy.amountLabel[locale]);
    await expect(input).toHaveAccessibleDescription(copy.amountHint[locale]);
  },
};

/**
 * The bullet the issue calls out: the error must be wired, not just coloured.
 */
export const WithError: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.errorState[locale]}>
        <Input
          label={copy.amountLabel[locale]}
          hint={copy.amountHint[locale]}
          error={copy.amountError[locale]}
          defaultValue="12,3,4"
        />
      </Frame>
    );
  },
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText(copy.amountLabel[locale]);

    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeInvalid();

    // The description must carry both the hint and the error, in that order,
    // and must resolve through real ids — not merely exist as visible text.
    const describedBy = input.getAttribute('aria-describedby');
    await expect(describedBy).toBeTruthy();
    const ids = (describedBy ?? '').split(' ').filter(Boolean);
    await expect(ids).toHaveLength(2);
    for (const id of ids) {
      await expect(
        canvasElement.ownerDocument.getElementById(id),
      ).not.toBeNull();
    }
    await expect(input).toHaveAccessibleDescription(
      `${copy.amountHint[locale]} ${copy.amountError[locale]}`,
    );
  },
};

/** A long Italian validation message must wrap, not clip the field. */
export const LongError: Story = {
  globals: { locale: 'it', viewport: { value: 'mobile' } },
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.errorState[locale]}>
        <Input
          label={copy.passphraseLabel[locale]}
          type="password"
          error={copy.passphraseError[locale]}
          defaultValue="wrong-passphrase"
        />
      </Frame>
    );
  },
};

export const Disabled: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.disabledState[locale]}>
        <Input
          label={copy.disabledLabel[locale]}
          defaultValue={copy.disabledValue[locale]}
          disabled
        />
      </Frame>
    );
  },
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const input = within(canvasElement).getByLabelText(
      copy.disabledLabel[locale],
    );
    await expect(input).toBeDisabled();
  },
};

export const Focused: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title="focus" note={copy.focusNote[locale]}>
        <Input label={copy.amountLabel[locale]} placeholder="0,00" />
      </Frame>
    );
  },
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const input = within(canvasElement).getByLabelText(
      copy.amountLabel[locale],
    );
    input.focus();
    await expect(input).toHaveFocus();
    await expect(input.matches(':focus-visible')).toBe(true);
  },
};

/* ── Composed: the shape #10 (lock screen) will build ───────────────────── */

function UnlockForm({ locale }: { locale: Locale }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <div className="bg-surface-page p-10">
      <Card as="section" className="mx-auto max-w-dialog">
        <h2 className="font-display text-title text-text-primary">
          {copy.formTitle[locale]}
        </h2>
        <form
          className="mt-8 flex flex-col gap-8"
          onSubmit={(event) => {
            event.preventDefault();
            setError(value ? undefined : copy.passphraseError[locale]);
          }}
        >
          <Input
            label={copy.passphraseLabel[locale]}
            type="password"
            autoComplete="current-password"
            hint={copy.passphraseHint[locale]}
            error={error}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="submit" fullWidth>
            {copy.unlock[locale]}
          </Button>
        </form>
        <p className="mt-6 font-body text-row-sub text-text-muted">
          {t(locale, 'signin_feat1_body')}
        </p>
      </Card>
    </div>
  );
}

/**
 * Submitting empty flips the error on mid-session — the case `aria-live` on
 * the message exists for.
 */
export const ValidationOnSubmit: Story = {
  render: (_args, ctx) => <UnlockForm locale={localeFrom(ctx.globals)} />,
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText(copy.passphraseLabel[locale]);

    await expect(input).not.toHaveAttribute('aria-invalid');
    await userEvent.click(
      canvas.getByRole('button', { name: copy.unlock[locale] }),
    );
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(
      `${copy.passphraseHint[locale]} ${copy.passphraseError[locale]}`,
    );

    await userEvent.type(input, 'correct horse battery staple');
    await userEvent.click(
      canvas.getByRole('button', { name: copy.unlock[locale] }),
    );
    await expect(input).not.toHaveAttribute('aria-invalid');
  },
};

export const ValidationOnSubmitItalian: Story = {
  globals: { locale: 'it' },
  render: (_args, ctx) => <UnlockForm locale={localeFrom(ctx.globals)} />,
};

export const ValidationOnSubmitMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => <UnlockForm locale={localeFrom(ctx.globals)} />,
};
