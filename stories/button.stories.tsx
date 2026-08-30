import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fragment, useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Button, type ButtonProps, type ButtonVariant } from '../app/ui/button';
import { Input } from '../app/ui/input';
import { type Bilingual, type Locale, localeFrom, t } from './locale';
import { resolveColorToken } from './token-probe';

/* ═══════════════════════════════════════════════════════════════════════════
   Button — the one action in the system.

   Three variants, one size. The type scale offers exactly one button role
   (`text-button`), so a size axis would have to invent type outside the scale;
   density is expressed by `quiet`, not by a smaller button.
   ═══════════════════════════════════════════════════════════════════════════ */

const copy = {
  variants: { en: 'Variants', it: 'Varianti' },
  states: { en: 'States', it: 'Stati' },
  default: { en: 'Default', it: 'Predefinito' },
  disabled: { en: 'Disabled', it: 'Disabilitato' },
  loading: { en: 'Loading', it: 'In caricamento' },
  hoverNote: {
    en: 'Hover and focus are live: point at a button, or tab to it. They are CSS states, so they exist only under real input — the ring below is asserted by a play function, the hover fill is not.',
    it: 'Hover e focus sono reali: passa il puntatore su un bottone, o raggiungilo con Tab. Sono stati CSS, esistono solo con input reale — l’anello qui sotto è verificato da una play function, il riempimento in hover no.',
  },
  secondary: { en: 'Add expense', it: 'Aggiungi spesa' },
  quiet: { en: 'Skip', it: 'Salta' },
  longLabel: {
    en: 'Import a bank statement from your computer',
    it: 'Importa un estratto conto bancario dal tuo computer',
  },
  formLegend: { en: 'Submit inside a form', it: 'Invio dentro un form' },
  submitted: { en: 'Submitted', it: 'Inviato' },
  focusLegend: {
    en: 'Focus survives the wait',
    it: 'Il focus sopravvive all’attesa',
  },
  focusNote: {
    en: 'Press Enter or Space on the button. It becomes busy without becoming `disabled`, so focus stays where the user put it instead of falling to the top of the document.',
    it: 'Premi Invio o Spazio sul bottone. Diventa occupato senza diventare `disabled`, così il focus resta dove l’utente l’ha messo invece di cadere in cima al documento.',
  },
  keyboardLegend: {
    en: 'Busy ignores the keyboard',
    it: 'Occupato ignora la tastiera',
  },
  busyFormLegend: {
    en: 'Busy submit inside a form',
    it: 'Invio occupato dentro un form',
  },
  amountLabel: { en: 'Amount', it: 'Importo' },
} satisfies Record<string, Bilingual>;

const variants: ButtonVariant[] = ['primary', 'secondary', 'quiet'];

function labelFor(variant: ButtonVariant, locale: Locale): string {
  if (variant === 'primary') return t(locale, 'txn_import_btn');
  if (variant === 'secondary') return copy.secondary[locale];
  return copy.quiet[locale];
}

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
      <div className="mt-8">{children}</div>
    </section>
  );
}

/** The full variant × state grid, in one place, so drift is visible. */
function Matrix({ locale }: { locale: Locale }) {
  return (
    <Frame title={copy.variants[locale]}>
      <div className="grid grid-cols-1 gap-8 desktop:grid-cols-[8rem_repeat(3,auto)_1fr] desktop:items-center">
        {(
          [
            ['default', {}],
            ['disabled', { disabled: true }],
            ['loading', { loading: true }],
          ] as const
        ).map(([state, props]) => (
          <Fragment key={state}>
            <p className="font-mono text-label-sm uppercase text-text-secondary">
              {copy[state][locale]}
            </p>
            {variants.map((variant) => (
              <div key={`${state}-${variant}`}>
                <Button variant={variant} {...props}>
                  {labelFor(variant, locale)}
                </Button>
              </div>
            ))}
            <span />
          </Fragment>
        ))}
      </div>
    </Frame>
  );
}

const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'fullscreen' },
  args: { children: 'Import statement' },
  argTypes: {
    variant: { control: 'inline-radio', options: variants },
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/* ── One button per variant ─────────────────────────────────────────────── */

function Single({
  variant,
  locale,
  ...rest
}: { variant: ButtonVariant; locale: Locale } & Omit<
  ButtonProps,
  'variant' | 'children'
>) {
  return (
    <Frame title={variant}>
      <Button variant={variant} {...rest}>
        {labelFor(variant, locale)}
      </Button>
    </Frame>
  );
}

export const Primary: Story = {
  render: (_args, ctx) => (
    <Single variant="primary" locale={localeFrom(ctx.globals)} />
  ),
};

export const Secondary: Story = {
  render: (_args, ctx) => (
    <Single variant="secondary" locale={localeFrom(ctx.globals)} />
  ),
};

export const Quiet: Story = {
  render: (_args, ctx) => (
    <Single variant="quiet" locale={localeFrom(ctx.globals)} />
  ),
};

/* ── The grid: every variant against every static state ─────────────────── */

export const Variants: Story = {
  render: (_args, ctx) => <Matrix locale={localeFrom(ctx.globals)} />,
};

export const VariantsItalian: Story = {
  globals: { locale: 'it' },
  render: (_args, ctx) => <Matrix locale={localeFrom(ctx.globals)} />,
};

export const VariantsMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => <Matrix locale={localeFrom(ctx.globals)} />,
};

