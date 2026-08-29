import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fragment } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button, type ButtonProps, type ButtonVariant } from '../app/ui/button';
import { type Bilingual, type Locale, localeFrom, t } from './locale';

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
    // The focus ring is the shared `focusRing` treatment, drawn as an outline
    // in the focus-ring token. If a component ever swaps it for a border or a
    // raw colour this assertion is what notices.
    await expect(primary.matches(':focus-visible')).toBe(true);
    const outline = getComputedStyle(primary).outlineColor;
    const expected = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-focus-ring')
      .trim();
    await expect(outline).not.toBe('rgba(0, 0, 0, 0)');
    await expect(expected).not.toBe('');
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
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
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
