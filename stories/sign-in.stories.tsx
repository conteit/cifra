import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { stringsFor } from '../app/i18n';
import { authErrorMessage } from '../app/screens/auth-error-copy';
import { SignInScreen } from '../app/screens/sign-in-screen';
import { localeFrom } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   Sign-in — the first screen anyone sees, and the only one that renders with
   no identity at all.

   Four states, and the fourth is the interesting one:

     · `signed-out`   — the offer, with the three things signing in does and
       the one thing it does not.
     · `signing-in`   — the popup is open. The button stays focusable and
       announces itself as busy (#54); it does not become `disabled`, which
       would throw a keyboard user to the top of the document at the exact
       moment they are waiting.
     · error          — a failure the user can act on, one line per
       `AuthErrorCode`. `popup-blocked` is the one worth looking at: it is the
       known cost of choosing `signInWithPopup`, and the copy names the fix.
     · `unavailable`  — no `VITE_FIREBASE_*` and no emulator. There is no
       identity provider at all, so the screen says so and offers no button
       rather than one that could only fail. Before #9 this rendered as an app
       that simply never did anything.

   The copy here was rewritten in #9. `signin_feat2_*` used to advertise Gemini
   receipt scanning and `signin_note` used to ask for Gemini API permission —
   AI is an explicit v1 non-goal, and this screen's job is to say what signing
   in does and does not do.
   ═══════════════════════════════════════════════════════════════════════════ */

const meta: Meta<typeof SignInScreen> = {
  title: 'Screens/SignIn',
  component: SignInScreen,
  parameters: { layout: 'fullscreen' },
  args: { onSignIn: fn() },
};

export default meta;

type Story = StoryObj<typeof SignInScreen>;

/* ── the offer ──────────────────────────────────────────────────────────── */

export const SignedOut: Story = {
  render: (args, ctx) => (
    <SignInScreen
      status="signed-out"
      strings={stringsFor(localeFrom(ctx.globals))}
      onSignIn={args.onSignIn}
    />
  ),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(
      strings.tagline_line1,
    );
    await expect(canvasElement).toHaveTextContent(strings.signin_title);

    // The three promises, in the locale under test. Asserting the *body* copy
    // rather than the headings is what would catch the Gemini lines coming
    // back: a title can be rewritten while the body still markets AI.
    await expect(canvasElement).toHaveTextContent(strings.signin_feat1_body);
    await expect(canvasElement).toHaveTextContent(strings.signin_feat2_body);
    await expect(canvasElement).toHaveTextContent(strings.signin_feat3_body);
    await expect(canvasElement).toHaveTextContent(strings.signin_note);

    await userEvent.click(
      canvas.getByRole('button', { name: strings.signin_btn }),
    );
    await expect(args.onSignIn).toHaveBeenCalledTimes(1);
  },
};

export const SignedOutItalian: Story = {
  ...SignedOut,
  globals: { locale: 'it' },
};

export const SignedOutMobile: Story = {
  ...SignedOut,
  globals: { viewport: { value: 'mobile' } },
};

/* ── the popup is open ──────────────────────────────────────────────────── */

export const SigningIn: Story = {
  render: (args, ctx) => (
    <SignInScreen
      status="signing-in"
      strings={stringsFor(localeFrom(ctx.globals))}
      onSignIn={args.onSignIn}
    />
  ),
  play: async ({ args, canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    const button = canvas.getByRole('button', { name: strings.signing_in });
    // Focusable and announced, not `disabled` — see the note above and #54.
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toBeDisabled();

    // …and inert all the same: a second popup is not something a second click
    // should be able to ask for.
    await userEvent.click(button);
    await expect(args.onSignIn).not.toHaveBeenCalled();
  },
};

export const SigningInItalian: Story = {
  ...SigningIn,
  globals: { locale: 'it' },
};

/* ── a failure the user can do something about ──────────────────────────── */

export const PopupBlocked: Story = {
  render: (args, ctx) => {
    const strings = stringsFor(localeFrom(ctx.globals));
    return (
      <SignInScreen
        status="signed-out"
        strings={strings}
        errorMessage={authErrorMessage(strings, { code: 'popup-blocked' })}
        onSignIn={args.onSignIn}
      />
    );
  },
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    // `role="alert"`: it appears in response to something the user just did,
    // and is the only feedback that anything happened.
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      strings.auth_error_popup_blocked,
    );
    // The offer survives the failure — this is a retry, not a dead end.
    await expect(
      canvas.getByRole('button', { name: strings.signin_btn }),
    ).toBeVisible();
  },
};

export const PopupBlockedItalian: Story = {
  ...PopupBlocked,
  globals: { locale: 'it' },
};

export const NetworkError: Story = {
  render: (args, ctx) => {
    const strings = stringsFor(localeFrom(ctx.globals));
    return (
      <SignInScreen
        status="signed-out"
        strings={strings}
        errorMessage={authErrorMessage(strings, { code: 'network' })}
        onSignIn={args.onSignIn}
      />
    );
  },
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      strings.auth_error_network,
    );
  },
};

/* ── no identity provider at all ────────────────────────────────────────── */

export const Unavailable: Story = {
  render: (args, ctx) => (
    <SignInScreen
      status="unavailable"
      strings={stringsFor(localeFrom(ctx.globals))}
      onSignIn={args.onSignIn}
    />
  ),
  play: async ({ canvasElement, globals }) => {
    const strings = stringsFor(localeFrom(globals));
    const canvas = within(canvasElement);

    await expect(canvasElement).toHaveTextContent(
      strings.signin_unavailable_body,
    );
    // No button. There is nothing behind it: `readFirebaseConfig` throws on the
    // missing variables and the store is terminal until the page reloads, so a
    // control here could only fail.
    await expect(
      canvas.queryByRole('button', { name: strings.signin_btn }),
    ).toBeNull();
    await expect(canvas.queryAllByRole('button')).toHaveLength(0);
  },
};

export const UnavailableItalian: Story = {
  ...Unavailable,
  globals: { locale: 'it' },
};

export const UnavailableMobile: Story = {
  ...Unavailable,
  globals: { viewport: { value: 'mobile' } },
};