/* ── Interactive states ─────────────────────────────────────────────────── */

/**
 * Focus is asserted; hover is demonstrated. `:hover` is a CSS state driven by
 * real pointer input, and synthetic pointer events do not produce it — so the
 * story says so out loud rather than shipping a fake "hover" replica that
 * would drift from the real rule.
 */
export const FocusAndHover: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.states[locale]} note={copy.hoverNote[locale]}>
        <div className="flex flex-wrap gap-6">
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {labelFor(variant, locale)}
            </Button>
          ))}
        </div>
      </Frame>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const buttons = canvas.getAllByRole('button');
    const primary = buttons[0];
    primary.focus();
    await expect(primary).toHaveFocus();
    await expect(primary.matches(':focus-visible')).toBe(true);

    // The ring must be the shared `focusRing` treatment painted in
    // --color-focus-ring, not the browser's own default outline. Asserting
    // merely "not transparent" would pass with the ring deleted, because
    // Chromium then draws its own #005fcc focus ring — so compare against the
    // resolved token. `waitFor`, because `transition-colors` animates
    // outline-color too: read synchronously after focus() and the value is
    // still the pre-transition currentColor.
    const expectedRing = resolveColorToken(
      canvasElement.ownerDocument,
      '--color-focus-ring',
    );
    await waitFor(async () => {
      const styles = getComputedStyle(primary);
      await expect(styles.outlineStyle).not.toBe('none');
      await expect(styles.outlineColor).toBe(expectedRing);
    });
  },
};

/* ── Disabled and loading are not the same thing ────────────────────────── */

export const Disabled: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.disabled[locale]}>
        <div className="flex flex-wrap gap-6">
          {variants.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {labelFor(variant, locale)}
            </Button>
          ))}
        </div>
      </Frame>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const button of canvas.getAllByRole('button')) {
      await expect(button).toBeDisabled();
      await expect(button).not.toHaveAttribute('aria-busy');
    }
  },
};

export const Loading: Story = {
  args: { onClick: fn() },
  render: (args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.loading[locale]}>
        <Button variant="primary" loading onClick={args.onClick}>
          {t(locale, 'signing_in')}
        </Button>
      </Frame>
    );
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button');
    // `loading` is a promise to assistive tech and a lock at the same time.
    await expect(button).toHaveAttribute('aria-busy', 'true');
    // Soft-disabled, never natively disabled (#54): the native attribute would
    // take the element out of the tab order and blur it. A screen reader still
    // hears "dimmed"/"unavailable" plus "busy" from `aria-disabled`.
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toBeDisabled();
    // Still reachable, which is the whole point of the soft form.
    button.focus();
    await expect(button).toHaveFocus();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
    await expect(button).toHaveFocus();
  },
};

/* ── #54: the busy button keeps the focus it was given ──────────────────── */

/**
 * A button that flips itself into `loading` when activated — the sign-in shape
 * (#9), which is the first real consumer and the primary control on the first
 * screen a user ever sees.
 *
 * The label is the caller's, in both states: the primitive never renames the
 * control, so the accessible name goes `signin_btn` → `signing_in` because the
 * page said so. Across that transition a screen reader announces the new name
 * plus busy, on the button the user is still standing on.
 */
function SelfBusyingButton({
  locale,
  onActivate,
}: {
  locale: Locale;
  onActivate: ButtonProps['onClick'];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      loading={busy}
      onClick={(event) => {
        setBusy(true);
        onActivate?.(event);
      }}
    >
      {busy ? t(locale, 'signing_in') : t(locale, 'signin_btn')}
    </Button>
  );
}

/**
 * The C-13 regression guard. Setting the native `disabled` attribute on a
 * focused element blurs it to `<body>`; `aria-disabled` does not. Asserting
 * focus *after* the idle → loading transition is what tells the two apart —
 * the assertion below fails the moment `loading` goes back to painting
 * `disabled`.
 */
export const KeepsFocusWhileBusy: Story = {
  args: { onClick: fn() },
  render: (args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.focusLegend[locale]} note={copy.focusNote[locale]}>
        <SelfBusyingButton locale={locale} onActivate={args.onClick} />
      </Frame>
    );
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button');
    button.focus();
    await expect(button).toHaveFocus();

    // Keyboard activation, the way the affected user reaches it.
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledTimes(1);

    await waitFor(async () => {
      await expect(button).toHaveAttribute('aria-busy', 'true');
    });
    // The defect: with `disabled`, focus is on <body> by now.
    await expect(button).toHaveFocus();
    await expect(canvasElement.ownerDocument.activeElement).toBe(button);
    await expect(button).not.toBeDisabled();

    // And the lock holds: a second Enter, a Space and a click all go nowhere.
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await expect(button).toHaveFocus();
  },
};

