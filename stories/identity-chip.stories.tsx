import type { Meta, StoryObj } from '@storybook/react-vite';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, fn, userEvent, within } from 'storybook/test';

import { stringsFor } from '../app/i18n';
import { IdentityChip } from '../app/screens/identity-chip';
import { AppShell } from '../app/shell/app-shell';
import { localeFrom } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   The identity chip — the `identity` slot `AppShell` left for #9.

   Rendered inside the real shell, because that is the only place it makes
   sense: it sits in the header beside the page title, and on mobile the name
   drops out while the controls stay. A story that rendered it on a bare page
   would specify a component nobody sees.

   Two states, and the difference is the vault rather than the session:
   `showLock` is on only while a data key is held. Locking a vault that is
   already locked is not an offer worth making.

   The lock button is the only lock trigger #9 ships. #10 adds the idle
   auto-lock and the tab-close wipe (FOUN-10) — both call the same store action
   this button does.
   ═══════════════════════════════════════════════════════════════════════════ */

const meta: Meta<typeof IdentityChip> = {
  title: 'Screens/IdentityChip',
  component: IdentityChip,
  parameters: { layout: 'fullscreen' },
  args: { onLock: fn(), onSignOut: fn() },
};

export default meta;

type Story = StoryObj<typeof IdentityChip>;

function inShell(
  ctx: { globals: Record<string, unknown> },
  args: { onLock: () => void; onSignOut: () => void },
  options: { label: string; showLock: boolean },
) {
  const strings = stringsFor(localeFrom(ctx.globals));
  // The shell navigates, so it needs a router. In-memory, as in
  // `stories/app-shell.stories.tsx` — the workbench has no history to share.
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <AppShell
            strings={strings}
            title={strings.nav_overview}
            identity={
              <IdentityChip
                strings={strings}
                label={options.label}
                showLock={options.showLock}
                onLock={args.onLock}
                onSignOut={args.onSignOut}
              />
            }
          >
            <p className="font-body text-body text-text-secondary">
              {strings.welcome_body}
            </p>
          </AppShell>
        ),
      },
    ],
    { initialEntries: ['/'] },
  );
  return <RouterProvider router={router} />;
}

export const Unlocked: Story = {
  render: (args, ctx) =>
    inShell(ctx, args, { label: 'Ada Lovelace', showLock: true }),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole('button', { name: strings.identity_lock }),
    );
    await expect(args.onLock).toHaveBeenCalledTimes(1);

    await userEvent.click(
      canvas.getByRole('button', { name: strings.signout_btn }),
    );
    await expect(args.onSignOut).toHaveBeenCalledTimes(1);
  },
};

export const UnlockedItalian: Story = {
  ...Unlocked,
  globals: { locale: 'it' },
};

export const UnlockedMobile: Story = {
  ...Unlocked,
  globals: { viewport: { value: 'mobile' } },
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    // The header is narrow enough on a 402px viewport that the name would
    // crowd out the title, so it drops and the two controls stay. Both are
    // still reachable — a lock affordance that disappears on a phone would be
    // the one place it matters most.
    await expect(
      canvas.getByRole('button', { name: strings.identity_lock }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: strings.signout_btn }),
    ).toBeVisible();
  },
};

export const NoDisplayName: Story = {
  render: (args, ctx) =>
    inShell(ctx, args, { label: 'ada@example.com', showLock: true }),
  play: async ({ canvasElement }) => {
    // Google accounts without a display name are ordinary; the route falls
    // back to the email rather than inventing a placeholder, because a made-up
    // name would be indistinguishable from a real one.
    await expect(canvasElement).toHaveTextContent('ada@example.com');
  },
};

export const Locked: Story = {
  render: (args, ctx) =>
    inShell(ctx, args, { label: 'Ada Lovelace', showLock: false }),
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    await expect(
      canvas.queryByRole('button', { name: strings.identity_lock }),
    ).toBeNull();
    // Signing out still works: it is the way out of a vault that will not open.
    await expect(
      canvas.getByRole('button', { name: strings.signout_btn }),
    ).toBeVisible();
  },
};
