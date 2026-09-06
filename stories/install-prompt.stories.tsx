import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { InstallPrompt } from '../app/shell/install-prompt';
import { Card } from '../app/ui/card';
import { type Bilingual, type Locale, localeFrom, t } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   Install prompt — FOUN-06's user-facing half.

   Three states, and only two of them draw anything:

     · `available` — Chromium captured a `beforeinstallprompt`; the strip
       carries a real Install button that opens the browser's own dialog.
     · `guidance`  — iOS/iPadOS, where that event is never fired by any
       browser. The strip carries the Share → Add to Home Screen instruction
       instead of a button, so the platform with the least discoverable install
       path is not the one platform with no affordance at all (D25).
     · `hidden`    — already installed, dismissed, or a browser with neither an
       event nor an install path worth naming. Renders nothing: no wrapper, no
       spacing, no landmark.

   The component is dumb — state and copy in, callbacks out. What decides the
   state is `app/services/pwa/install-prompt.ts`, covered by
   `test/unit/pwa/install-prompt.test.ts`; what wires the two together is
   `app/routes/app-layout.tsx`.
   ═══════════════════════════════════════════════════════════════════════════ */

const copy = {
  pageNote: {
    en: 'The strip sits at the top of the page, above whatever the route renders.',
    it: 'La striscia sta in cima alla pagina, sopra ciò che la rotta disegna.',
  },
  hiddenNote: {
    en: 'Nothing is rendered in this state — the page below starts where the strip would have been.',
    it: 'In questo stato non viene disegnato nulla — la pagina sotto inizia dove sarebbe stata la striscia.',
  },
} satisfies Record<string, Bilingual>;

/** The shell's copy for a locale, from the app's own resolver (see #47). */
function installStrings(locale: Locale) {
  return {
    install_title: t(locale, 'install_title'),
    install_body: t(locale, 'install_body'),
    install_ios_body: t(locale, 'install_ios_body'),
    install_action: t(locale, 'install_action'),
    install_dismiss: t(locale, 'install_dismiss'),
  };
}

type HarnessProps = {
  locale: Locale;
  state: 'available' | 'guidance' | 'hidden';
  onInstall: () => void;
  onDismiss: () => void;
};

/**
 * The strip where it actually lives: inside `<main>`, under the shell's `<h1>`,
 * above the page. Rendering the surrounding heading matters — the strip's own
 * title is an `<h2>` precisely because the shell owns the `<h1>`.
 */
function Harness({ locale, state, onInstall, onDismiss }: HarnessProps) {
  return (
    <div className="min-h-screen bg-surface-page p-10">
      <h1 className="font-display text-title text-text-primary">
        {t(locale, 'nav_overview')}
      </h1>
      <div className="mt-8">
        <InstallPrompt
          state={state}
          strings={installStrings(locale)}
          onInstall={onInstall}
          onDismiss={onDismiss}
        />
        <Card as="section">
          <p className="font-body text-body text-text-secondary">
            {state === 'hidden'
              ? copy.hiddenNote[locale]
              : copy.pageNote[locale]}
          </p>
        </Card>
      </div>
    </div>
  );
}

const meta: Meta<typeof InstallPrompt> = {
  title: 'Shell/InstallPrompt',
  component: InstallPrompt,
  parameters: { layout: 'fullscreen' },
  args: { onInstall: fn(), onDismiss: fn() },
};

export default meta;

type Story = StoryObj<typeof InstallPrompt>;

/* ── available: the Chromium path ───────────────────────────────────────── */

export const Available: Story = {
  render: (args, ctx) => (
    <Harness
      locale={localeFrom(ctx.globals)}
      state="available"
      onInstall={args.onInstall}
      onDismiss={args.onDismiss}
    />
  ),
  play: async ({ args, canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);

    // A named region, so the strip is reachable and announced as one thing.
    const region = canvas.getByRole('region', {
      name: t(locale, 'install_title'),
    });
    await expect(region).toHaveAttribute('data-install-state', 'available');

    // The offer, not the iOS instruction.
    await expect(region).toHaveTextContent(t(locale, 'install_body'));
    await expect(region).not.toHaveTextContent(t(locale, 'install_ios_body'));

    await userEvent.click(
      canvas.getByRole('button', { name: t(locale, 'install_action') }),
    );
    await expect(args.onInstall).toHaveBeenCalledTimes(1);

    await userEvent.click(
      canvas.getByRole('button', { name: t(locale, 'install_dismiss') }),
    );
    await expect(args.onDismiss).toHaveBeenCalledTimes(1);
  },
};

export const AvailableItalian: Story = {
  ...Available,
  globals: { locale: 'it' },
};

export const AvailableMobile: Story = {
  ...Available,
  globals: { viewport: { value: 'mobile' } },
};

/* ── guidance: the iOS path (D25) ───────────────────────────────────────── */

export const IosGuidance: Story = {
  render: (args, ctx) => (
    <Harness
      locale={localeFrom(ctx.globals)}
      state="guidance"
      onInstall={args.onInstall}
      onDismiss={args.onDismiss}
    />
  ),
  play: async ({ args, canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);

    const region = canvas.getByRole('region', {
      name: t(locale, 'install_title'),
    });
    await expect(region).toHaveAttribute('data-install-state', 'guidance');
    await expect(region).toHaveTextContent(t(locale, 'install_ios_body'));

    // There is nothing to press: WebKit gives the page no prompt to fire, so
    // offering a button that could only do nothing would be a lie.
    await expect(
      canvas.queryByRole('button', { name: t(locale, 'install_action') }),
    ).toBeNull();

    // Dismiss is the only control, and on iOS it is the only way out: there is
    // no `appinstalled` event there either, so an undismissed strip would
    // outlive the install it asked for.
    await userEvent.click(
      canvas.getByRole('button', { name: t(locale, 'install_dismiss') }),
    );
    await expect(args.onDismiss).toHaveBeenCalledTimes(1);
  },
};

export const IosGuidanceItalian: Story = {
  ...IosGuidance,
  globals: { locale: 'it' },
};

export const IosGuidanceMobile: Story = {
  ...IosGuidance,
  globals: { viewport: { value: 'mobile' } },
};

/* ── hidden: installed, dismissed, or never offered ─────────────────────── */

export const Hidden: Story = {
  render: (args, ctx) => (
    <Harness
      locale={localeFrom(ctx.globals)}
      state="hidden"
      onInstall={args.onInstall}
      onDismiss={args.onDismiss}
    />
  ),
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);

    // Nothing at all — not a collapsed box, not an empty landmark. An
    // installed app that still renders a container would leave a gap above
    // every page in the app.
    await expect(canvas.queryByTestId('install-prompt')).toBeNull();
    await expect(
      canvas.queryByRole('region', { name: t(locale, 'install_title') }),
    ).toBeNull();
    await expect(canvasElement).not.toHaveTextContent(
      t(locale, 'install_title'),
    );
  },
};