/**
 * `aria-disabled` announces a lock; it does not enforce one. Enter and Space
 * are the browser's own path to a click on a `<button>`, so the primitive has
 * to refuse them itself — and refuse them *at the key*, before a click exists,
 * so the caller's own `onKeyDown`/`onKeyUp` never run the action a second way.
 *
 * The key spies are the point of this story: the click guard alone would keep
 * `onClick` quiet while leaving those handlers firing.
 */
export const BusyIgnoresKeyboardActivation: Story = {
  args: { onClick: fn(), onKeyDown: fn(), onKeyUp: fn() },
  render: (args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.keyboardLegend[locale]}>
        <Button
          variant="primary"
          loading
          onClick={args.onClick}
          onKeyDown={args.onKeyDown}
          onKeyUp={args.onKeyUp}
        >
          {t(locale, 'signing_in')}
        </Button>
      </Frame>
    );
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button');
    button.focus();
    await expect(button).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    await expect(args.onClick).not.toHaveBeenCalled();
    await expect(args.onKeyDown).not.toHaveBeenCalled();
    await expect(args.onKeyUp).not.toHaveBeenCalled();
    await expect(button).toHaveFocus();
  },
};

/**
 * The expensive failure the click guard is really for: submission is the
 * *default action* of a click on `type="submit"`, so a busy submit button that
 * only skipped `onClick` would still post the form — including via implicit
 * submission, where the browser synthesises the click from a text field's
 * Enter. Both paths are exercised here rather than assumed.
 */
export const BusySubmitDoesNotSubmit: Story = {
  args: { onSubmit: fn() },
  render: (args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.busyFormLegend[locale]}>
        <form
          className="flex max-w-dialog flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            args.onSubmit?.(
              event as unknown as Parameters<
                NonNullable<ButtonProps['onSubmit']>
              >[0],
            );
          }}
        >
          <Input label={copy.amountLabel[locale]} name="amount" />
          <Button variant="primary" type="submit" loading fullWidth>
            {t(locale, 'import_save_btn')}
          </Button>
        </form>
      </Frame>
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button');
    await expect(button).toHaveAttribute('type', 'submit');

    await userEvent.click(button);
    await expect(args.onSubmit).not.toHaveBeenCalled();

    // Implicit submission: Enter in the field fires a click on the form's
    // default button, which is the busy one.
    const field = canvas.getByRole('textbox');
    await userEvent.click(field);
    await userEvent.keyboard('{Enter}');
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/* ── Layout behaviour ───────────────────────────────────────────────────── */

/** The sign-in / lock-screen shape: one full-width action in a narrow column. */
export const FullWidth: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title="fullWidth">
        <div className="mx-auto flex max-w-dialog flex-col gap-6">
          <Button variant="primary" fullWidth>
            {t(locale, 'signin_btn')}
          </Button>
          <Button variant="secondary" fullWidth>
            {t(locale, 'continue_btn')}
          </Button>
        </div>
      </Frame>
    );
  },
};

/** Italian runs ~20% longer than English; labels wrap, they do not truncate. */
export const LongLabel: Story = {
  globals: { locale: 'it', viewport: { value: 'mobile' } },
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title="long label">
        <div className="flex max-w-dialog flex-col gap-6">
          <Button variant="primary">{copy.longLabel[locale]}</Button>
          <Button variant="secondary" fullWidth>
            {copy.longLabel[locale]}
          </Button>
        </div>
      </Frame>
    );
  },
};

/* ── `type` defaults to "button" ────────────────────────────────────────── */

/**
 * Guards the deliberate deviation from the HTML default: a Button inside a
 * form does not submit it unless the caller asks for `type="submit"`.
 */
export const InsideAForm: Story = {
  args: { onClick: fn() },
  render: (args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.formLegend[locale]}>
        <form
          className="flex flex-wrap gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            args.onClick?.(
              event as unknown as React.MouseEvent<HTMLButtonElement>,
            );
          }}
        >
          <Button variant="secondary">{t(locale, 'import_skip_btn')}</Button>
          <Button variant="primary" type="submit">
            {t(locale, 'import_save_btn')}
          </Button>
        </form>
      </Frame>
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const buttons = canvas.getAllByRole('button');
    await expect(buttons[0]).toHaveAttribute('type', 'button');
    await expect(buttons[1]).toHaveAttribute('type', 'submit');
    await userEvent.click(buttons[0]);
    await expect(args.onClick).not.toHaveBeenCalled();
    await userEvent.click(buttons[1]);
    await expect(args.onClick).toHaveBeenCalled();
  },
};
